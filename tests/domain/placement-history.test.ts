import { describe, expect, it, vi } from 'vitest';

import type { IpcResult } from '../../src/common/contracts/ipc-result';
import type {
  PlacementCreateInput,
  PlacementListOutput,
  PlacementMoveInput,
  PlacementOutput,
  PlacementRemoveInput,
  PlacementSummary,
} from '../../src/common/contracts/placement';
import {
  createPlacementHistory,
  HISTORY_UNKNOWN_OUTCOME,
  MAX_HISTORY,
} from '../../src/renderer/world/placement-history';
import { createPlacementTool, HISTORY_BUSY } from '../../src/renderer/world/placement-tool';
import { createWorldPlacements } from '../../src/renderer/world/world-placements';

// M2-8 (#73): the undo/redo history for placement changes, driven through the real placement
// tool against a fake main process that checks revisions and occupied tiles like the real one.

const WORLD = { id: '00000000-0000-4000-8000-000000000001', gridWidth: 16, gridHeight: 16 };
const TWO = { columns: 2, rows: 2 };
const ALPHA = { id: 'p-alpha', name: 'Alpha' };
const BETA = { id: 'p-beta', name: 'Beta' };

function summary(id: string, projectId: string, tileX: number, tileY: number): PlacementSummary {
  return {
    id,
    worldId: WORLD.id,
    target: { type: 'project', id: projectId },
    projectStatus: 'active',
    appearanceId: 'placeholder.building.2x2',
    footprint: TWO,
    tileX,
    tileY,
    rotation: 0,
    createdAt: '2026-11-22T10:00:00.000Z',
    updatedAt: '2026-11-22T10:00:00.000Z',
    revision: 1,
  };
}

const overlaps = (a: { tileX: number; tileY: number }, b: { tileX: number; tileY: number }) =>
  Math.abs(a.tileX - b.tileX) < 2 && Math.abs(a.tileY - b.tileY) < 2;

/** A fake main process with the checks undo relies on: revisions, overlaps, one per project. */
function setup(initial: PlacementSummary[] = []) {
  let rows = [...initial];
  let next = 1;
  const ok = (placement: PlacementSummary): IpcResult<PlacementOutput> => ({
    ok: true,
    data: { placement },
  });
  const fail = (code: 'revision_conflict' | 'not_found' | 'already_exists') =>
    Promise.resolve<IpcResult<PlacementOutput>>({ ok: false, error: { code, message: code } });
  const blocked = (others: PlacementSummary[], spot: { tileX: number; tileY: number }) => {
    const hit = others.find((r) => overlaps(r, spot));
    return hit === undefined
      ? null
      : Promise.resolve<IpcResult<PlacementOutput>>({
          ok: false,
          error: {
            code: 'placement_blocked',
            message: 'blocked',
            placement: { reason: 'overlaps', blockingIds: [hit.id] },
          },
        });
  };
  const api = {
    placement: {
      list: vi.fn((): Promise<IpcResult<PlacementListOutput>> =>
        Promise.resolve({ ok: true, data: { placements: rows } }),
      ),
      create: vi.fn((input: PlacementCreateInput): Promise<IpcResult<PlacementOutput>> => {
        if (rows.some((r) => r.target.id === input.projectId)) return fail('already_exists');
        const refusal = blocked(rows, input);
        if (refusal !== null) return refusal;
        const created = {
          ...summary(`b${String(next++)}`, input.projectId, input.tileX, input.tileY),
          rotation: input.rotation,
        };
        rows = [...rows, created];
        return Promise.resolve(ok(created));
      }),
      move: vi.fn((input: PlacementMoveInput): Promise<IpcResult<PlacementOutput>> => {
        const found = rows.find((r) => r.id === input.placementId);
        if (found === undefined) return fail('not_found');
        if (found.revision !== input.expectedRevision) return fail('revision_conflict');
        const refusal = blocked(
          rows.filter((r) => r.id !== found.id),
          input,
        );
        if (refusal !== null) return refusal;
        const moved = {
          ...found,
          tileX: input.tileX,
          tileY: input.tileY,
          revision: found.revision + 1,
        };
        rows = rows.map((r) => (r.id === moved.id ? moved : r));
        return Promise.resolve(ok(moved));
      }),
      remove: vi.fn((input: PlacementRemoveInput): Promise<IpcResult<PlacementOutput>> => {
        const found = rows.find((r) => r.id === input.placementId);
        if (found === undefined) return fail('not_found');
        if (found.revision !== input.expectedRevision) return fail('revision_conflict');
        rows = rows.filter((r) => r.id !== input.placementId);
        return Promise.resolve(ok(found));
      }),
    },
  };
  const placements = createWorldPlacements(api, WORLD.id);
  const history = createPlacementHistory(api, WORLD, placements);
  const tool = createPlacementTool(api, WORLD, placements, TWO, history);
  return {
    api,
    placements,
    history,
    tool,
    rows: () => rows,
    /** Changes the saved buildings behind the renderer's back (another window, a race). */
    setRows(changed: PlacementSummary[]) {
      rows = changed;
    },
    /** Where a project's building stands, as "x,y", or null. */
    at: (projectId: string) => {
      const row = rows.find((r) => r.target.id === projectId);
      return row === undefined ? null : `${String(row.tileX)},${String(row.tileY)}`;
    },
    async place(project: { id: string; name: string }, gx: number, gy: number) {
      tool.startPlacing(project);
      tool.pointAt({ gx, gy });
      await tool.commit();
    },
    async move(project: { id: string; name: string }, gx: number, gy: number) {
      tool.startMoving(project);
      tool.pointAt({ gx, gy });
      await tool.commit();
    },
  };
}

