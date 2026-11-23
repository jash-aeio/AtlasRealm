// The renderer side of the Realm Atlas display preferences (M2-12 #77, ADR-0031): one store
// for the window with every world's view, and the save calls.
//
// Like the comfort store (M2-14), a change shows straight away and is then saved; replies don't
// overwrite the store, so quick clicks can't be undone by replies arriving out of order. A
// failed save says so and reads the saved values back.
//
// Width changes come many times a second while the user drags the resize handle, so they are
// debounced (saved once the handle has been still for WIDTH_SAVE_DELAY_MS). Any other change
// for the same world saves the waiting width with it straight away.
//
// Pure TypeScript with no React or DOM imports, so it's unit-tested in plain Node.
import type { AtlasApi } from '../../common/contracts/atlas-api';
import type { IpcError } from '../../common/contracts/ipc-result';
import {
  applyAtlasViewChange,
  type AtlasView,
  type AtlasViewChange,
  atlasViewOf,
  type AtlasViews,
} from '../../common/preferences/atlas-view';
import { createStore, type Store } from '../state/store';
import type { Timers } from '../world/comfort';

export const WIDTH_SAVE_DELAY_MS = 400;

export interface AtlasViewsState {
  /** `loading` until the first read; `error` if it failed (the defaults apply meanwhile). */
  readonly status: 'loading' | 'ready' | 'error';
  readonly views: AtlasViews;
  /** The last read or save problem, shown in the panel. Cleared by the next success. */
  readonly error: IpcError | null;
}

type AtlasViewApi = Pick<AtlasApi['profile'], 'atlasView'>;

export interface AtlasViewPreferences {
  readonly store: Store<AtlasViewsState>;
  readonly load: () => Promise<void>;
  /** Changes one world's view now and saves it (debounced when it is only a width). */
  readonly change: (worldId: string, change: AtlasViewChange) => Promise<void>;
  /** Saves a waiting width straight away (leaving the screen). */
  readonly flush: () => Promise<void>;
}

const realTimers: Timers = {
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

/** A world's current view from the state. */
export function viewOf(state: AtlasViewsState, worldId: string): AtlasView {
  return atlasViewOf(state.views, worldId);
}

export function createAtlasViewPreferences(
  api: AtlasViewApi,
  timers: Timers = realTimers,
): AtlasViewPreferences {
  const store = createStore<AtlasViewsState>({ status: 'loading', views: {}, error: null });
  let pending: { worldId: string; width: number } | null = null;
  let timer: unknown = null;

  const update = (change: Partial<AtlasViewsState>) => {
    store.set({ ...store.get(), ...change });
  };

  async function load() {
    const result = await api.atlasView.get();
    if (result.ok) update({ status: 'ready', views: result.data.views, error: null });
    else
      update({ status: store.get().status === 'ready' ? 'ready' : 'error', error: result.error });
  }

  async function save(worldId: string, change: AtlasViewChange) {
    const result = await api.atlasView.update({ worldId, change });
    if (result.ok) {
      if (store.get().error !== null) update({ error: null });
      return;
    }
    update({ error: result.error });
    const saved = await api.atlasView.get();
    if (saved.ok) update({ views: saved.data.views });
  }

  /** Takes the waiting width off the timer, if any. */
  function takePending() {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    const waiting = pending;
    pending = null;
    return waiting;
  }

  async function flush() {
    const waiting = takePending();
    if (waiting !== null) await save(waiting.worldId, { width: waiting.width });
  }

  return {
    store,
    load,
    async change(worldId, change) {
      update({ views: applyAtlasViewChange(store.get().views, worldId, change) });
      const width = change.width;
      if (width !== undefined && Object.keys(change).length === 1) {
        // Another world's waiting width is saved now rather than lost.
        if (pending !== null && pending.worldId !== worldId) void flush();
        pending = { worldId, width };
        if (timer !== null) timers.clearTimeout(timer);
        timer = timers.setTimeout(() => {
          timer = null;
          void flush();
        }, WIDTH_SAVE_DELAY_MS);
        return;
      }
      // A waiting width for this world goes out with this change; another world's goes alone.
      const waiting = takePending();
      if (waiting !== null && waiting.worldId !== worldId) {
        await save(waiting.worldId, { width: waiting.width });
      }
      const merged = waiting?.worldId === worldId ? { width: waiting.width, ...change } : change;
      await save(worldId, merged);
    },
    flush,
  };
}
