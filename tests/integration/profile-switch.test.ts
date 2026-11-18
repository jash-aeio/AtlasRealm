// Profile switching (M1-8 #35, ADR-0014, ADR-0021) through the real router, against real profile
// folders in a temp directory. Every handler is wrapped exactly as registerIpcHandlers wraps it.
//
// Covers TEST_PLAN §22.2 #23: after a switch, no command shows or changes the other profile's
// worlds, projects, settings or launch facts. Also: a failed open keeps the current profile
// (never an empty database), commands during a switch are refused, and the worker restarts.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import type { WorkerToMain } from '../../src/common/contracts/worker-protocol';
import { APP_ENTRY_URL } from '../../src/main/bootstrap/app-origin';
import {
  appLaunchInfoCommand,
  createLaunchInfoHandler,
} from '../../src/main/ipc/commands/app-launch-info';
import { appPingCommand, handleAppPing } from '../../src/main/ipc/commands/app-ping';
import {
  createProfileCreateHandler,
  createProfileListHandler,
  createProfileSettingsGetHandler,
  createProfileSettingsUpdateHandler,
  profileCreateCommand,
  profileListCommand,
  profileSettingsGetCommand,
  profileSettingsUpdateCommand,
} from '../../src/main/ipc/commands/profile';
import {
  createProfileSwitchHandler,
  profileSwitchCommand,
} from '../../src/main/ipc/commands/profile-switch';
import {
  createProjectArchiveHandler,
  createProjectCreateHandler,
  createProjectGetHandler,
  createProjectListHandler,
  createProjectRenameHandler,
  createProjectTrashHandler,
  projectArchiveCommand,
  projectCreateCommand,
  projectGetCommand,
  projectListCommand,
  projectRenameCommand,
  projectTrashCommand,
} from '../../src/main/ipc/commands/project';
import {
  createWorldCreateHandler,
  createWorldListHandler,
  createWorldRenameHandler,
  worldCreateCommand,
  worldListCommand,
  worldRenameCommand,
} from '../../src/main/ipc/commands/world';
import {
  type CommandDefinition,
  type CommandHandler,
  createCommandHandler,
  trustRendererEntry,
} from '../../src/main/ipc/router';
import { ActiveProfile, refuseWhileSwitching } from '../../src/main/profiles/active-profile';
import { ensureProfileSettings, ProfileService } from '../../src/main/profiles/profile-service';
import { WorkerBridge, type WorkerTransport } from '../../src/main/runtime-bridge/worker-bridge';
import { ProfileSession, type SwitchableWorker } from '../../src/main/services/profile-session';
import { ProjectService } from '../../src/main/services/project-service';
import {
  type AppDatabase,
  openAppDatabase,
  profilePaths,
} from '../../src/main/storage/app-database';
import { openDatabase } from '../../src/main/storage/database';
import { type ProfileId, toProfileId } from '../../src/main/storage/profiles/profile-id';
import * as profilesIndex from '../../src/main/storage/profiles/profiles-index';
import { openStartupProfile } from '../../src/main/storage/profiles/startup';
import { bundledTemplateFiles } from '../../src/main/templates/bundled-templates';
import { buildTemplateCatalog } from '../../src/main/templates/catalog';

const isTrusted = trustRendererEntry(APP_ENTRY_URL);
const trusted = { senderFrame: { url: APP_ENTRY_URL, parent: null } };
const catalog = buildTemplateCatalog(bundledTemplateFiles(), () => undefined);
const UNKNOWN_PROFILE = '00000000-0000-4000-8000-000000000000';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

let userData: string;
let active: ActiveProfile;
let profileA: ProfileId;
let profileB: ProfileId;
let events: string[];
let worker: SwitchableWorker;
let reloadRenderer: ReturnType<typeof vi.fn<() => Promise<void>>>;
let openProfile: ((dir: string, id: ProfileId) => Promise<AppDatabase>) | undefined;

function call<I extends z.ZodType, O extends z.ZodType>(
  definition: CommandDefinition<I, O>,
  handler: CommandHandler<I, O>,
  payload: unknown,
) {
  // The same wrapping registerIpcHandlers applies to every command.
  return createCommandHandler(
    definition,
    refuseWhileSwitching(active, handler),
    isTrusted,
  )(trusted, payload);
}

// Services are built per call, like one registration that lives across switches.
const profiles = () => new ProfileService(active);
const projects = () => new ProjectService(active, catalog);
const session = () =>
  new ProfileSession({
    active,
    worker,
    reloadRenderer: () => reloadRenderer(),
    ...(openProfile === undefined ? {} : { openProfile }),
  });

