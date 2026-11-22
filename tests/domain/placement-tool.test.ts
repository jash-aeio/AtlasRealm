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
  anchorForPointer,
  createPlacementTool,
  previewOf,
  type PlacementToolApi,
  UNKNOWN_OUTCOME,
} from '../../src/renderer/world/placement-tool';
import { createWorldPlacements } from '../../src/renderer/world/world-placements';

// M2-7 (#72): the placement tool's state machine, preview and commands, against a fake API that
// keeps its buildings in memory (so `refresh` sees what the commands changed).

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

/** A fake main process: an in-memory list, with every command recorded and overridable. */
function setup(initial: PlacementSummary[] = []) {
  let rows = [...initial];
  let next = 1;
  const ok = (placement: PlacementSummary): IpcResult<PlacementOutput> => ({
    ok: true,
    data: { placement },
  });
  const api = {
    placement: {
      list: vi.fn((): Promise<IpcResult<PlacementListOutput>> =>
        Promise.resolve({ ok: true, data: { placements: rows } }),
      ),
      create: vi.fn((input: PlacementCreateInput): Promise<IpcResult<PlacementOutput>> => {
        const created = summary(`b${String(next++)}`, input.projectId, input.tileX, input.tileY);
        rows = [...rows, created];
        return Promise.resolve(ok(created));
      }),
      move: vi.fn((input: PlacementMoveInput): Promise<IpcResult<PlacementOutput>> => {
        const found = rows.find((r) => r.id === input.placementId);
        if (found === undefined) throw new Error('no such building');
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
        if (found === undefined) throw new Error('no such building');
        rows = rows.filter((r) => r.id !== input.placementId);
        return Promise.resolve(ok(found));
      }),
    },
  };
  const placements = createWorldPlacements(api, WORLD.id);
  const tool = createPlacementTool(api satisfies PlacementToolApi, WORLD, placements, TWO);
  return {
    api,
    placements,
    tool,
    rows: () => rows,
    /** Changes the saved buildings behind the renderer's back (another window, a race). */
    setRows(next: PlacementSummary[]) {
      rows = next;
    },
    preview: () => previewOf(tool.store.get(), WORLD, placements.store.get().placements),
  };
}

