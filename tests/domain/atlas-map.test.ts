// The Realm Atlas Map's geometry and the renderer store for the Atlas display preferences
// (M2-12 #77). The Map is derived from saved placements only; the store shows changes at once
// and debounces width saves while the resize handle is dragged.
import { describe, expect, it, vi } from 'vitest';

import type { IpcResult } from '../../src/common/contracts/ipc-result';
import type { PlacementSummary } from '../../src/common/contracts/placement';
import type {
  ProfileAtlasViewOutput,
  ProfileAtlasViewUpdateInput,
} from '../../src/common/contracts/profile';
import { type AtlasViews, DEFAULT_ATLAS_VIEW } from '../../src/common/preferences/atlas-view';
import {
  createAtlasViewPreferences,
  viewOf,
  WIDTH_SAVE_DELAY_MS,
} from '../../src/renderer/atlas/atlas-views';
import {
  clippedViewport,
  mapBuildings,
  mapCorners,
  mapViewBox,
  polygonPoints,
  rectCentre,
} from '../../src/renderer/atlas/map-geometry';
import type { Timers } from '../../src/renderer/world/comfort';

const WORLD_A = '11111111-1111-4111-8111-111111111111';
const WORLD_B = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const map = { columns: 64, rows: 64 };

function placement(overrides: Partial<PlacementSummary> = {}): PlacementSummary {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    worldId: WORLD_A,
    target: { type: 'project', id: PROJECT },
    projectName: 'Garden',
    projectStatus: 'active',
    appearanceId: 'placeholder.building.2x2',
    tileX: 10,
    tileY: 4,
    rotation: 0,
    footprint: { columns: 2, rows: 3 },
    createdAt: '2026-11-23T00:00:00.000Z',
    updatedAt: '2026-11-23T00:00:00.000Z',
    revision: 1,
    ...overrides,
  };
}

describe('Map geometry', () => {
  it('draws the map as the diamond of its four corner tiles', () => {
    expect(mapCorners(map)).toEqual([
      { x: 0, y: 0 },
      { x: 2048, y: 1024 },
      { x: 0, y: 2048 },
      { x: -2048, y: 1024 },
    ]);
  });

  it('fits the viewBox to the map with a small margin', () => {
    expect(mapViewBox(map, 0)).toBe('-2048 0 4096 2048');
    expect(mapViewBox(map, 0.5)).toBe('-4096 -2048 8192 6144');
  });

  it('turns each saved placement into a footprint shape, rotation included', () => {
    const [building] = mapBuildings([placement({ rotation: 90 })]);
    // Turned 90°, a 2 × 3 footprint covers 3 columns and 2 rows.
    expect(building?.rect).toEqual({ x: 10, y: 4, columns: 3, rows: 2 });
    expect(building?.corners[0]).toEqual({ x: 192, y: 224 });
    expect(building?.centre).toEqual(rectCentre({ x: 10, y: 4, columns: 3, rows: 2 }));
    expect(building?.projectId).toBe(PROJECT);
    expect(building?.archived).toBe(false);
  });

  it('marks archived projects and service structures', () => {
    const [archived, service] = mapBuildings([
      placement({ projectStatus: 'archived' }),
      placement({
        id: 'svc',
        target: { type: 'service', id: 'guild' } as never,
        projectName: null,
      }),
    ]);
    expect(archived?.archived).toBe(true);
    expect(service?.projectId).toBeNull();
  });

  it('writes polygon points as SVG text', () => {
    expect(
      polygonPoints([
        { x: 1, y: 2 },
        { x: 3.5, y: -4 },
      ]),
    ).toBe('1,2 3.5,-4');
  });

  it('clips the viewport to the map, or gives null when it shows none of it', () => {
    expect(clippedViewport({ left: -5000, top: -10, right: 100, bottom: 50 }, map)).toEqual({
      left: -2048,
      top: 0,
      right: 100,
      bottom: 50,
    });
    expect(clippedViewport({ left: 3000, top: 0, right: 4000, bottom: 100 }, map)).toBeNull();
  });
});

const ok = (views: AtlasViews): IpcResult<ProfileAtlasViewOutput> => ({
  ok: true,
  data: { views },
});
const failed: IpcResult<ProfileAtlasViewOutput> = {
  ok: false,
  error: { code: 'internal_error', message: 'The database is busy.' },
};

function manualTimers() {
  let next: (() => void) | null = null;
  const timers: Timers = {
    setTimeout: vi.fn((run: () => void) => {
      next = run;
      return run;
    }),
    clearTimeout: vi.fn(() => {
      next = null;
    }),
  };
  return {
    timers,
    fire() {
      const run = next;
      next = null;
      run?.();
    },
    pending: () => next !== null,
  };
}

