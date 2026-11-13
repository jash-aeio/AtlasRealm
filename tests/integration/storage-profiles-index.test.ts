import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  InvalidProfileIdError,
  LEGACY_PROFILE_ID,
  newProfileId,
  toProfileId,
} from '../../src/main/storage/profiles/profile-id';
import {
  PROFILES_INDEX_FILE,
  type ProfilesIndex,
  ProfilesIndexCorruptError,
  profilesIndexPath,
  readProfilesIndex,
  removeStaleIndexTempFiles,
  writeProfilesIndex,
} from '../../src/main/storage/profiles/profiles-index';

const UUID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

let userData: string;

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'atlas-profiles-'));
});

afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

function validIndex(): ProfilesIndex {
  return {
    schemaVersion: 1,
    profiles: [
      { id: toProfileId(LEGACY_PROFILE_ID), displayName: 'Default' },
      { id: toProfileId(UUID), displayName: 'Work' },
    ],
    lastUsedProfileId: toProfileId(UUID),
  };
}

function writeRaw(content: string): void {
  writeFileSync(profilesIndexPath(userData), content, 'utf8');
}

function expectCorrupt(reason: string): void {
  let caught: unknown;
  try {
    readProfilesIndex(userData);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ProfilesIndexCorruptError);
  expect((caught as ProfilesIndexCorruptError).reason).toBe(reason);
}

describe('profile IDs', () => {
  it('accepts the legacy ID and lowercase UUIDs', () => {
    expect(toProfileId('default')).toBe('default');
    expect(toProfileId(UUID)).toBe(UUID);
  });

  it('creates new IDs as lowercase UUIDs', () => {
    const id = newProfileId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newProfileId()).not.toBe(id);
  });

  it.each([
    ['parent traversal', '../evil'],
    ['Windows traversal', '..\\evil'],
    ['nested path', 'default/../../x'],
    ['absolute Windows path', 'C:\\Windows'],
    ['absolute POSIX path', '/etc'],
    ['upper-case legacy ID', 'DEFAULT'],
    ['upper-case UUID', UUID.toUpperCase()],
    ['UUID with braces', `{${UUID}}`],
    ['reserved device name', 'CON'],
    ['display name', 'My Profile'],
    ['empty string', ''],
    ['trailing newline', 'default\n'],
    ['non-string', 42],
  ])('refuses %s', (_label, value) => {
    expect(() => toProfileId(value)).toThrow(InvalidProfileIdError);
  });
});

describe('readProfilesIndex', () => {
  it('reports a missing index without creating one', () => {
    expect(readProfilesIndex(userData)).toEqual({ kind: 'missing' });
    expect(readdirSync(userData)).toEqual([]);
  });

  it('round-trips a written index', async () => {
    await writeProfilesIndex(userData, validIndex());
    expect(readProfilesIndex(userData)).toEqual({ kind: 'ok', index: validIndex() });
  });

  it('reports an index from a newer app version as newer, not damaged, and keeps it', () => {
    const content = JSON.stringify({ schemaVersion: 2, profiles: 'whatever the future holds' });
    writeRaw(content);
    expectCorrupt('newer_version');
    expect(readFileSync(profilesIndexPath(userData), 'utf8')).toBe(content);
  });

  it('refuses invalid JSON and keeps the file byte for byte', () => {
    const content = '{"schemaVersion": 1, "profiles": [';
    writeRaw(content);
    expectCorrupt('invalid_json');
    expect(readFileSync(profilesIndexPath(userData), 'utf8')).toBe(content);
  });

  it.each([
    ['a schema version given as text', { ...validIndex(), schemaVersion: '2' }],
    ['schema version 0', { ...validIndex(), schemaVersion: 0 }],
    ['an empty profile list', { ...validIndex(), profiles: [] }],
    ['an unknown top-level key', { ...validIndex(), dataDir: 'D:\\elsewhere' }],
    [
      'an unknown key on a profile',
      { ...validIndex(), profiles: [{ id: UUID, displayName: 'Work', path: '..' }] },
    ],
    [
      'a last-used profile that is not listed',
      {
        ...validIndex(),
        lastUsedProfileId: '00000000-0000-4000-8000-000000000000',
      },
    ],
    [
      'duplicate IDs',
      {
        ...validIndex(),
        profiles: [
          { id: UUID, displayName: 'A' },
          { id: UUID, displayName: 'B' },
        ],
      },
    ],
    [
      'a traversal ID in the list',
      {
        ...validIndex(),
        profiles: [{ id: '../../evil', displayName: 'Evil' }],
        lastUsedProfileId: '../../evil',
      },
    ],
    ['a traversal last-used ID', { ...validIndex(), lastUsedProfileId: '..\\..\\evil' }],
    [
      'an empty display name',
      { ...validIndex(), profiles: [{ id: UUID, displayName: '   ' }], lastUsedProfileId: UUID },
    ],
    [
      'a display name with control characters',
      {
        ...validIndex(),
        profiles: [{ id: UUID, displayName: 'Work\u0000' }],
        lastUsedProfileId: UUID,
      },
    ],
    ['an array', [validIndex()]],
    ['null', null],
  ])('refuses %s and keeps the file', (_label, value) => {
    const content = JSON.stringify(value);
    writeRaw(content);
    expectCorrupt('invalid_shape');
    expect(readFileSync(profilesIndexPath(userData), 'utf8')).toBe(content);
  });
});

describe('writeProfilesIndex', () => {
  it('replaces the previous index and leaves no temp file behind', async () => {
    await writeProfilesIndex(userData, validIndex());
    const next = { ...validIndex(), lastUsedProfileId: toProfileId(LEGACY_PROFILE_ID) };
    await writeProfilesIndex(userData, next);

    expect(readProfilesIndex(userData)).toEqual({ kind: 'ok', index: next });
    expect(readdirSync(userData)).toEqual([PROFILES_INDEX_FILE]);
  });

  it('refuses to write an invalid index and keeps the old one', async () => {
    await writeProfilesIndex(userData, validIndex());
    const before = readFileSync(profilesIndexPath(userData), 'utf8');
    const invalid = { ...validIndex(), profiles: [] } as unknown as ProfilesIndex;

    await expect(writeProfilesIndex(userData, invalid)).rejects.toThrow();
    expect(readFileSync(profilesIndexPath(userData), 'utf8')).toBe(before);
    expect(readdirSync(userData)).toEqual([PROFILES_INDEX_FILE]);
  });

  it('writes only IDs, names, the last-used ID and the schema version', async () => {
    await writeProfilesIndex(userData, validIndex());
    const json = JSON.parse(readFileSync(profilesIndexPath(userData), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(Object.keys(json).sort()).toEqual(['lastUsedProfileId', 'profiles', 'schemaVersion']);
  });
});

describe('removeStaleIndexTempFiles', () => {
  it('removes only leftover temp files, never the index or look-alikes', async () => {
    await writeProfilesIndex(userData, validIndex());
    const keep = ['profiles-index.json.tmp', 'profiles-index.json.ABCDEF123456.tmp', 'notes.tmp'];
    for (const name of [...keep, 'profiles-index.json.0123456789ab.tmp']) {
      writeFileSync(join(userData, name), 'x');
    }

    removeStaleIndexTempFiles(userData);

    expect(readdirSync(userData).sort()).toEqual([PROFILES_INDEX_FILE, ...keep].sort());
  });
});
