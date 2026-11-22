// The renderer side of the comfort preferences (M2-14 #79, UI_SPEC §6.6, ADR-0028): one store
// the whole window reads (reduced motion, building labels, saved cameras), the save calls, and
// the camera math for saving and restoring a view.
//
// Toggles change the store straight away and then save. The store stays the source of truth
// for this window: replies don't overwrite it, so two quick clicks can't be undone by their
// replies arriving out of order. A failed save says so and reads the saved values back.
//
// Camera saves are debounced: a pan or zoom only saves once the camera has been still for
// CAMERA_SAVE_DELAY_MS. "Debounce" means waiting for a pause before acting, so a drag that
// moves the camera 60 times a second becomes one write.
//
// Pure TypeScript with no React or DOM imports, so it's unit-tested in plain Node.
import type { AtlasApi } from '../../common/contracts/atlas-api';
import type { IpcError } from '../../common/contracts/ipc-result';
import {
  type ComfortPatch,
  type ComfortPreferences,
  DEFAULT_COMFORT,
  type ReducedMotionSetting,
  type SavedCamera,
} from '../../common/preferences/comfort';
import { createStore, type Store } from '../state/store';
import {
  clampZoom,
  DEFAULT_TILE,
  gridToWorld,
  screenToWorld,
  type Camera,
  type MapSize,
  type TileSize,
} from './projection';

export const CAMERA_SAVE_DELAY_MS = 500;

export interface ComfortState {
  /** `loading` until the first read; `error` if it failed (the defaults apply meanwhile). */
  readonly status: 'loading' | 'ready' | 'error';
  readonly preferences: ComfortPreferences;
  /** The last read or save problem, shown in Settings. Cleared by the next success. */
  readonly error: IpcError | null;
}

type PreferencesApi = Pick<AtlasApi['profile'], 'preferences'>;

/** Timers, injectable so tests can run the debounce without waiting. */
export interface Timers {
  readonly setTimeout: (run: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

const realTimers: Timers = {
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

export interface Comfort {
  readonly store: Store<ComfortState>;
  /** Reads the saved preferences. */
  readonly load: () => Promise<void>;
  readonly setReducedMotion: (setting: ReducedMotionSetting) => Promise<void>;
  readonly setBuildingLabels: (show: boolean) => Promise<void>;
  /** Remembers a world's camera now and saves it once the camera has been still a moment. */
  readonly saveCamera: (worldId: string, camera: SavedCamera) => void;
  /** Saves a waiting camera straight away (leaving a world, closing the view). */
  readonly flushCamera: () => Promise<void>;
}

export function createComfort(api: PreferencesApi, timers: Timers = realTimers): Comfort {
  const store = createStore<ComfortState>({
    status: 'loading',
    preferences: DEFAULT_COMFORT,
    error: null,
  });
  let pendingCamera: { worldId: string; camera: SavedCamera } | null = null;
  let timer: unknown = null;

  const update = (change: Partial<ComfortState>) => {
    store.set({ ...store.get(), ...change });
  };
  const changePreferences = (change: Partial<ComfortPreferences>) => {
    update({ preferences: { ...store.get().preferences, ...change } });
  };

  async function load() {
    const result = await api.preferences.get();
    if (result.ok) update({ status: 'ready', preferences: result.data.preferences, error: null });
    else
      update({ status: store.get().status === 'ready' ? 'ready' : 'error', error: result.error });
  }

  async function save(patch: ComfortPatch) {
    const result = await api.preferences.update(patch);
    if (result.ok) {
      if (store.get().error !== null) update({ error: null });
      return;
    }
    // Show the problem, then the values that really are saved.
    update({ error: result.error });
    const saved = await api.preferences.get();
    if (saved.ok) update({ preferences: saved.data.preferences });
  }

  async function flushCamera() {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    const waiting = pendingCamera;
    pendingCamera = null;
    if (waiting !== null) await save({ camera: waiting });
  }

  return {
    store,
    load,
    async setReducedMotion(setting) {
      changePreferences({ reducedMotion: setting });
      await save({ reducedMotion: setting });
    },
    async setBuildingLabels(show) {
      changePreferences({ buildingLabels: show });
      await save({ buildingLabels: show });
    },
    saveCamera(worldId, camera) {
      // In the store at once, so coming back to this world in the same session restores it.
      changePreferences({ cameras: { ...store.get().preferences.cameras, [worldId]: camera } });
      // A different world's waiting camera is saved now rather than lost.
      if (pendingCamera !== null && pendingCamera.worldId !== worldId) void flushCamera();
      pendingCamera = { worldId, camera };
      if (timer !== null) timers.clearTimeout(timer);
      timer = timers.setTimeout(() => {
        timer = null;
        void flushCamera();
      }, CAMERA_SAVE_DELAY_MS);
    },
    flushCamera,
  };
}

/** Whether motion should be reduced: the setting, or the OS preference when it says `system`. */
export function resolveReducedMotion(
  setting: ReducedMotionSetting,
  osPrefersReduced: boolean,
): boolean {
  return setting === 'system' ? osPrefersReduced : setting === 'on';
}

/** The map's bounding box in world pixels (the diamond's left, right, top and bottom tips). */
export function mapWorldBounds(map: MapSize, tile: TileSize = DEFAULT_TILE) {
  return {
    left: gridToWorld({ gx: 0, gy: map.rows }, tile).x,
    right: gridToWorld({ gx: map.columns, gy: 0 }, tile).x,
    top: 0,
    bottom: gridToWorld({ gx: map.columns, gy: map.rows }, tile).y,
  };
}

/** What to save for a camera: the world point at the centre of a `width` × `height` view. */
export function cameraToSaved(camera: Camera, width: number, height: number): SavedCamera {
  const centre = screenToWorld({ x: width / 2, y: height / 2 }, camera);
  return { centerX: centre.x, centerY: centre.y, zoom: camera.zoom };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * The camera that puts a saved centre in the middle of a `width` × `height` view. The centre
 * is clamped to the map and the zoom to its bounds, so a saved view from a bigger map (or a
 * hand-edited one) still opens somewhere on this map.
 */
export function savedToCamera(
  saved: SavedCamera,
  width: number,
  height: number,
  map: MapSize,
  tile: TileSize = DEFAULT_TILE,
): Camera {
  const bounds = mapWorldBounds(map, tile);
  const zoom = clampZoom(saved.zoom);
  const x = clamp(saved.centerX, bounds.left, bounds.right);
  const y = clamp(saved.centerY, bounds.top, bounds.bottom);
  return { zoom, panX: width / 2 - x * zoom, panY: height / 2 - y * zoom };
}