describe('placement history', () => {
  it('starts empty: nothing to undo or redo, and both do nothing', async () => {
    const t = setup();
    expect(t.history.store.get()).toEqual({
      undoLabel: null,
      redoLabel: null,
      busy: false,
      message: null,
    });
    expect(await t.history.undo()).toBeNull();
    expect(await t.history.redo()).toBeNull();
    expect(t.api.placement.remove).not.toHaveBeenCalled();
  });

  it('place → undo removes it with the expected revision → redo places it again', async () => {
    const t = setup();
    await t.placements.refresh();
    await t.place(ALPHA, 3, 4);
    expect(t.history.store.get().undoLabel).toBe('place “Alpha”');

    const undone = await t.history.undo();
    expect(t.api.placement.remove).toHaveBeenLastCalledWith({
      worldId: WORLD.id,
      placementId: 'b1',
      expectedRevision: 1,
    });
    expect(undone?.ok).toBe(true);
    expect(undone?.text).toContain('The project is kept');
    expect(t.at(ALPHA.id)).toBeNull();
    expect(t.placements.store.get().placements).toHaveLength(0);
    expect(t.history.store.get()).toMatchObject({ undoLabel: null, redoLabel: 'place “Alpha”' });

    const redone = await t.history.redo();
    expect(redone).toEqual({ ok: true, text: 'Redone: “Alpha” is on the map again at tile 3, 4.' });
    expect(t.at(ALPHA.id)).toBe('3,4');
    expect(t.history.store.get()).toMatchObject({ undoLabel: 'place “Alpha”', redoLabel: null });
  });

  it('move → undo moves it back → redo moves it again, each with the current revision', async () => {
    const t = setup([summary('b0', ALPHA.id, 2, 2)]);
    await t.placements.refresh();
    await t.move(ALPHA, 8, 8);
    expect(t.at(ALPHA.id)).toBe('8,8');

    expect((await t.history.undo())?.text).toBe('Undone: “Alpha” is back at tile 2, 2.');
    expect(t.api.placement.move).toHaveBeenLastCalledWith({
      worldId: WORLD.id,
      placementId: 'b0',
      expectedRevision: 2,
      tileX: 2,
      tileY: 2,
      rotation: 0,
    });
    expect(t.at(ALPHA.id)).toBe('2,2');

    expect((await t.history.redo())?.ok).toBe(true);
    expect(t.api.placement.move).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedRevision: 3, tileX: 8, tileY: 8 }),
    );
    expect(t.at(ALPHA.id)).toBe('8,8');
  });

  it('remove → undo places it again at the same tile and rotation → redo removes the new one', async () => {
    const t = setup([{ ...summary('b0', ALPHA.id, 5, 6), rotation: 90 }]);
    await t.placements.refresh();
    await t.tool.remove(ALPHA);
    expect(t.at(ALPHA.id)).toBeNull();

    expect((await t.history.undo())?.text).toBe('Undone: “Alpha” is back on the map at tile 5, 6.');
    expect(t.api.placement.create).toHaveBeenLastCalledWith({
      worldId: WORLD.id,
      projectId: ALPHA.id,
      tileX: 5,
      tileY: 6,
      rotation: 90,
    });
    // Placed again under a new ID; redo must remove that one, not the old ID.
    expect(t.rows()[0]?.id).toBe('b1');
    await t.history.redo();
    expect(t.api.placement.remove).toHaveBeenLastCalledWith(
      expect.objectContaining({ placementId: 'b1', expectedRevision: 1 }),
    );
    expect(t.at(ALPHA.id)).toBeNull();
  });

  it('a whole chain undoes and redoes without false conflicts (new IDs and revisions carry over)', async () => {
    const t = setup();
    await t.placements.refresh();
    await t.place(ALPHA, 2, 2);
    await t.move(ALPHA, 8, 8);
    await t.tool.remove(ALPHA);

    for (let i = 0; i < 3; i += 1) expect((await t.history.undo())?.ok).toBe(true);
    expect(t.at(ALPHA.id)).toBeNull();
    for (let i = 0; i < 3; i += 1) expect((await t.history.redo())?.ok).toBe(true);
    expect(t.at(ALPHA.id)).toBeNull();
    for (let i = 0; i < 2; i += 1) expect((await t.history.undo())?.ok).toBe(true);
    expect(t.at(ALPHA.id)).toBe('2,2');
  });

  it('a revision conflict drops that step with a clear message and forces nothing', async () => {
    const t = setup([summary('b0', ALPHA.id, 2, 2)]);
    await t.placements.refresh();
    await t.move(ALPHA, 8, 8);
    // Someone else moved it again.
    t.setRows(t.rows().map((r) => ({ ...r, tileX: 12, tileY: 12, revision: 9 })));

    const message = await t.history.undo();
    expect(message).toEqual({
      ok: false,
      text: "Couldn't undo move “Alpha”: this building changed since then. That step was dropped; nothing was changed or forced.",
    });
    expect(t.at(ALPHA.id)).toBe('12,12');
    expect(t.api.placement.move).toHaveBeenCalledTimes(2);
    expect(t.history.store.get()).toMatchObject({ undoLabel: null, redoLabel: null });
    // The map was reloaded so it shows the real spot.
    expect(t.placements.store.get().placements[0]?.tileX).toBe(12);
  });

  it('an occupied tile drops the step: undoing a remove never pushes another building aside', async () => {
    const t = setup([summary('b0', ALPHA.id, 5, 5)]);
    await t.placements.refresh();
    await t.tool.remove(ALPHA);
    t.setRows([summary('x9', BETA.id, 5, 5)]); // placed from another window
    const message = await t.history.undo();
    expect(message?.ok).toBe(false);
    expect(message?.text).toBe(
      "Couldn't undo remove “Alpha” from the map: another building stands there now. That step was dropped; nothing was changed or forced.",
    );
    expect(t.rows()).toEqual([summary('x9', BETA.id, 5, 5)]);
    expect(t.history.store.get().undoLabel).toBeNull();
  });

  it('when undo gets no answer, the step is dropped and never sent again', async () => {
    const t = setup();
    await t.placements.refresh();
    await t.place(ALPHA, 3, 3);
    t.api.placement.remove.mockRejectedValueOnce(new Error('ipc gone'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await t.history.undo()).toEqual({ ok: false, text: HISTORY_UNKNOWN_OUTCOME });
    expect(t.history.store.get()).toMatchObject({ busy: false, undoLabel: null, redoLabel: null });
    expect(await t.history.undo()).toBeNull();
    expect(t.api.placement.remove).toHaveBeenCalledTimes(1);
  });

  it('only one undo runs at a time, and the tool sends nothing meanwhile', async () => {
    const t = setup();
    await t.placements.refresh();
    await t.place(ALPHA, 3, 3);
    await t.place(BETA, 9, 9);

    const first = t.history.undo();
    expect(t.history.store.get().busy).toBe(true);
    expect(await t.history.undo()).toBeNull();
    expect(await t.tool.remove(ALPHA)).toEqual({ ok: false, text: HISTORY_BUSY });
    await first;
    expect(t.api.placement.remove).toHaveBeenCalledTimes(1);
    expect(t.history.store.get().undoLabel).toBe('place “Alpha”');
  });

  it('a new change clears redo; refused and cancelled tool actions record nothing', async () => {
    const t = setup([summary('b0', 'p-other', 3, 3)]);
    await t.placements.refresh();
    await t.place(ALPHA, 8, 8);
    await t.history.undo();
    expect(t.history.store.get().redoLabel).toBe('place “Alpha”');

    // Refused by the preview, cancelled, and a no-op drop: none of these is a change.
    await t.place(BETA, 3, 3);
    t.tool.cancel();
    await t.move({ id: 'p-other', name: 'Other' }, 3, 3);
    expect(t.history.store.get()).toMatchObject({ undoLabel: null, redoLabel: 'place “Alpha”' });

    await t.place(BETA, 12, 12);
    expect(t.history.store.get()).toMatchObject({ undoLabel: 'place “Beta”', redoLabel: null });
  });

  it(`keeps at most ${String(MAX_HISTORY)} steps, forgetting the oldest`, async () => {
    const t = setup([summary('b0', ALPHA.id, 0, 0)]);
    await t.placements.refresh();
    for (let i = 1; i <= MAX_HISTORY + 2; i += 1) await t.move(ALPHA, i % 2 === 0 ? 0 : 4, 0);
    let undone = 0;
    while ((await t.history.undo()) !== null) undone += 1;
    expect(undone).toBe(MAX_HISTORY);
  });

  it('clear forgets everything (a world or profile switch starts empty)', async () => {
    const t = setup();
    await t.placements.refresh();
    await t.place(ALPHA, 3, 3);
    await t.history.undo();
    await t.place(BETA, 9, 9);
    t.history.clear();
    expect(t.history.store.get()).toMatchObject({ undoLabel: null, redoLabel: null });
    expect(await t.history.undo()).toBeNull();
  });
});
