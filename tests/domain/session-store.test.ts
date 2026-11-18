import { describe, expect, it, vi } from 'vitest';

import type { IpcResult } from '../../src/common/contracts/ipc-result';
import type { ProfileSettings } from '../../src/common/contracts/profile';
import type { WorldSummary } from '../../src/common/contracts/world';
import {
  CONFLICT_NOTICE,
  createSession,
  screenFor,
  type SessionApi,
} from '../../src/renderer/state/session';

const NOW = '2026-11-18T10:00:00.000Z';

function settings(revision: number, colour: string | null = null): ProfileSettings {
  return {
    profileId: 'default',
    displayName: 'Default',
    avatarPreset: colour === null ? null : 'default',
    avatarColour: colour,
    timezone: 'UTC',
    createdAt: NOW,
    updatedAt: NOW,
    revision,
  };
}

const WORLD: WorldSummary = {
  id: '11111111-2222-4333-8444-555555555555',
  name: 'Home',
  themeId: 'meadow',
  gridWidth: 64,
  gridHeight: 64,
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  revision: 1,
};

const ok = <T>(data: T): Promise<IpcResult<T>> => Promise.resolve({ ok: true, data });

/** A fake `window.atlas` slice backed by a little in-memory profile. */
function fakeApi() {
  let current = settings(1);
  const worlds: WorldSummary[] = [];
  const api = {
    profile: {
      list: vi.fn(() =>
        ok({
          profiles: [{ id: 'default', displayName: 'Default', isActive: true }],
          activeProfileId: 'default',
        }),
      ),
      create: vi.fn(() =>
        ok({
          profile: {
            id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            displayName: 'Second',
            isActive: false,
          },
        }),
      ),
      rename: vi.fn(() => ok({ settings: current })),
      switch: vi.fn((input: { profileId: string }) =>
        ok({ activeProfileId: input.profileId, reloading: true as const }),
      ),
      settings: {
        get: vi.fn(() => ok({ settings: current })),
        update: vi.fn((input: { expectedRevision: number; avatarColour?: string | null }) => {
          if (input.expectedRevision !== current.revision) {
            return Promise.resolve<IpcResult<{ settings: ProfileSettings }>>({
              ok: false,
              error: {
                code: 'revision_conflict',
                message: 'changed',
                currentRevision: current.revision,
              },
            });
          }
          current = settings(current.revision + 1, input.avatarColour ?? null);
          return ok({ settings: current });
        }),
      },
    },
    world: {
      list: vi.fn(() => ok({ worlds: [...worlds] })),
      create: vi.fn(() => {
        worlds.push(WORLD);
        return ok({ world: WORLD });
      }),
      rename: vi.fn((input: { worldId: string; name: string; expectedRevision: number }) => {
        const renamed = { ...WORLD, name: input.name, revision: input.expectedRevision + 1 };
        worlds.splice(0, 1, renamed);
        return ok({ world: renamed });
      }),
    },
  } satisfies SessionApi;
  return {
    api,
    bumpRevisionElsewhere() {
      current = settings(current.revision + 1, current.avatarColour);
    },
  };
}

