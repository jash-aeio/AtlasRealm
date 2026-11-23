// The renderer comfort store (M2-14 #79): toggles, the debounced camera save and the camera
// math for saving and restoring a view.
import { describe, expect, it, vi } from 'vitest';

import type { IpcResult } from '../../src/common/contracts/ipc-result';
import type { ProfilePreferencesOutput } from '../../src/common/contracts/profile';
import {
  type ComfortPreferences,
  DEFAULT_COMFORT,
  ZOOM_MAX,
} from '../../src/common/preferences/comfort';
import {
  CAMERA_SAVE_DELAY_MS,
  cameraToSaved,
  createComfort,
  mapWorldBounds,
  resolveReducedMotion,
  savedToCamera,
  type Timers,
} from '../../src/renderer/world/comfort';
import { centeredCamera, DEFAULT_MAP, screenToWorld } from '../../src/renderer/world/projection';

const WORLD_A = '11111111-1111-4111-8111-111111111111';
const WORLD_B = '22222222-2222-4222-8222-222222222222';
const camera = { centerX: 10, centerY: 20, zoom: 1 };

const ok = (preferences: ComfortPreferences): IpcResult<ProfilePreferencesOutput> => ({
  ok: true,
  data: { preferences },
});
const failed: IpcResult<ProfilePreferencesOutput> = {
  ok: false,
  error: { code: 'internal_error', message: 'The database is busy.' },
};

/** Timers the test runs by hand. */
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

function setup(get = vi.fn(() => Promise.resolve(ok(DEFAULT_COMFORT)))) {
  const update = vi.fn(() => Promise.resolve(ok(DEFAULT_COMFORT)));
  const clock = manualTimers();
  const comfort = createComfort({ preferences: { get, update } }, clock.timers);
  return { comfort, get, update, clock };
}

describe('comfort store', () => {
  it('starts with the defaults while loading, then holds the saved preferences', async () => {
    const saved = { ...DEFAULT_COMFORT, buildingLabels: false };
    const { comfort } = setup(vi.fn(() => Promise.resolve(ok(saved))));
    expect(comfort.store.get()).toMatchObject({ status: 'loading', preferences: DEFAULT_COMFORT });
    await comfort.load();
    expect(comfort.store.get()).toEqual({ status: 'ready', preferences: saved, error: null });
  });

  it('a failed first read is an error, and the defaults still apply', async () => {
    const { comfort } = setup(vi.fn(() => Promise.resolve(failed)));
    await comfort.load();
    expect(comfort.store.get()).toMatchObject({
      status: 'error',
      preferences: DEFAULT_COMFORT,
      error: { code: 'internal_error' },
    });
  });

  it('a toggle changes the store at once and saves just that field', async () => {
    const { comfort, update } = setup();
    const saving = comfort.setBuildingLabels(false);
    expect(comfort.store.get().preferences.buildingLabels).toBe(false);
    await saving;
    expect(update).toHaveBeenCalledWith({ buildingLabels: false });
    await comfort.setReducedMotion('on');
    expect(update).toHaveBeenLastCalledWith({ reducedMotion: 'on' });
    expect(comfort.store.get().preferences.reducedMotion).toBe('on');
  });

  it('replies never overwrite a newer local change', async () => {
    const { comfort, update } = setup();
    // The reply to the first click says "true"; the second click has already set false.
    update.mockResolvedValueOnce(ok({ ...DEFAULT_COMFORT, buildingLabels: true }));
    const first = comfort.setBuildingLabels(true);
    const second = comfort.setBuildingLabels(false);
    await Promise.all([first, second]);
    expect(comfort.store.get().preferences.buildingLabels).toBe(false);
  });

  it('a failed save shows the problem and reads back what is really saved', async () => {
    const get = vi.fn(() => Promise.resolve(ok(DEFAULT_COMFORT)));
    const { comfort, update } = setup(get);
    update.mockResolvedValueOnce(failed);
    await comfort.setBuildingLabels(false);
    expect(comfort.store.get().error?.code).toBe('internal_error');
    expect(comfort.store.get().preferences.buildingLabels).toBe(true);
    // The next good save clears the problem.
    await comfort.setReducedMotion('off');
    expect(comfort.store.get().error).toBeNull();
  });

  it('saves a camera once it has been still, as one write for many moves', async () => {
    const { comfort, update, clock } = setup();
    comfort.saveCamera(WORLD_A, camera);
    comfort.saveCamera(WORLD_A, { ...camera, centerX: 11 });
    comfort.saveCamera(WORLD_A, { ...camera, centerX: 12 });
    expect(clock.timers.setTimeout).toHaveBeenLastCalledWith(
      expect.any(Function),
      CAMERA_SAVE_DELAY_MS,
    );
    expect(update).not.toHaveBeenCalled();
    // The store has it straight away, for coming back to this world in the same session.
    expect(comfort.store.get().preferences.cameras[WORLD_A]?.centerX).toBe(12);
    clock.fire();
    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledTimes(1);
    });
    expect(update).toHaveBeenCalledWith({
      camera: { worldId: WORLD_A, camera: { ...camera, centerX: 12 } },
    });
  });

  it('flushCamera saves a waiting camera now, and does nothing when none waits', async () => {
    const { comfort, update, clock } = setup();
    await comfort.flushCamera();
    expect(update).not.toHaveBeenCalled();
    comfort.saveCamera(WORLD_A, camera);
    await comfort.flushCamera();
    expect(update).toHaveBeenCalledWith({ camera: { worldId: WORLD_A, camera } });
    expect(clock.pending()).toBe(false);
    await comfort.flushCamera();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("saves another world's waiting camera instead of dropping it", async () => {
    const { comfort, update } = setup();
    comfort.saveCamera(WORLD_A, camera);
    comfort.saveCamera(WORLD_B, { ...camera, zoom: 2 });
    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledWith({ camera: { worldId: WORLD_A, camera } });
    });
    await comfort.flushCamera();
    expect(update).toHaveBeenCalledWith({
      camera: { worldId: WORLD_B, camera: { ...camera, zoom: 2 } },
    });
  });
});