describe('placement tool', () => {
  it('puts the pointer on the footprint middle (north tile for an even side)', () => {
    expect(anchorForPointer({ gx: 5, gy: 5 }, TWO)).toEqual({ tileX: 5, tileY: 5 });
    expect(anchorForPointer({ gx: 5, gy: 5 }, { columns: 3, rows: 3 })).toEqual({
      tileX: 4,
      tileY: 4,
    });
  });

  it('starts placing on the nearest free plot to the centre and previews it as fitting', async () => {
    const t = setup([summary('b0', 'p-other', 8, 8)]);
    await t.placements.refresh();
    t.tool.startPlacing(ALPHA);
    const state = t.tool.store.get();
    expect(state.mode.kind).toBe('placing');
    expect(t.preview()?.check.kind).toBe('ok');
    expect(t.preview()?.label).toBe('Fits here');
    expect(state.anchor).not.toEqual({ tileX: 8, tileY: 8 });
  });

  it('a click on a free tile places through placement.create and leaves the tool', async () => {
    const t = setup();
    await t.placements.refresh();
    t.tool.startPlacing(ALPHA);
    t.tool.pointAt({ gx: 3, gy: 4 });
    const message = await t.tool.commit();
    expect(t.api.placement.create).toHaveBeenCalledWith({
      worldId: WORLD.id,
      projectId: ALPHA.id,
      tileX: 3,
      tileY: 4,
      rotation: 0,
    });
    expect(message).toEqual({ ok: true, text: 'Placed “Alpha” at tile 3, 4.' });
    expect(t.tool.store.get().mode.kind).toBe('idle');
    expect(t.placements.store.get().placements).toHaveLength(1);
  });

  it('a red preview is refused with a text reason and sends nothing', async () => {
    const t = setup([summary('b0', 'p-other', 3, 3)]);
    await t.placements.refresh();
    t.tool.startPlacing(ALPHA);
    t.tool.pointAt({ gx: 4, gy: 4 });
    expect(t.preview()?.label).toBe('Blocked: another building is in the way');
    t.tool.pointAt({ gx: 15, gy: 15 });
    expect(t.preview()?.label).toBe('Blocked: part of it would be off the map');
    const message = await t.tool.commit();
    expect(message?.ok).toBe(false);
    expect(message?.text).toContain('the whole building must fit inside the world');
    expect(t.api.placement.create).not.toHaveBeenCalled();
    expect(t.tool.store.get().mode.kind).toBe('placing');
  });

  it('when the command refuses, the message is shown, nothing changes and the tool stays open', async () => {
    const t = setup();
    await t.placements.refresh();
    t.tool.startPlacing(ALPHA);
    t.tool.pointAt({ gx: 3, gy: 3 });
    // Someone else placed a building there after we read the list: the preview still says ok.
    t.setRows([summary('b9', 'p-other', 3, 3)]);
    t.api.placement.create.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'placement_blocked',
        message: 'Blocked.',
        placement: { reason: 'overlaps', blockingIds: ['b9'] },
      },
    });
    const message = await t.tool.commit();
    expect(message).toEqual({
      ok: false,
      text: "It can't stand there: another building is in the way. Nothing was changed.",
    });
    expect(t.tool.store.get().mode.kind).toBe('placing');
    // The map was reloaded, so the preview now shows the building that is really there.
    expect(t.preview()?.check.kind).toBe('overlaps');
  });

  it('moves a building by dropping it on a free spot', async () => {
    const t = setup([summary('b0', ALPHA.id, 2, 2)]);
    await t.placements.refresh();
    t.tool.startMoving(ALPHA);
    expect(t.tool.store.get().anchor).toEqual({ tileX: 2, tileY: 2 });
    // Overlapping its own old tiles is fine.
    t.tool.pointAt({ gx: 3, gy: 2 });
    expect(t.preview()?.check.kind).toBe('ok');
    t.tool.pointAt({ gx: 10, gy: 6 });
    const message = await t.tool.commit();
    expect(t.api.placement.move).toHaveBeenCalledWith({
      worldId: WORLD.id,
      placementId: 'b0',
      expectedRevision: 1,
      tileX: 10,
      tileY: 6,
      rotation: 0,
    });
    expect(message).toEqual({ ok: true, text: 'Moved “Alpha” to tile 10, 6.' });
    expect(t.rows()[0]).toMatchObject({ tileX: 10, tileY: 6 });
  });

  it('an invalid drop keeps the saved location and sends nothing', async () => {
    const t = setup([summary('b0', ALPHA.id, 2, 2), summary('b1', BETA.id, 8, 8)]);
    await t.placements.refresh();
    t.tool.startMoving(ALPHA);
    t.tool.pointAt({ gx: 6, gy: 6 });
    t.tool.pointAt({ gx: 8, gy: 9 });
    const message = await t.tool.commit();
    expect(message).toEqual({
      ok: false,
      text: 'Not moved: another building is in the way. It stays at tile 2, 2.',
    });
    expect(t.api.placement.move).not.toHaveBeenCalled();
    expect(t.rows()[0]).toMatchObject({ tileX: 2, tileY: 2 });
  });

  it('a move refused for a stale revision reloads the map and leaves the tool', async () => {
    const t = setup([summary('b0', ALPHA.id, 2, 2)]);
    await t.placements.refresh();
    t.tool.startMoving(ALPHA);
    t.tool.pointAt({ gx: 9, gy: 9 });
    t.api.placement.move.mockResolvedValueOnce({
      ok: false,
      error: { code: 'revision_conflict', message: 'Changed.', currentRevision: 2 },
    });
    const message = await t.tool.commit();
    expect(message?.text).toContain('changed somewhere else');
    expect(t.tool.store.get().mode.kind).toBe('idle');
    expect(t.api.placement.list).toHaveBeenCalledTimes(2);
  });

  it('dropping a building where it already is changes nothing', async () => {
    const t = setup([summary('b0', ALPHA.id, 2, 2)]);
    await t.placements.refresh();
    t.tool.startMoving(ALPHA);
    const message = await t.tool.commit();
    expect(message?.text).toBe('“Alpha” stays at tile 2, 2.');
    expect(t.api.placement.move).not.toHaveBeenCalled();
  });

  it('arrow keys move the preview but keep the footprint on the map', async () => {
    const t = setup();
    await t.placements.refresh();
    t.tool.startPlacing(ALPHA);
    t.tool.pointAt({ gx: 0, gy: 0 });
    t.tool.nudge(-1, 0);
    expect(t.tool.store.get().anchor).toEqual({ tileX: 0, tileY: 0 });
    t.tool.pointAt({ gx: 14, gy: 14 });
    t.tool.nudge(1, 1);
    expect(t.tool.store.get().anchor).toEqual({ tileX: 14, tileY: 14 });
    t.tool.nudge(-2, 0);
    expect(t.tool.store.get().anchor).toEqual({ tileX: 12, tileY: 14 });
  });

  it('Escape (cancel) saves nothing and the project stays unplaced', async () => {
    const t = setup();
    await t.placements.refresh();
    t.tool.startPlacing(ALPHA);
    t.tool.cancel();
    expect(t.tool.store.get()).toMatchObject({
      mode: { kind: 'idle' },
      anchor: null,
      message: { ok: true, text: 'Placement cancelled. Nothing was changed.' },
    });
    expect(t.api.placement.create).not.toHaveBeenCalled();
    expect(t.rows()).toHaveLength(0);
  });

  it('auto-place saves the nearest free plot to the centre and says so', async () => {
    const t = setup([summary('b0', 'p-other', 8, 8)]);
    await t.placements.refresh();
    const message = await t.tool.autoPlace(ALPHA);
    const call = t.api.placement.create.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(message.ok).toBe(true);
    expect(message.text).toMatch(/^Placed “Alpha” at tile \d+, \d+, the nearest free spot\.$/);
    // The plot is free, and no free plot is nearer the centre (every ring-1 anchor overlaps b0).
    expect(call?.tileX === 8 && call.tileY === 8).toBe(false);
    expect(Math.max(Math.abs((call?.tileX ?? 0) - 8), Math.abs((call?.tileY ?? 0) - 8))).toBe(2);
  });

  it('auto-place says so when the world is full and changes nothing', async () => {
    // 16 × 16 filled with 2 × 2 buildings.
    const full: PlacementSummary[] = [];
    for (let y = 0; y < 16; y += 2) {
      for (let x = 0; x < 16; x += 2)
        full.push(summary(`b${String(x)}-${String(y)}`, `p${String(x)}-${String(y)}`, x, y));
    }
    const t = setup(full);
    await t.placements.refresh();
    const message = await t.tool.autoPlace(ALPHA);
    expect(message.ok).toBe(false);
    expect(message.text).toContain('No free spot is big enough');
    expect(message.text).toContain('“Alpha” is unchanged');
    expect(t.api.placement.create).not.toHaveBeenCalled();
  });

  it('remove takes the building away and says the project is kept', async () => {
    const t = setup([summary('b0', ALPHA.id, 2, 2)]);
    await t.placements.refresh();
    const message = await t.tool.remove(ALPHA);
    expect(t.api.placement.remove).toHaveBeenCalledWith({
      worldId: WORLD.id,
      placementId: 'b0',
      expectedRevision: 1,
    });
    expect(message.text).toContain(
      'The project and its files are kept, no runs were stopped or deleted',
    );
    expect(t.placements.store.get().placements).toHaveLength(0);
  });

  it('refuses to place a project twice or to move one that has no building', async () => {
    const t = setup([summary('b0', ALPHA.id, 2, 2)]);
    await t.placements.refresh();
    t.tool.startPlacing(ALPHA);
    expect(t.tool.store.get().mode.kind).toBe('idle');
    expect(t.tool.store.get().message?.text).toContain('already has a building');
    t.tool.startMoving(BETA);
    expect(t.tool.store.get().mode.kind).toBe('idle');
    expect(t.tool.store.get().message?.text).toContain('has no building to move');
  });

  it('a command with no answer reports an unknown outcome, reloads and is not retried', async () => {
    const t = setup();
    await t.placements.refresh();
    t.tool.startPlacing(ALPHA);
    t.tool.pointAt({ gx: 3, gy: 3 });
    t.api.placement.create.mockRejectedValueOnce(new Error('No handler registered'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const message = await t.tool.commit();
    error.mockRestore();
    expect(message).toEqual({ ok: false, text: UNKNOWN_OUTCOME });
    expect(t.tool.store.get()).toMatchObject({ mode: { kind: 'idle' }, busy: false });
    expect(t.api.placement.create).toHaveBeenCalledTimes(1);
    expect(t.api.placement.list).toHaveBeenCalledTimes(2);
    // The tool still works afterwards.
    expect((await t.tool.autoPlace(ALPHA)).ok).toBe(true);
  });

  it('removing or auto-placing another project keeps the open session for this one', async () => {
    const t = setup([summary('b1', BETA.id, 2, 2)]);
    await t.placements.refresh();
    t.tool.startPlacing(ALPHA);
    t.tool.pointAt({ gx: 9, gy: 9 });
    const removed = await t.tool.remove(BETA);
    expect(removed.ok).toBe(true);
    expect(t.tool.store.get()).toMatchObject({
      mode: { kind: 'placing', project: ALPHA },
      anchor: { tileX: 9, tileY: 9 },
      busy: false,
      message: removed,
    });
    expect((await t.tool.autoPlace(BETA)).ok).toBe(true);
    expect(t.tool.store.get().mode.kind).toBe('placing');
  });

  it('starting a session over another says the first one was stopped and nothing was saved', async () => {
    const t = setup([summary('b1', BETA.id, 2, 2)]);
    await t.placements.refresh();
    t.tool.startPlacing(ALPHA);
    t.tool.startMoving(BETA);
    expect(t.tool.store.get()).toMatchObject({
      mode: { kind: 'moving', project: BETA },
      message: { ok: true, text: 'Stopped placing “Alpha”; nothing was saved for it.' },
    });
    expect(t.api.placement.create).not.toHaveBeenCalled();
  });

  it('ignores a second commit while the first is on its way', async () => {
    const t = setup();
    await t.placements.refresh();
    t.tool.startPlacing(ALPHA);
    t.tool.pointAt({ gx: 3, gy: 3 });
    const first = t.tool.commit();
    const second = await t.tool.commit();
    await first;
    expect(second).toBeNull();
    expect(t.api.placement.create).toHaveBeenCalledTimes(1);
  });
});