const api = {
  ping: () => call(appPingCommand, handleAppPing, { message: 'hi' }),
  launchInfo: () =>
    call(
      appLaunchInfoCommand,
      createLaunchInfoHandler(() => active.current().db),
      undefined,
    ),
  profileList: () => call(profileListCommand, createProfileListHandler(profiles()), undefined),
  profileCreate: (displayName: string) =>
    call(profileCreateCommand, createProfileCreateHandler(profiles()), { displayName }),
  settingsGet: () =>
    call(profileSettingsGetCommand, createProfileSettingsGetHandler(profiles()), undefined),
  settingsUpdate: (payload: unknown) =>
    call(profileSettingsUpdateCommand, createProfileSettingsUpdateHandler(profiles()), payload),
  switchTo: (profileId: string) =>
    call(profileSwitchCommand, createProfileSwitchHandler(session()), { profileId }),
  worldCreate: (name: string) =>
    call(worldCreateCommand, createWorldCreateHandler(active), { name }),
  worldList: () =>
    call(worldListCommand, createWorldListHandler(active), { includeArchived: true }),
  worldRename: (payload: unknown) =>
    call(worldRenameCommand, createWorldRenameHandler(active), payload),
  projectCreate: (worldId: string, name: string) =>
    call(projectCreateCommand, createProjectCreateHandler(projects()), {
      worldId,
      templateId: 'builtin.generic',
      templateVersion: '1.0.0',
      name,
      goal: 'A goal',
    }),
  projectGet: (payload: unknown) =>
    call(projectGetCommand, createProjectGetHandler(projects()), payload),
  projectList: (worldId: string, status = 'active') =>
    call(projectListCommand, createProjectListHandler(projects()), { worldId, status }),
  projectRename: (payload: unknown) =>
    call(projectRenameCommand, createProjectRenameHandler(projects()), payload),
  projectArchive: (payload: unknown) =>
    call(projectArchiveCommand, createProjectArchiveHandler(projects()), payload),
  projectTrash: (payload: unknown) =>
    call(projectTrashCommand, createProjectTrashHandler(projects()), payload),
};

function data<T>(result: { ok: true; data: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(`unexpected ${result.error.code}`);
  return result.data;
}

function lastUsed(): string {
  const read = profilesIndex.readProfilesIndex(userData);
  if (read.kind !== 'ok') throw new Error('no index');
  return read.index.lastUsedProfileId;
}

/** Switches and waits for the (fake) reload, so the gate is open again. */
async function switchAndSettle(profileId: ProfileId) {
  const result = await api.switchTo(profileId);
  await tick();
  await tick();
  return result;
}

beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'atlas-profile-switch-'));
  const opened = await openStartupProfile(userData);
  ensureProfileSettings(opened.db, opened.profileId, opened.displayName);
  active = new ActiveProfile(userData, { profileId: opened.profileId, db: opened.db });
  profileA = opened.profileId;
  events = [];
  worker = {
    pause: () => events.push('worker:pause'),
    resume: () => events.push('worker:resume'),
  };
  reloadRenderer = vi.fn(() => {
    events.push('reload');
    return Promise.resolve();
  });
  openProfile = undefined;
  const created = data(await api.profileCreate('Work'));
  profileB = toProfileId(created.profile.id);
});

afterEach(() => {
  vi.restoreAllMocks();
  const db = active.databaseForShutdown();
  if (db.isOpen) db.close();
  rmSync(userData, { recursive: true, force: true });
});

