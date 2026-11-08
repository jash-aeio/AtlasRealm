import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openAppDatabase, profilePaths } from '../../src/main/storage/app-database';
import { openDatabase } from '../../src/main/storage/database';
import { DatabaseNewerThanAppError, readSchemaVersion } from '../../src/main/storage/migrate';

let userData: string;

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'atlas-userdata-'));
});

afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

describe('profilePaths', () => {
  it('follows the DATA_MODEL §9.1 layout under userData', () => {
    expect(profilePaths(userData)).toEqual({
      profileDir: join(userData, 'profiles', 'default'),
      databaseFile: join(userData, 'profiles', 'default', 'app.sqlite'),
      backupDir: join(userData, 'profiles', 'default', 'backups'),
    });
  });
});

describe('openAppDatabase', () => {
  it('creates, migrates and records the first launch', async () => {
    const opened = await openAppDatabase(userData);
    try {
      expect(existsSync(profilePaths(userData).databaseFile)).toBe(true);
      expect(opened.migration.applied.length).toBeGreaterThan(0);
      expect(opened.launch.launchCount).toBe(1);
    } finally {
      opened.db.close();
    }
  });

  it('refuses a database from a newer app version and leaves it untouched', async () => {
    const future = openDatabase(profilePaths(userData).databaseFile);
    future.exec('PRAGMA user_version = 999;');
    future.close();

    await expect(openAppDatabase(userData)).rejects.toBeInstanceOf(DatabaseNewerThanAppError);

    const check = openDatabase(profilePaths(userData).databaseFile);
    try {
      expect(readSchemaVersion(check)).toBe(999);
    } finally {
      check.close();
    }
  });
});