describe('resolveReducedMotion', () => {
  it('follows the OS for "system" and overrides it otherwise', () => {
    expect(resolveReducedMotion('system', true)).toBe(true);
    expect(resolveReducedMotion('system', false)).toBe(false);
    expect(resolveReducedMotion('on', false)).toBe(true);
    expect(resolveReducedMotion('off', true)).toBe(false);
  });
});

describe('saved camera math', () => {
  it('saves the world point at the centre of the view', () => {
    const view = centeredCamera(800, 600, 0.5);
    const saved = cameraToSaved(view, 800, 600);
    const centre = screenToWorld({ x: 400, y: 300 }, view);
    expect(saved).toEqual({ centerX: centre.x, centerY: centre.y, zoom: 0.5 });
  });

  it('restores the same view at the same size', () => {
    const view = { panX: -123.5, panY: 42, zoom: 1.25 };
    const restored = savedToCamera(cameraToSaved(view, 800, 600), 800, 600, DEFAULT_MAP);
    expect(restored.zoom).toBe(view.zoom);
    expect(restored.panX).toBeCloseTo(view.panX);
    expect(restored.panY).toBeCloseTo(view.panY);
  });

  it('keeps the same spot in the middle when the window size changed', () => {
    const saved = cameraToSaved({ panX: -100, panY: 50, zoom: 2 }, 800, 600);
    const restored = savedToCamera(saved, 1200, 400, DEFAULT_MAP);
    const centre = screenToWorld({ x: 600, y: 200 }, restored);
    expect(centre.x).toBeCloseTo(saved.centerX);
    expect(centre.y).toBeCloseTo(saved.centerY);
  });

  it('clamps a centre off the map and a zoom out of bounds', () => {
    const bounds = mapWorldBounds({ columns: 16, rows: 16 });
    expect(bounds).toEqual({ left: -512, right: 512, top: 0, bottom: 512 });
    const restored = savedToCamera({ centerX: 99_999, centerY: -99_999, zoom: 50 }, 800, 600, {
      columns: 16,
      rows: 16,
    });
    expect(restored.zoom).toBe(ZOOM_MAX);
    const centre = screenToWorld({ x: 400, y: 300 }, restored);
    expect(centre.x).toBeCloseTo(512);
    expect(centre.y).toBeCloseTo(0);
  });
});
