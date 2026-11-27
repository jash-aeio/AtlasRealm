// The renderer's view of the active profile: its profile list, settings and worlds (M1-9 #36).
//
// It is a cache of what the main process says, never the source of truth. Every command goes
// through `window.atlas`, and after it the store reads everything again, so the screen always
// shows saved data. There is no event stream yet (events come with the runtime, M3/M4).
//
// Pure TypeScript with no React or DOM imports: the API is passed in, so it's unit-tested
// with a fake.
import type { AtlasApi } from '../../common/contracts/atlas-api';
import type { IpcError, IpcResult } from '../../common/contracts/ipc-result';
import type { ProfileListOutput, ProfileSettings } from '../../common/contracts/profile';
import type { WorldSummary, WorldTheme } from '../../common/contracts/world';
import { createStore, type Store } from './store';

/** The slice of `window.atlas` the session needs. */
export interface SessionApi {
  readonly profile: Pick<AtlasApi['profile'], 'list' | 'create' | 'rename' | 'settings' | 'switch'>;
  readonly world: Pick<AtlasApi['world'], 'list' | 'create' | 'rename'>;
}

export interface SessionData {
  readonly profiles: ProfileListOutput;
  readonly settings: ProfileSettings;
  /** Active (unarchived) worlds of the active profile, at most MAX_WORLDS. */
  readonly worlds: readonly WorldSummary[];
  /** Active worlds that weren't listed because of the limit (#61); usually 0. */
  readonly worldsOmitted: number;
}

export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: IpcError }
  | {
      readonly status: 'ready';
      readonly data: SessionData;
      /** A one-off message for the user, such as "changed elsewhere, reloaded". */
      readonly notice: string | null;
    };

export type Screen = 'loading' | 'error' | 'onboarding' | 'main';

/**
 * Which screen to show. "First launch" means the active profile has no active world yet
 * (ADR-0022): there is no separate "onboarding done" flag, so a skipped avatar never nags.
 */
export function screenFor(state: SessionState): Screen {
  if (state.status !== 'ready') return state.status;
  return state.data.worlds.length === 0 ? 'onboarding' : 'main';
}

export const CONFLICT_NOTICE = 'This changed somewhere else, so the latest saved version is shown.';

/** What a command returned, after the session has reloaded. */
export type CommandOutcome =
  { readonly ok: true } | { readonly ok: false; readonly error: IpcError };

export interface Session {
  readonly store: Store<SessionState>;
  /** Reads profiles, settings and worlds again. */
  readonly reload: () => Promise<void>;
  readonly createProfile: (displayName: string) => Promise<CommandOutcome>;
  readonly renameProfile: (displayName: string) => Promise<CommandOutcome>;
  /**
   * Makes another profile active (M1-8). On success the main process reloads the window, so
   * nothing is re-read here: the new page starts a new session for the new profile.
   */
  readonly switchProfile: (profileId: string) => Promise<CommandOutcome>;
  /** A colour picks the placeholder avatar in that colour; `null` clears the avatar. */
  readonly setAvatar: (colour: string | null) => Promise<CommandOutcome>;
  readonly createWorld: (name: string, themeId: WorldTheme) => Promise<CommandOutcome>;
  /** Renames a world, using the revision the user last saw. */
  readonly renameWorld: (worldId: string, name: string) => Promise<CommandOutcome>;
  readonly dismissNotice: () => void;
}

export function createSession(api: SessionApi): Session {
  const store = createStore<SessionState>({ status: 'loading' });
  // Only the newest reload may write the store, so a slow older read can't overwrite it.
  let latestReload = 0;

  async function load(notice: string | null): Promise<void> {
    const ticket = ++latestReload;
    const [profiles, settings, worlds] = await Promise.all([
      api.profile.list(),
      api.profile.settings.get(),
      api.world.list(),
    ]);
    if (ticket !== latestReload) return;
    if (!profiles.ok) {
      store.set({ status: 'error', error: profiles.error });
      return;
    }
    if (!settings.ok) {
      store.set({ status: 'error', error: settings.error });
      return;
    }
    if (!worlds.ok) {
      store.set({ status: 'error', error: worlds.error });
      return;
    }
    store.set({
      status: 'ready',
      data: {
        profiles: profiles.data,
        settings: settings.data.settings,
        worlds: worlds.data.worlds,
        worldsOmitted: worlds.data.omittedCount,
      },
      notice,
    });
  }

  /** Runs a command, then reloads. A revision conflict reloads with a notice. */
  async function command<T>(run: () => Promise<IpcResult<T>>): Promise<CommandOutcome> {
    const result = await run();
    if (result.ok) {
      await load(null);
      return { ok: true };
    }
    if (result.error.code === 'revision_conflict') await load(CONFLICT_NOTICE);
    return { ok: false, error: result.error };
  }

  /** The settings revision the user last saw. Commands that need one require a ready state. */
  function currentRevision(): number {
    const state = store.get();
    if (state.status !== 'ready') throw new Error('session is not ready');
    return state.data.settings.revision;
  }

  return {
    store,
    reload: () => load(null),
    createProfile: (displayName) => command(() => api.profile.create({ displayName })),
    async switchProfile(profileId) {
      const result = await api.profile.switch({ profileId });
      if (result.ok) return { ok: true };
      // The list may be out of date (the profile was removed elsewhere): show the latest.
      if (result.error.code === 'not_found') await load(null);
      return { ok: false, error: result.error };
    },
    renameProfile: (displayName) =>
      command(() => api.profile.rename({ displayName, expectedRevision: currentRevision() })),
    setAvatar: (colour) =>
      command(() =>
        api.profile.settings.update({
          expectedRevision: currentRevision(),
          avatarPreset: colour === null ? null : 'default',
          avatarColour: colour,
        }),
      ),
    createWorld: (name, themeId) => command(() => api.world.create({ name, themeId })),
    renameWorld: (worldId, name) =>
      command(() => {
        const state = store.get();
        const world =
          state.status === 'ready' ? state.data.worlds.find((w) => w.id === worldId) : undefined;
        if (world === undefined) throw new Error('unknown world');
        return api.world.rename({ worldId, name, expectedRevision: world.revision });
      }),
    dismissNotice() {
      const state = store.get();
      if (state.status === 'ready' && state.notice !== null) store.set({ ...state, notice: null });
    },
  };
}
