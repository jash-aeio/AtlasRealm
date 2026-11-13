import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Database, openDatabase } from '../../src/main/storage/database';
import { migrate } from '../../src/main/storage/migrate';
import { MIGRATIONS } from '../../src/main/storage/migrations';
import {
  type ProfilePreferences,
  ProfileSettingsRepository,
} from '../../src/main/storage/repositories/profile-settings-repository';
import { RepositoryError } from '../../src/main/storage/repositories/repository-support';

// ProfileSettingsRepository (M1-3, #30) against a real migrated SQLite file.
let dir: string;
let db: Database;
let settings: ProfileSettingsRepository;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-profile-settings-'));
  db = openDatabase(join(dir, 'app.sqlite'));
  await migrate(db, MIGRATIONS, { backupDir: join(dir, 'backups') });
  let clock = new Date('2026-11-11T12:00:00.000Z');
  settings = new ProfileSettingsRepository(db, () => {
    clock = new Date(clock.getTime() + 1_000);
    return clock;
  });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof RepositoryError) return error.code;
    throw error;
  }
  return undefined;
}

const createDefault = (): ReturnType<ProfileSettingsRepository['create']> =>
  settings.create({ profileId: 'default', displayName: 'Ada', timezone: 'Europe/Amsterdam' });

describe('ProfileSettingsRepository', () => {
  it('creates settings with no avatar (the avatar step was skipped) and empty preferences', () => {
    const created = createDefault();
    expect(created).toMatchObject({
      profileId: 'default',
      displayName: 'Ada',
      avatarPreset: null,
      avatarColour: null,
      timezone: 'Europe/Amsterdam',
      preferences: {},
      revision: 1,
    });
    expect(settings.get('default')).toEqual(created);
  });

  it('accepts a UUID profile ID and refuses anything else', () => {
    const uuid = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
    expect(settings.create({ profileId: uuid, displayName: 'Bo', timezone: 'UTC' }).profileId).toBe(
      uuid,
    );
    for (const profileId of ['../default', 'Default', '', '3F2B8C1E-5D4A-4E6F-9A7B-1C2D3E4F5A6B']) {
      expect(codeOf(() => settings.create({ profileId, displayName: 'X', timezone: 'UTC' }))).toBe(
        'invalid_input',
      );
    }
  });

  it('refuses to create settings twice for the same profile', () => {
    createDefault();
    expect(codeOf(createDefault)).toBe('already_exists');
  });

  it.each([
    ['an unknown timezone', { timezone: 'Mars/Olympus_Mons' }],
    ['a UTC offset instead of an IANA ID', { timezone: '+02:00' }],
    ['a bad avatar colour', { avatarColour: 'red' }],
    ['an upper-case avatar colour', { avatarColour: '#A1B2C3' }],
    ['an unsafe avatar preset', { avatarPreset: '../knight' }],
    ['a blank display name', { displayName: '  ' }],
  ])('refuses %s', (_label, overrides) => {
    expect(
      codeOf(() =>
        settings.create({
          profileId: 'default',
          displayName: 'Ada',
          timezone: 'UTC',
          ...overrides,
        }),
      ),
    ).toBe('invalid_input');
    expect(settings.get('default')).toBeUndefined();
  });

  it('refuses preferences that are not a bounded JSON object', () => {
    const tooBig = { blob: 'x'.repeat(16_400) };
    const circular: Record<string, unknown> = { name: 'loop' };
    circular['self'] = circular;
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 40; i += 1) deep = { a: deep }; // under the size limit, too deep
    const bad = [
      tooBig,
      [1, 2],
      circular,
      deep,
      { when: new Date(0) }, // JSON.stringify would silently turn it into a string
      { map: new Map([['a', 1]]) }, // ...and this into {}
      { big: 1n },
      { notANumber: Number.NaN },
      null,
    ] as unknown as ProfilePreferences[];
    for (const preferences of bad.slice(0, -1)) {
      expect(
        codeOf(() =>
          settings.create({
            profileId: 'default',
            displayName: 'Ada',
            timezone: 'UTC',
            preferences,
          }),
        ),
      ).toBe('invalid_input');
    }
    createDefault();
    for (const preferences of bad) {
      expect(codeOf(() => settings.update('default', 1, { preferences }))).toBe('invalid_input');
    }
    expect(settings.get('default')).toMatchObject({ preferences: {}, revision: 1 });
  });

  it('accepts nested preferences up to the depth limit', () => {
    let nested: Record<string, unknown> = { reducedMotion: true };
    // The top-level object is level 1, so this makes exactly 32 levels of objects.
    for (let i = 0; i < 30; i += 1) nested = { a: nested };
    expect(
      settings.create({
        profileId: 'default',
        displayName: 'Ada',
        timezone: 'UTC',
        preferences: { list: [1, 'two', null, false], nested },
      }).preferences,
    ).toMatchObject({ list: [1, 'two', null, false] });
  });

  it('stores timezones in their canonical spelling', () => {
    expect(
      settings.create({ profileId: 'default', displayName: 'Ada', timezone: 'europe/amsterdam' })
        .timezone,
    ).toBe('Europe/Amsterdam');
  });

  it('accepts IANA IDs that contain offsets, such as Etc/GMT+2', () => {
    expect(
      settings.create({ profileId: 'default', displayName: 'Ada', timezone: 'Etc/GMT+2' }).timezone,
    ).toBe('Etc/GMT+2');
  });

  it('updates only the given fields, with the expected revision', () => {
    createDefault();
    const updated = settings.update('default', 1, {
      avatarPreset: 'knight',
      avatarColour: '#a1b2c3',
      preferences: { reducedMotion: true },
    });
    expect(updated).toMatchObject({
      displayName: 'Ada',
      timezone: 'Europe/Amsterdam',
      avatarPreset: 'knight',
      avatarColour: '#a1b2c3',
      preferences: { reducedMotion: true },
      revision: 2,
    });

    // null clears the avatar again.
    expect(settings.update('default', 2, { avatarPreset: null, avatarColour: null })).toMatchObject(
      { avatarPreset: null, avatarColour: null, revision: 3 },
    );
  });

  it('refuses a stale revision and changes nothing', () => {
    createDefault();
    settings.update('default', 1, { displayName: 'Ada L.' });
    const before = settings.get('default');

    let error: unknown;
    try {
      settings.update('default', 1, { timezone: 'UTC' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RepositoryError);
    expect(error).toMatchObject({ code: 'revision_conflict', currentRevision: 2 });
    expect(settings.get('default')).toEqual(before);
  });

  it('refuses an empty patch and an unknown profile', () => {
    createDefault();
    expect(codeOf(() => settings.update('default', 1, {}))).toBe('invalid_input');
    expect(
      codeOf(() =>
        settings.update('3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b', 1, { displayName: 'X' }),
      ),
    ).toBe('not_found');
  });
});
