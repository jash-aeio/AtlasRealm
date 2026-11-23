import { describe, expect, it, vi } from 'vitest';

import type { IpcResult } from '../../src/common/contracts/ipc-result';
import type { PlacementListOutput, PlacementSummary } from '../../src/common/contracts/placement';
import { createProjectSelection } from '../../src/renderer/state/selection';
import { createWorldPlacements, placedProjectIds } from '../../src/renderer/world/world-placements';

const WORLD = '00000000-0000-4000-8000-000000000001';

function placement(id: string, target: PlacementSummary['target']): PlacementSummary {
  return {
    id,
    worldId: WORLD,
    target,
    projectStatus: target.type === 'project' ? 'active' : null,
    projectName: target.type === 'project' ? `Project ${target.id}` : null,
    appearanceId: 'placeholder.building.2x2',
    footprint: { columns: 2, rows: 2 },
    tileX: 0,
    tileY: 0,
    rotation: 0,
    createdAt: '2026-11-22T10:00:00.000Z',
    updatedAt: '2026-11-22T10:00:00.000Z',
    revision: 1,
  };
}

const ok = (placements: PlacementSummary[]): IpcResult<PlacementListOutput> => ({
  ok: true,
  data: { placements },
});
const failed: IpcResult<PlacementListOutput> = {
  ok: false,
  error: { code: 'internal_error', message: 'The database is busy.' },
};

describe('world placements store', () => {
  it('starts loading, then holds what placement.list returned for that world', async () => {
    const list = vi.fn(() => Promise.resolve(ok([placement('a', { type: 'project', id: 'p1' })])));
    const store = createWorldPlacements({ placement: { list } }, WORLD);
    expect(store.store.get().status).toBe('loading');
    await store.refresh();
    expect(list).toHaveBeenCalledWith({ worldId: WORLD });
    expect(store.store.get()).toMatchObject({ status: 'ready', error: null });
    expect(store.store.get().placements.map((p) => p.id)).toEqual(['a']);
  });

  it('a failed first read is an error; a failed refresh keeps the last good list', async () => {
    const list = vi.fn().mockResolvedValueOnce(failed);
    const store = createWorldPlacements({ placement: { list } }, WORLD);
    await store.refresh();
    expect(store.store.get()).toMatchObject({ status: 'error', placements: [] });

    list.mockResolvedValueOnce(ok([placement('a', { type: 'project', id: 'p1' })]));
    await store.refresh();
    list.mockResolvedValueOnce(failed);
    await store.refresh();
    expect(store.store.get().status).toBe('ready');
    expect(store.store.get().placements).toHaveLength(1);
    expect(store.store.get().error?.code).toBe('internal_error');
  });

  it('ignores an answer that arrives after a newer request started', async () => {
    let answerFirst: (value: IpcResult<PlacementListOutput>) => void = () => undefined;
    const list = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(ok([]));
    const store = createWorldPlacements({ placement: { list } }, WORLD);
    const first = store.refresh();
    await store.refresh();
    answerFirst(ok([placement('stale', { type: 'project', id: 'p1' })]));
    await first;
    expect(store.store.get().placements).toEqual([]);
  });

  it('placedProjectIds lists projects with a building, not service structures', async () => {
    const list = vi.fn(() =>
      Promise.resolve(
        ok([
          placement('a', { type: 'project', id: 'p1' }),
          placement('b', { type: 'service', id: 'skill-library' }),
        ]),
      ),
    );
    const store = createWorldPlacements({ placement: { list } }, WORLD);
    await store.refresh();
    expect([...placedProjectIds(store.store.get())]).toEqual(['p1']);
  });
});

describe('project selection', () => {
  it('holds one project ID and clears; selecting the same ID again does not notify', () => {
    const selection = createProjectSelection();
    const listener = vi.fn();
    selection.projectId.subscribe(listener);
    selection.select('p1');
    selection.select('p1');
    expect(selection.projectId.get()).toBe('p1');
    expect(listener).toHaveBeenCalledTimes(1);
    selection.clear();
    expect(selection.projectId.get()).toBeNull();
  });
});
