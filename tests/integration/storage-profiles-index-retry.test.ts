// Windows: renaming over a file fails briefly (EBUSY/EPERM) while antivirus or the search
// indexer holds it. The real rename is wrapped so these tests can make it fail on demand.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const failures = vi.hoisted(() => ({ codes: [] as string[] }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...real,
    rename: async (from: string, to: string): Promise<void> => {
      const code = failures.codes.shift();
      if (code !== undefined) {
        throw Object.assign(new Error(`simulated ${code}`), { code });
      }
      await real.rename(from, to);
    },
  };
});

const { readProfilesIndex, writeProfilesIndex, PROFILES_INDEX_FILE } =
  await import('../../src/main/storage/profiles/profiles-index');
const { LEGACY_PROFILE_ID, toProfileId } =
  await import('../../src/main/storage/profiles/profile-id');

const index = {
  schemaVersion: 1 as const,
  profiles: [{ id: toProfileId(LEGACY_PROFILE_ID), displayName: 'Default' }],
  lastUsedProfileId: toProfileId(LEGACY_PROFILE_ID),
};

let userData: string;

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'atlas-retry-'));
  failures.codes = [];
});

afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

describe('writeProfilesIndex on a busy file system', () => {
  it('retries a briefly locked target and then succeeds', async () => {
    failures.codes = ['EBUSY', 'EPERM'];

    await writeProfilesIndex(userData, index);

    expect(readProfilesIndex(userData)).toEqual({ kind: 'ok', index });
    expect(readdirSync(userData)).toEqual([PROFILES_INDEX_FILE]);
  });

  it('gives up after five attempts, reports the real error and leaves no temp file', async () => {
    failures.codes = ['EBUSY', 'EBUSY', 'EBUSY', 'EBUSY', 'EBUSY'];

    await expect(writeProfilesIndex(userData, index)).rejects.toMatchObject({ code: 'EBUSY' });
    expect(readdirSync(userData)).toEqual([]);
  });

  it('does not retry errors that will not go away', async () => {
    failures.codes = ['ENOSPC', 'EBUSY'];

    await expect(writeProfilesIndex(userData, index)).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(failures.codes).toEqual(['EBUSY']);
    expect(readdirSync(userData)).toEqual([]);
  });
});