function setup(get = vi.fn(() => Promise.resolve(ok({})))) {
  const update = vi.fn<
    (input: ProfileAtlasViewUpdateInput) => Promise<IpcResult<ProfileAtlasViewOutput>>
  >(() => Promise.resolve(ok({})));
  const clock = manualTimers();
  const prefs = createAtlasViewPreferences({ atlasView: { get, update } }, clock.timers);
  return { prefs, get, update, clock };
}

describe('createAtlasViewPreferences', () => {
  it('reads the saved views and gives defaults for a world with none', async () => {
    const saved = { [WORLD_A]: { ...DEFAULT_ATLAS_VIEW, collapsed: true } };
    const { prefs } = setup(vi.fn(() => Promise.resolve(ok(saved))));
    expect(prefs.store.get().status).toBe('loading');
    await prefs.load();
    expect(viewOf(prefs.store.get(), WORLD_A).collapsed).toBe(true);
    expect(viewOf(prefs.store.get(), WORLD_B)).toEqual(DEFAULT_ATLAS_VIEW);
  });

  it('shows a change at once and saves it for that world', async () => {
    const { prefs, update } = setup();
    const saving = prefs.change(WORLD_A, { tab: 'connections' });
    expect(viewOf(prefs.store.get(), WORLD_A).tab).toBe('connections');
    await saving;
    expect(update).toHaveBeenCalledWith({ worldId: WORLD_A, change: { tab: 'connections' } });
    // The reply (an empty set of views) does not overwrite the store.
    expect(viewOf(prefs.store.get(), WORLD_A).tab).toBe('connections');
  });

  it('debounces width saves while dragging', async () => {
    const { prefs, update, clock } = setup();
    await prefs.change(WORLD_A, { width: 300 });
    await prefs.change(WORLD_A, { width: 340 });
    await prefs.change(WORLD_A, { width: 380 });
    expect(viewOf(prefs.store.get(), WORLD_A).width).toBe(380);
    expect(update).not.toHaveBeenCalled();
    expect(clock.timers.setTimeout).toHaveBeenLastCalledWith(
      expect.any(Function),
      WIDTH_SAVE_DELAY_MS,
    );
    clock.fire();
    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledTimes(1);
    });
    expect(update).toHaveBeenCalledWith({ worldId: WORLD_A, change: { width: 380 } });
  });

  it('sends a waiting width with the next change for the same world', async () => {
    const { prefs, update, clock } = setup();
    await prefs.change(WORLD_A, { width: 400 });
    await prefs.change(WORLD_A, { collapsed: true });
    expect(clock.pending()).toBe(false);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      worldId: WORLD_A,
      change: { width: 400, collapsed: true },
    });
  });

  it("saves another world's waiting width on its own", async () => {
    const { prefs, update } = setup();
    await prefs.change(WORLD_A, { width: 400 });
    await prefs.change(WORLD_B, { expanded: true });
    expect(update.mock.calls).toEqual([
      [{ worldId: WORLD_A, change: { width: 400 } }],
      [{ worldId: WORLD_B, change: { expanded: true } }],
    ]);
  });

  it('flush saves a waiting width straight away', async () => {
    const { prefs, update, clock } = setup();
    await prefs.change(WORLD_A, { width: 500 });
    await prefs.flush();
    expect(clock.pending()).toBe(false);
    expect(update).toHaveBeenCalledWith({ worldId: WORLD_A, change: { width: 500 } });
  });

  it('on a failed save shows the problem and the values really saved', async () => {
    const saved = { [WORLD_A]: { ...DEFAULT_ATLAS_VIEW, followSelection: false } };
    const get = vi.fn(() => Promise.resolve(ok(saved)));
    const { prefs, update } = setup(get);
    update.mockResolvedValueOnce(failed);
    await prefs.change(WORLD_A, { followSelection: true });
    expect(prefs.store.get().error?.code).toBe('internal_error');
    expect(viewOf(prefs.store.get(), WORLD_A).followSelection).toBe(false);
    // The next success clears the message.
    await prefs.change(WORLD_A, { tab: 'connections' });
    expect(prefs.store.get().error).toBeNull();
  });

  it('a failed first read keeps the defaults and says so', async () => {
    const { prefs } = setup(vi.fn(() => Promise.resolve(failed)));
    await prefs.load();
    expect(prefs.store.get().status).toBe('error');
    expect(viewOf(prefs.store.get(), WORLD_A)).toEqual(DEFAULT_ATLAS_VIEW);
  });
});
