import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  openAppDatabase,
  ProfileDataMissingError,
  profilePaths,
} from '../../src/main/storage/app-database';
import { openDatabase } from '../../src/main/storage/database';
import { readSchemaVersion } from '../../src/main/storage/migrate';
import { MIGRATIONS } from '../../src/main/storage/migrations';
import { LEGACY_PROFILE_ID, toProfileId } from '../../src/main/storage/profiles/profile-id';
import {
  ProfilesIndexCorruptError,
  profilesIndexPath,
  readProfilesIndex,
  writeProfilesIndex,
} from '../../src/main/storage/profiles/profiles-index';
import {
  openStartupProfile,
  ProfilesIndexMissingError,
  type StartupProfile,
} from '../../src/main/storage/profiles/startup';

const LEGACY = toProfileId(LEGACY_PROFILE_ID);
const WORK = toProfileId('3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b');

let userData: string;
let opened: StartupProfile | undefined;

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'atlas-startup-'));
});

afterEach(() => {
  if (opened?.db.isOpen === true) opened.db.close();
  opened = undefined;
  rmSync(userData, { recursive: true, force: true });
});

/** Simulates an M0 install: one launch in `profiles/default/`, no index. */
async function seedM0Install(): Promise<void> {
  const m0 = await openAppDatabase(userData, LEGACY);
  m0.db.close();
}