describe('profile.switch: the happy path', () => {
  it('swaps the database, records last-used, restarts the worker and then reloads', async () => {
    const oldDb = active.current().db;
    const result = await api.switchTo(profileB);
    expect(result).toEqual({ ok: true, data: { activeProfileId: profileB, reloading: true } });
    // The reply comes first; the reload follows on its own.
    expect(events).toEqual(['worker:pause', 'worker:resume']);
    await tick();
    expect(events).toEqual(['worker:pause', 'worker:resume', 'reload']);
    expect(reloadRenderer).toHaveBeenCalledTimes(1);

    expect(oldDb.isOpen).toBe(false);
    expect(active.current().profileId).toBe(profileB);
    expect(lastUsed()).toBe(profileB);
    const listed = data(await api.profileList());
    expect(listed.activeProfileId).toBe(profileB);
    expect(listed.profiles.find((p) => p.id === profileB)?.isActive).toBe(true);
  });

  it('the next startup opens the profile switched to', async () => {
    await switchAndSettle(profileB);
    active.current().db.close();
    const reopened = await openStartupProfile(userData);
    try {
      expect(reopened.profileId).toBe(profileB);
      expect(reopened.displayName).toBe('Work');
    } finally {
      reopened.db.close();
    }
  });

  it('refuses the already-active profile, an unknown one and a malformed ID, changing nothing', async () => {
    expect(await api.switchTo(profileA)).toMatchObject({
      ok: false,
      error: { code: 'invalid_transition' },
    });
    expect(await api.switchTo(UNKNOWN_PROFILE)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(await api.switchTo('../escape')).toMatchObject({
      ok: false,
      error: { code: 'invalid_payload' },
    });
    await tick();
    expect(events).toEqual([]);
    expect(active.current().profileId).toBe(profileA);
    expect(lastUsed()).toBe(profileA);
  });
});

describe('profile.switch: §22.2 #23 no leaks between profiles', () => {
  it('worlds, projects, settings and launch facts stay in their own profile, both ways', async () => {
    // Profile A: a world, a project and personalised settings.
    const worldA = data(await api.worldCreate('Home A')).world;
    const projectA = data(await api.projectCreate(worldA.id, 'Secret plan')).project;
    const settingsA = data(await api.settingsGet()).settings;
    data(
      await api.settingsUpdate({
        expectedRevision: settingsA.revision,
        avatarPreset: 'default',
        avatarColour: '#3a7bd5',
        timezone: 'Europe/Amsterdam',
      }),
    );
    const launchA = data(await api.launchInfo());

    await switchAndSettle(profileB);

    // Lists show nothing of A's.
    expect(data(await api.worldList()).worlds).toEqual([]);
    // A's IDs are unknown here, for reads and for changes.
    const forged = { worldId: worldA.id, projectId: projectA.id, expectedRevision: 1 };
    for (const attempt of [
      api.worldRename({ worldId: worldA.id, expectedRevision: worldA.revision, name: 'Taken' }),
      api.projectList(worldA.id),
      api.projectGet({ worldId: worldA.id, projectId: projectA.id }),
      api.projectRename({ ...forged, name: 'Taken' }),
      api.projectArchive(forged),
      api.projectTrash(forged),
      api.projectCreate(worldA.id, 'Sneaky'),
    ]) {
      expect(await attempt).toMatchObject({ ok: false, error: { code: 'not_found' } });
    }
    // Settings and launch facts are B's own.
    const settingsB = data(await api.settingsGet()).settings;
    expect(settingsB).toMatchObject({
      profileId: profileB,
      displayName: 'Work',
      avatarPreset: null,
      avatarColour: null,
    });
    const launchB = data(await api.launchInfo());
    expect(launchB.launchCount).toBe(1);
    expect(launchB.firstLaunchedAt).not.toBe(launchA.firstLaunchedAt);

    // B gets its own world, then back to A.
    const worldB = data(await api.worldCreate('Home B')).world;
    await switchAndSettle(profileA);

    expect(data(await api.worldList()).worlds.map((w) => w.id)).toEqual([worldA.id]);
    expect(data(await api.projectList(worldA.id)).projects.map((p) => p.id)).toEqual([projectA.id]);
    expect(await api.projectList(worldB.id)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(data(await api.settingsGet()).settings).toMatchObject({
      profileId: profileA,
      avatarColour: '#3a7bd5',
      timezone: 'Europe/Amsterdam',
    });
    // A's launch history continues; the switch recorded a launch (it opened the database).
    expect(data(await api.launchInfo()).firstLaunchedAt).toBe(launchA.firstLaunchedAt);
  });
});

describe('profile.switch: a target that cannot be opened', () => {
  const breakers: [string, () => void][] = [
    [
      'its database file is missing',
      () => {
        rmSync(profilePaths(userData, profileB).databaseFile);
      },
    ],
    [
      'its database comes from a newer app',
      () => {
        const db = openDatabase(profilePaths(userData, profileB).databaseFile);
        db.exec('PRAGMA user_version = 999');
        db.close();
      },
    ],
    [
      'its database file is damaged',
      () => {
        writeFileSync(profilePaths(userData, profileB).databaseFile, 'this is not a database');
      },
    ],
  ];

  it.each(breakers)('keeps the current profile when %s', async (_label, breakTarget) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const worldA = data(await api.worldCreate('Home A')).world;
    breakTarget();

    const result = await api.switchTo(profileB);
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'profile_unavailable',
        message:
          'That profile could not be opened. Your current profile is still active, and nothing was deleted.',
      },
    });
    await tick();
    // Nothing about the current profile changed: no worker stop, no reload, same database.
    expect(events).toEqual([]);
    expect(active.isSwitching).toBe(false);
    expect(active.current().profileId).toBe(profileA);
    expect(active.current().db.isOpen).toBe(true);
    expect(lastUsed()).toBe(profileA);
    expect(data(await api.worldList()).worlds.map((w) => w.id)).toEqual([worldA.id]);
  });

  it('never creates an empty database in place of a missing one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const file = profilePaths(userData, profileB).databaseFile;
    rmSync(file);
    await api.switchTo(profileB);
    expect(existsSync(file)).toBe(false);
  });

  it('closes the target again when the index cannot be written', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let targetDb: AppDatabase | undefined;
    openProfile = async (dir, id) => {
      targetDb = await openAppDatabase(dir, id, { requireExisting: true });
      return targetDb;
    };
    vi.spyOn(profilesIndex, 'writeProfilesIndex').mockRejectedValueOnce(new Error('disk full'));

    expect(await api.switchTo(profileB)).toMatchObject({
      ok: false,
      error: { code: 'profile_unavailable' },
    });
    expect(targetDb?.db.isOpen).toBe(false);
    expect(active.current().profileId).toBe(profileA);
    expect(lastUsed()).toBe(profileA);
    expect(events).toEqual([]);
  });
});

