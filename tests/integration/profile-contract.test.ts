// Contract tests for `profile.*` and `profile.settings.*` (M1-6 #33). Every call goes through
// the real router (sender → schema → size → handler → output schema) against real profile
// folders in a temp directory.
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import { MAX_PROFILES, type ProfileSettings } from '../../src/common/contracts/profile';
import { APP_ENTRY_URL } from '../../src/main/bootstrap/app-origin';
import {
  createProfileCreateHandler,
  createProfileListHandler,
  createProfileRenameHandler,
  createProfileSettingsGetHandler,
  createProfileSettingsUpdateHandler,
  profileCreateCommand,
  profileListCommand,
  profileRenameCommand,
  profileSettingsGetCommand,
  profileSettingsUpdateCommand,
} from '../../src/main/ipc/commands/profile';
import {
  type CommandDefinition,
  type CommandHandler,
  createCommandHandler,
  trustRendererEntry,
} from '../../src/main/ipc/router';
import { ActiveProfile } from '../../src/main/profiles/active-profile';
import {
  ensureProfileSettings,
  ProfileService,
  systemTimezone,
} from '../../src/main/profiles/profile-service';
import { profilePaths } from '../../src/main/storage/app-database';
import { openDatabase } from '../../src/main/storage/database';
import { readSchemaVersion } from '../../src/main/storage/migrate';
import { toProfileId } from '../../src/main/storage/profiles/profile-id';
import * as profilesIndex from '../../src/main/storage/profiles/profiles-index';
import { openStartupProfile, type StartupProfile } from '../../src/main/storage/profiles/startup';
import { ProfileSettingsRepository } from '../../src/main/storage/repositories/profile-settings-repository';

const isTrusted = trustRendererEntry(APP_ENTRY_URL);
const trusted = { senderFrame: { url: APP_ENTRY_URL, parent: null } };

let userData: string;
let opened: StartupProfile;
let service: ProfileService;

function call<I extends z.ZodType, O extends z.ZodType>(
  definition: CommandDefinition<I, O>,
  handler: CommandHandler<I, O>,
  payload: unknown,
) {
  return createCommandHandler(definition, handler, isTrusted)(trusted, payload);
}

const list = () => call(profileListCommand, createProfileListHandler(service), undefined);
const create = (payload: unknown) =>
  call(profileCreateCommand, createProfileCreateHandler(service), payload);
const rename = (payload: unknown) =>
  call(profileRenameCommand, createProfileRenameHandler(service), payload);
const getSettings = (payload?: unknown) =>
  call(profileSettingsGetCommand, createProfileSettingsGetHandler(service), payload);
const updateSettings = (payload: unknown) =>
  call(profileSettingsUpdateCommand, createProfileSettingsUpdateHandler(service), payload);

async function settingsNow(): Promise<ProfileSettings> {
  const result = await getSettings();
  if (!result.ok) throw new Error(result.error.code);
  return result.data.settings;
}

function readIndex(): profilesIndex.ProfilesIndex {
  const read = profilesIndex.readProfilesIndex(userData);
  if (read.kind !== 'ok') throw new Error('no index');
  return read.index;
}

beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'atlas-profile-cmd-'));
  opened = await openStartupProfile(userData);
  ensureProfileSettings(opened.db, opened.profileId, opened.displayName);
  service = new ProfileService(
    new ActiveProfile(userData, { profileId: opened.profileId, db: opened.db }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  if (opened.db.isOpen) opened.db.close();
  rmSync(userData, { recursive: true, force: true });
});

describe('startup settings row (ADR-0019)', () => {
  it('gives a fresh profile usable defaults: no avatar, the system timezone', async () => {
    expect(await settingsNow()).toMatchObject({
      profileId: opened.profileId,
      displayName: 'Default',
      avatarPreset: null,
      avatarColour: null,
      timezone: systemTimezone(),
      revision: 1,
    });
  });

  it('is idempotent and repairs a name that differs from the index', () => {
    expect(ensureProfileSettings(opened.db, opened.profileId, 'Default').revision).toBe(1);
    const repaired = ensureProfileSettings(opened.db, opened.profileId, 'Renamed in index');
    expect(repaired).toMatchObject({ displayName: 'Renamed in index', revision: 2 });
  });
});