describe('openStartupProfile: first M1 launch', () => {
  it('adopts the M0 folder as "Default", keeping its database and launch history', async () => {
    await seedM0Install();

    opened = await openStartupProfile(userData);

    expect(opened).toMatchObject({
      profileId: 'default',
      displayName: 'Default',
      source: 'adopted',
    });
    expect(opened.launch.launchCount).toBe(2);
    expect(readdirSync(join(userData, 'profiles'))).toEqual(['default']);
    expect(readProfilesIndex(userData)).toEqual({
      kind: 'ok',
      index: {
        schemaVersion: 1,
        profiles: [{ id: 'default', displayName: 'Default' }],
        lastUsedProfileId: 'default',
      },
    });
  });

  it('creates "Default" with a new UUID when there is no index and no folder', async () => {
    opened = await openStartupProfile(userData);

    expect(opened.source).toBe('created');
    expect(opened.displayName).toBe('Default');
    expect(opened.profileId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(opened.launch.launchCount).toBe(1);
    expect(readSchemaVersion(opened.db)).toBe(MIGRATIONS.length);
    expect(existsSync(profilePaths(userData, opened.profileId).databaseFile)).toBe(true);
    expect(existsSync(join(userData, 'profiles', 'default'))).toBe(false);

    const read = readProfilesIndex(userData);
    expect(read.kind === 'ok' && read.index.lastUsedProfileId).toBe(opened.profileId);
  });

  it('writes no index when the database cannot be opened, so the next launch retries', async () => {
    const future = openDatabase(profilePaths(userData, LEGACY).databaseFile);
    future.exec('PRAGMA user_version = 999;');
    future.close();

    await expect(openStartupProfile(userData)).rejects.toThrow();
    expect(existsSync(profilesIndexPath(userData))).toBe(false);
  });
});

describe('openStartupProfile: later launches', () => {
  it('reopens the profile from the index on the next launch', async () => {
    const first = await openStartupProfile(userData);
    first.db.close();

    opened = await openStartupProfile(userData);
    expect(opened).toMatchObject({ profileId: first.profileId, source: 'index' });
    expect(opened.launch.launchCount).toBe(2);
  });

  it('opens the last-used profile, not the first one listed', async () => {
    for (const id of [LEGACY, WORK]) (await openAppDatabase(userData, id)).db.close();
    await writeProfilesIndex(userData, {
      schemaVersion: 1,
      profiles: [
        { id: LEGACY, displayName: 'Default' },
        { id: WORK, displayName: 'Work' },
      ],
      lastUsedProfileId: WORK,
    });

    opened = await openStartupProfile(userData);
    expect(opened).toMatchObject({ profileId: WORK, displayName: 'Work', source: 'index' });
    expect(opened.launch.launchCount).toBe(2);
  });

  it('refuses a listed profile whose database is gone, instead of creating an empty one', async () => {
    await writeProfilesIndex(userData, {
      schemaVersion: 1,
      profiles: [{ id: WORK, displayName: 'Work' }],
      lastUsedProfileId: WORK,
    });

    await expect(openStartupProfile(userData)).rejects.toBeInstanceOf(ProfileDataMissingError);
    expect(existsSync(join(userData, 'profiles'))).toBe(false);
  });
});

describe('openStartupProfile: untrusted index', () => {
  it('reports a corrupt index and keeps it, without adopting or creating anything', async () => {
    await seedM0Install();
    writeFileSync(profilesIndexPath(userData), 'not json', 'utf8');

    await expect(openStartupProfile(userData)).rejects.toBeInstanceOf(ProfilesIndexCorruptError);
    expect(readFileSync(profilesIndexPath(userData), 'utf8')).toBe('not json');
    expect(readdirSync(join(userData, 'profiles'))).toEqual(['default']);
  });

  it.each([
    ['a traversal last-used ID', '../../outside'],
    ['an absolute path', 'C:\\Users\\Public'],
    ['an unlisted UUID', '00000000-0000-4000-8000-000000000000'],
  ])('refuses %s and touches nothing outside userData', async (_label, lastUsedProfileId) => {
    const content = JSON.stringify({
      schemaVersion: 1,
      profiles: [{ id: WORK, displayName: 'Work' }],
      lastUsedProfileId,
    });
    writeFileSync(profilesIndexPath(userData), content, 'utf8');

    await expect(openStartupProfile(userData)).rejects.toBeInstanceOf(ProfilesIndexCorruptError);
    expect(readFileSync(profilesIndexPath(userData), 'utf8')).toBe(content);
    expect(readdirSync(userData)).toEqual(['profiles-index.json']);
  });

  it('refuses a malicious ID in the profile list', async () => {
    const content = JSON.stringify({
      schemaVersion: 1,
      profiles: [{ id: '..', displayName: 'Up' }],
      lastUsedProfileId: '..',
    });
    writeFileSync(profilesIndexPath(userData), content, 'utf8');

    await expect(openStartupProfile(userData)).rejects.toBeInstanceOf(ProfilesIndexCorruptError);
    expect(readdirSync(userData)).toEqual(['profiles-index.json']);
  });
});

describe('openStartupProfile: no index, but profile data exists', () => {
  const nothingWritten = (): void => {
    expect(existsSync(profilesIndexPath(userData))).toBe(false);
  };

  it('stops when a UUID profile exists, instead of hiding it behind a new empty profile', async () => {
    (await openAppDatabase(userData, WORK)).db.close();

    await expect(openStartupProfile(userData)).rejects.toBeInstanceOf(ProfilesIndexMissingError);
    nothingWritten();
    expect(readdirSync(join(userData, 'profiles'))).toEqual([WORK]);
  });

  it('stops when the M0 folder and another profile both exist', async () => {
    await seedM0Install();
    (await openAppDatabase(userData, WORK)).db.close();

    await expect(openStartupProfile(userData)).rejects.toBeInstanceOf(ProfilesIndexMissingError);
    nothingWritten();
  });

  it('does not adopt an M0 folder whose database is gone', async () => {
    mkdirSync(join(userData, 'profiles', 'default', 'backups'), { recursive: true });

    await expect(openStartupProfile(userData)).rejects.toBeInstanceOf(ProfileDataMissingError);
    nothingWritten();
    expect(existsSync(profilePaths(userData, LEGACY).databaseFile)).toBe(false);
  });

  it('ignores folders that are not valid profile IDs or hold no database', async () => {
    mkdirSync(join(userData, 'profiles', 'not-a-profile'), { recursive: true });
    writeFileSync(join(userData, 'profiles', 'not-a-profile', 'app.sqlite'), '');
    mkdirSync(join(userData, 'profiles', WORK), { recursive: true });

    opened = await openStartupProfile(userData);
    expect(opened.source).toBe('created');
    expect(opened.profileId).not.toBe(WORK);
  });
});

describe('openStartupProfile: housekeeping and races', () => {
  it('removes a temp file left by a crashed index write', async () => {
    const stale = join(userData, 'profiles-index.json.0123456789ab.tmp');
    writeFileSync(stale, '{');

    opened = await openStartupProfile(userData);
    expect(existsSync(stale)).toBe(false);
  });

  it('refuses a listed profile whose database is brand new (it vanished before the open)', async () => {
    // A version-0 file is what SQLite leaves if the real file disappears just before opening.
    openDatabase(profilePaths(userData, WORK).databaseFile).close();
    await writeProfilesIndex(userData, {
      schemaVersion: 1,
      profiles: [{ id: WORK, displayName: 'Work' }],
      lastUsedProfileId: WORK,
    });

    await expect(openStartupProfile(userData)).rejects.toBeInstanceOf(ProfileDataMissingError);
    const check = openDatabase(profilePaths(userData, WORK).databaseFile);
    try {
      expect(readSchemaVersion(check)).toBe(0);
    } finally {
      check.close();
    }
  });
});