describe('profile.switch: commands during a switch', () => {
  it('refuses every command with profile_switching while the target opens', async () => {
    const opening = deferred<undefined>();
    openProfile = async (dir, id) => {
      await opening.promise;
      return openAppDatabase(dir, id, { requireExisting: true });
    };
    const switching = api.switchTo(profileB);
    await tick();

    for (const attempt of [
      api.ping(),
      api.launchInfo(),
      api.worldList(),
      api.worldCreate('Racing'),
      api.profileList(),
      api.profileCreate('Racing'),
      api.settingsGet(),
      api.switchTo(profileB),
    ]) {
      expect(await attempt).toMatchObject({ ok: false, error: { code: 'profile_switching' } });
    }

    opening.resolve(undefined);
    expect(await switching).toMatchObject({ ok: true });
    await tick();
    await tick();
    expect(data(await api.profileList()).activeProfileId).toBe(profileB);
    // The refused world.create never ran anywhere.
    expect(data(await api.worldList()).worlds).toEqual([]);
  });

  it('keeps refusing until the old page is gone, then answers from the new profile', async () => {
    const reloaded = deferred<undefined>();
    reloadRenderer = vi.fn(() => reloaded.promise);
    data(await api.worldCreate('Home A'));

    expect(await api.switchTo(profileB)).toMatchObject({ ok: true });
    await tick();
    expect(reloadRenderer).toHaveBeenCalledTimes(1);
    expect(await api.worldList()).toMatchObject({
      ok: false,
      error: { code: 'profile_switching' },
    });

    reloaded.resolve(undefined);
    await tick();
    expect(data(await api.worldList()).worlds).toEqual([]);
  });

  it('opens the gate again even if the reload fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    reloadRenderer = vi.fn(() => Promise.reject(new Error('window gone')));
    await switchAndSettle(profileB);
    expect(active.isSwitching).toBe(false);
    expect(data(await api.profileList()).activeProfileId).toBe(profileB);
  });
});

describe('profile.switch: the worker', () => {
  it('fails a pending request with worker_stopped, never re-sends it, and starts a fresh worker', async () => {
    const spawned: { sent: unknown[]; killed: boolean; toMain?: (raw: unknown) => void }[] = [];
    const bridge = new WorkerBridge((): WorkerTransport => {
      const entry: (typeof spawned)[number] = { sent: [], killed: false };
      spawned.push(entry);
      return {
        post: (message) => entry.sent.push(message),
        onMessage: (listener) => {
          entry.toMain = listener;
        },
        onExit: () => undefined,
        kill: () => {
          entry.killed = true;
        },
      };
    });
    worker = bridge;
    bridge.start();
    const ready: WorkerToMain = { kind: 'ready', pid: 1 };
    spawned[0]?.toMain?.(ready);

    const pending = bridge.request('spike.echo', { text: 'old profile work' });
    await switchAndSettle(profileB);

    const result = await pending;
    expect(result).toMatchObject({ ok: false, error: { code: 'worker_stopped' } });
    expect(result.ok ? '' : result.error.message).toContain('not retried');
    expect(spawned).toHaveLength(2);
    expect(spawned[0]?.killed).toBe(true);
    expect(spawned[1]?.sent).toEqual([]);
    expect(bridge.status()).toMatchObject({ state: 'starting', crashCount: 0, pendingRequests: 0 });
    spawned[1]?.toMain?.({ kind: 'ready', pid: 2 } satisfies WorkerToMain);
    expect(bridge.status()).toMatchObject({ state: 'running', pid: 2 });
    bridge.stop();
  });
});