describe('profile.list', () => {
  it('lists the profiles and marks the active one', async () => {
    await expect(list()).resolves.toEqual({
      ok: true,
      data: {
        profiles: [{ id: opened.profileId, displayName: 'Default', isActive: true }],
        activeProfileId: opened.profileId,
      },
    });
  });

  it('rejects any payload', async () => {
    const result = await call(profileListCommand, createProfileListHandler(service), {});
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
  });
});

describe('profile.create', () => {
  it('creates a migrated profile with default settings, without switching to it', async () => {
    const result = await create({ displayName: '  Work  ' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { profile } = result.data;
    expect(profile).toMatchObject({ displayName: 'Work', isActive: false });

    const index = readIndex();
    expect(index.profiles.map((p) => p.displayName)).toEqual(['Default', 'Work']);
    expect(index.lastUsedProfileId).toBe(opened.profileId);

    const db = openDatabase(profilePaths(userData, toProfileId(profile.id)).databaseFile);
    try {
      expect(readSchemaVersion(db)).toBeGreaterThan(0);
      expect(new ProfileSettingsRepository(db).get(profile.id)).toMatchObject({
        displayName: 'Work',
        avatarPreset: null,
      });
      // Created, not launched: the launch history starts on first real use.
      expect(db.prepare('SELECT count(*) AS n FROM app_meta').get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
    // The active profile's commands still see the original profile.
    expect((await settingsNow()).displayName).toBe('Default');
  });

  it('refuses a name another profile already has, ignoring case', async () => {
    await expect(create({ displayName: 'default' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'already_exists' },
    });
  });

  it(`refuses more than ${String(MAX_PROFILES)} profiles`, async () => {
    const index = readIndex();
    const filler = Array.from({ length: MAX_PROFILES - 1 }, (_, i) => ({
      id: toProfileId(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`),
      displayName: `Filler ${String(i)}`,
    }));
    await profilesIndex.writeProfilesIndex(userData, {
      ...index,
      profiles: [...index.profiles, ...filler],
    });
    await expect(create({ displayName: 'One too many' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'limit_reached' },
    });
  });

  it('removes the new folder again when the index cannot be written', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(profilesIndex, 'writeProfilesIndex').mockRejectedValueOnce(new Error('disk full'));
    const before = readdirSync(join(userData, 'profiles')).sort();

    const result = await create({ displayName: 'Work' });

    expect(result).toMatchObject({ ok: false, error: { code: 'internal_error' } });
    expect(readdirSync(join(userData, 'profiles')).sort()).toEqual(before);
    expect(readIndex().profiles).toHaveLength(1);
  });

  it.each([
    ['wrong type', { displayName: 42 }],
    ['empty name', { displayName: '   ' }],
    ['oversize name', { displayName: 'x'.repeat(81) }],
    ['control character', { displayName: 'Work\nHome' }],
    ['bidi override', { displayName: `Work${String.fromCharCode(0x202e)}` }],
    ['extra key', { displayName: 'Work', id: '00000000-0000-4000-8000-000000000001' }],
    ['no payload', undefined],
  ])('rejects a forged payload (%s) and creates nothing', async (_label, payload) => {
    await expect(create(payload)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_payload' },
    });
    expect(readIndex().profiles).toHaveLength(1);
  });

  it('counts names in code points, as the database does', async () => {
    const emoji = String.fromCodePoint(0x1f3f0); // castle, two UTF-16 units
    await expect(create({ displayName: emoji.repeat(80) })).resolves.toMatchObject({ ok: true });
    await expect(create({ displayName: emoji.repeat(81) })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_payload' },
    });
  });
});

describe('profile.rename', () => {
  it('renames the active profile in the index and its settings together', async () => {
    const result = await rename({ displayName: 'Home', expectedRevision: 1 });
    expect(result).toMatchObject({
      ok: true,
      data: { settings: { displayName: 'Home', revision: 2 } },
    });
    expect(readIndex().profiles[0]?.displayName).toBe('Home');
  });

  it('refuses a stale revision and changes nothing', async () => {
    await rename({ displayName: 'Home', expectedRevision: 1 });
    await expect(rename({ displayName: 'Again', expectedRevision: 1 })).resolves.toEqual({
      ok: false,
      error: {
        code: 'revision_conflict',
        message: expect.any(String) as string,
        currentRevision: 2,
      },
    });
    expect(readIndex().profiles[0]?.displayName).toBe('Home');
  });

  it("refuses another profile's name", async () => {
    await create({ displayName: 'Work' });
    await expect(rename({ displayName: 'WORK', expectedRevision: 1 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'already_exists' },
    });
  });

  it('writes the old index back when the settings update fails after the index write', async () => {
    const write = profilesIndex.writeProfilesIndex;
    vi.spyOn(profilesIndex, 'writeProfilesIndex').mockImplementationOnce(async (dir, index) => {
      await write(dir, index);
      // Someone else changes the settings while the index is being written.
      new ProfileSettingsRepository(opened.db).update(opened.profileId, 1, { timezone: 'UTC' });
    });

    const result = await rename({ displayName: 'Home', expectedRevision: 1 });

    expect(result).toMatchObject({ ok: false, error: { code: 'revision_conflict' } });
    expect(readIndex().profiles[0]?.displayName).toBe('Default');
    expect((await settingsNow()).displayName).toBe('Default');
  });

  it.each([
    ['missing revision', { displayName: 'Home' }],
    ['zero revision', { displayName: 'Home', expectedRevision: 0 }],
    ['fractional revision', { displayName: 'Home', expectedRevision: 1.5 }],
    ['string revision', { displayName: 'Home', expectedRevision: '1' }],
    ['another profile ID', { displayName: 'Home', expectedRevision: 1, profileId: 'default' }],
  ])('rejects a forged payload (%s)', async (_label, payload) => {
    await expect(rename(payload)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_payload' },
    });
  });
});

describe('profile.settings.update', () => {
  it('sets and clears avatar fields and canonicalises the timezone', async () => {
    const set = await updateSettings({
      expectedRevision: 1,
      avatarPreset: 'default',
      avatarColour: '#3a7bd5',
      timezone: 'europe/amsterdam',
    });
    expect(set).toMatchObject({
      ok: true,
      data: {
        settings: {
          avatarPreset: 'default',
          avatarColour: '#3a7bd5',
          timezone: 'Europe/Amsterdam',
          revision: 2,
        },
      },
    });
    const cleared = await updateSettings({ expectedRevision: 2, avatarPreset: null });
    expect(cleared).toMatchObject({
      ok: true,
      data: { settings: { avatarPreset: null, avatarColour: '#3a7bd5', revision: 3 } },
    });
  });

  it('reports a stale revision with the current one', async () => {
    await updateSettings({ expectedRevision: 1, timezone: 'UTC' });
    await expect(updateSettings({ expectedRevision: 1, timezone: 'UTC' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'revision_conflict', currentRevision: 2 },
    });
  });

  it('rejects a well-shaped timezone that does not exist', async () => {
    await expect(
      updateSettings({ expectedRevision: 1, timezone: 'Mars/Olympus_Mons' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
  });

  it.each([
    ['nothing to update', { expectedRevision: 1 }],
    ['unknown avatar preset', { expectedRevision: 1, avatarPreset: 'dragon' }],
    ['uppercase colour', { expectedRevision: 1, avatarColour: '#ABCDEF' }],
    ['colour name', { expectedRevision: 1, avatarColour: 'red' }],
    ['offset timezone', { expectedRevision: 1, timezone: '+02:00' }],
    ['display name (use rename)', { expectedRevision: 1, displayName: 'Sneaky' }],
    ['preferences (not exposed)', { expectedRevision: 1, preferences: { a: 1 } }],
    ['wrong type', { expectedRevision: 1, timezone: 42 }],
  ])('rejects a forged payload (%s)', async (_label, payload) => {
    await expect(updateSettings(payload)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_payload' },
    });
    expect((await settingsNow()).revision).toBe(1);
  });
});

describe('profile.settings.get', () => {
  it('rejects any payload', async () => {
    await expect(getSettings({ profileId: 'default' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_payload' },
    });
  });

  it('reads the settings of the active profile only', async () => {
    const result = await create({ displayName: 'Work' });
    if (!result.ok) throw new Error('create failed');
    expect(
      existsSync(profilePaths(userData, toProfileId(result.data.profile.id)).databaseFile),
    ).toBe(true);
    expect((await settingsNow()).profileId).toBe(opened.profileId);
  });
});