describe('session store', () => {
  it('starts loading, then shows onboarding while the profile has no world', async () => {
    const { api } = fakeApi();
    const session = createSession(api);
    expect(screenFor(session.store.get())).toBe('loading');
    await session.reload();
    expect(screenFor(session.store.get())).toBe('onboarding');
  });

  it('switches to the main screen once a world exists, and reloads after the command', async () => {
    const { api } = fakeApi();
    const session = createSession(api);
    await session.reload();
    const outcome = await session.createWorld('Home', 'meadow');
    expect(outcome).toEqual({ ok: true });
    expect(api.world.create).toHaveBeenCalledWith({ name: 'Home', themeId: 'meadow' });
    expect(screenFor(session.store.get())).toBe('main');
  });

  it('saves an avatar colour with the default preset and the revision it last saw', async () => {
    const { api } = fakeApi();
    const session = createSession(api);
    await session.reload();
    await session.setAvatar('#6bc6f2');
    expect(api.profile.settings.update).toHaveBeenCalledWith({
      expectedRevision: 1,
      avatarPreset: 'default',
      avatarColour: '#6bc6f2',
    });
    const state = session.store.get();
    expect(state.status === 'ready' && state.data.settings.avatarColour).toBe('#6bc6f2');
  });

  it('clears both avatar fields with null', async () => {
    const { api } = fakeApi();
    const session = createSession(api);
    await session.reload();
    await session.setAvatar(null);
    expect(api.profile.settings.update).toHaveBeenCalledWith({
      expectedRevision: 1,
      avatarPreset: null,
      avatarColour: null,
    });
  });

  it('reloads with a notice on a revision conflict and reports the error', async () => {
    const fake = fakeApi();
    const session = createSession(fake.api);
    await session.reload();
    fake.bumpRevisionElsewhere();
    const outcome = await session.setAvatar('#f2c14e');
    expect(!outcome.ok && outcome.error.code).toBe('revision_conflict');
    const state = session.store.get();
    expect(state.status).toBe('ready');
    if (state.status !== 'ready') return;
    expect(state.notice).toBe(CONFLICT_NOTICE);
    expect(state.data.settings.revision).toBe(2); // the fresh revision, so a retry can work
    session.dismissNotice();
    const after = session.store.get();
    expect(after.status === 'ready' && after.notice).toBeNull();
  });

  it('does not reload after other errors, so the form can show the message', async () => {
    const { api } = fakeApi();
    api.profile.create.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, error: { code: 'already_exists', message: 'taken' } }),
    );
    const session = createSession(api);
    await session.reload();
    const reads = api.profile.list.mock.calls.length;
    const outcome = await session.createProfile('Default');
    expect(outcome).toEqual({ ok: false, error: { code: 'already_exists', message: 'taken' } });
    expect(api.profile.list.mock.calls.length).toBe(reads);
  });

  it('shows an error state when a read fails', async () => {
    const { api } = fakeApi();
    api.world.list.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, error: { code: 'internal_error', message: 'boom' } }),
    );
    const session = createSession(api);
    await session.reload();
    expect(session.store.get()).toEqual({
      status: 'error',
      error: { code: 'internal_error', message: 'boom' },
    });
    expect(screenFor(session.store.get())).toBe('error');
  });

  it('ignores an older reload that finishes after a newer one', async () => {
    const { api } = fakeApi();
    let releaseSlow: () => void = () => undefined;
    api.world.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseSlow = () => {
            resolve({ ok: true, data: { worlds: [] } });
          };
        }),
    );
    const session = createSession(api);
    const slow = session.reload(); // reads "no worlds", but slowly
    await session.createWorld('Home', 'meadow'); // its reload sees the new world
    releaseSlow();
    await slow;
    expect(screenFor(session.store.get())).toBe('main');
  });

  it('renames a world with the revision it last saw', async () => {
    const { api } = fakeApi();
    const session = createSession(api);
    await session.reload();
    await session.createWorld('Home', 'meadow');
    await session.renameWorld(WORLD.id, 'Hearth');
    expect(api.world.rename).toHaveBeenCalledWith({
      worldId: WORLD.id,
      name: 'Hearth',
      expectedRevision: 1,
    });
    const state = session.store.get();
    expect(state.status === 'ready' && state.data.worlds[0]?.name).toBe('Hearth');
    await expect(session.renameWorld('nope', 'X')).rejects.toThrow('unknown world');
  });

  it('switches without re-reading: the main process reloads the window', async () => {
    const { api } = fakeApi();
    const session = createSession(api);
    await session.reload();
    const reads = api.profile.list.mock.calls.length;
    const target = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    expect(await session.switchProfile(target)).toEqual({ ok: true });
    expect(api.profile.switch).toHaveBeenCalledWith({ profileId: target });
    expect(api.profile.list.mock.calls.length).toBe(reads);
  });

  it('reports a failed switch, re-reading only when the profile is gone', async () => {
    const { api } = fakeApi();
    const session = createSession(api);
    await session.reload();
    const reads = api.profile.list.mock.calls.length;
    const unavailable = { code: 'profile_unavailable' as const, message: 'could not open' };
    api.profile.switch.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, error: unavailable }),
    );
    expect(await session.switchProfile('default')).toEqual({ ok: false, error: unavailable });
    expect(api.profile.list.mock.calls.length).toBe(reads);

    api.profile.switch.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, error: { code: 'not_found', message: 'gone' } }),
    );
    await session.switchProfile('default');
    expect(api.profile.list.mock.calls.length).toBe(reads + 1);
  });

  it('refuses revision-based commands before the first load', async () => {
    const { api } = fakeApi();
    const session = createSession(api);
    await expect(session.renameProfile('X')).rejects.toThrow('not ready');
    expect(api.profile.rename).not.toHaveBeenCalled();
  });
});
