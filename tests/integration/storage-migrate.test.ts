import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Database, openDatabase, openDatabaseReadOnly } from '../../src/main/storage/database';
import {
  DatabaseNewerThanAppError,
  migrate,
  MigrationFailedError,
  readSchemaVersion,
} from '../../src/main/storage/migrate';
import type { Migration } from '../../src/main/storage/migration-rules';

const V1: Migration = {
  version: 1,
  name: 'create_notes',
  up: 'CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;',
};
const V2: Migration = {
  version: 2,
  name: 'add_note_title',
  up: "ALTER TABLE notes ADD COLUMN title TEXT NOT NULL DEFAULT '';",
};
const BROKEN_V2: Migration = {
  version: 2,
  name: 'broken',
  // The first statement succeeds, the second fails: both must be rolled back.
  up: 'CREATE TABLE extra (id TEXT) STRICT; INSERT INTO no_such_table VALUES (1);',
};

const fixedNow = () => new Date('2026-11-08T12:34:56.789Z');

let dir: string;
let backupDir: string;
let db: Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-migrate-'));
  backupDir = join(dir, 'backups');
  db = openDatabase(join(dir, 'app.sqlite'));
});

afterEach(() => {
  if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

const tableNames = (database: Database): string[] =>
  database
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row['name']));

describe('migrate', () => {
  it('brings a fresh database to the latest version without a backup', async () => {
    const report = await migrate(db, [V1, V2], { backupDir, now: fixedNow });

    expect(report).toEqual({ fromVersion: 0, toVersion: 2, applied: [1, 2], backupPath: null });
    expect(readSchemaVersion(db)).toBe(2);
    expect(db.prepare('SELECT version, name, applied_at FROM schema_migrations').all()).toEqual([
      { version: 1, name: 'create_notes', applied_at: '2026-11-08T12:34:56.789Z' },
      { version: 2, name: 'add_note_title', applied_at: '2026-11-08T12:34:56.789Z' },
    ]);
    expect(existsSync(backupDir)).toBe(false);
  });

  it('backs up an existing database before upgrading it, with its data intact', async () => {
    await migrate(db, [V1], { backupDir });
    db.exec("INSERT INTO notes (id, body) VALUES ('n1', 'keep me');");

    const report = await migrate(db, [V1, V2], { backupDir, now: fixedNow });

    expect(report.applied).toEqual([2]);
    expect(report.backupPath).toBe(
      join(backupDir, 'app-v1-before-v2-2026-11-08T12-34-56-789Z.sqlite'),
    );
    const copy = openDatabaseReadOnly(report.backupPath ?? '');
    try {
      expect(readSchemaVersion(copy)).toBe(1);
      expect(copy.prepare('SELECT body FROM notes').all()).toEqual([{ body: 'keep me' }]);
    } finally {
      copy.close();
    }
  });

  it('is a no-op when already up to date', async () => {
    await migrate(db, [V1, V2], { backupDir });
    const report = await migrate(db, [V1, V2], { backupDir });

    expect(report).toEqual({ fromVersion: 2, toVersion: 2, applied: [], backupPath: null });
    expect(existsSync(backupDir)).toBe(false);
  });

  it('rolls back a failing migration, stays at the old version and keeps the backup', async () => {
    await migrate(db, [V1], { backupDir });

    const failure = await migrate(db, [V1, BROKEN_V2], { backupDir }).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(MigrationFailedError);
    const error = failure as MigrationFailedError;
    expect(error.databaseVersion).toBe(1);
    expect(error.cause).toBeInstanceOf(Error);
    expect(readSchemaVersion(db)).toBe(1);
    expect(tableNames(db)).not.toContain('extra');
    expect(db.prepare('SELECT max(version) AS v FROM schema_migrations').get()).toEqual({ v: 1 });
    expect(error.backupPath).not.toBeNull();
    expect(readdirSync(backupDir)).toHaveLength(1);
  });

  it('refuses a database from a newer app version and leaves it untouched', async () => {
    await migrate(db, [V1, V2], { backupDir });

    await expect(migrate(db, [V1], { backupDir })).rejects.toBeInstanceOf(
      DatabaseNewerThanAppError,
    );
    expect(readSchemaVersion(db)).toBe(2);
    expect(existsSync(backupDir)).toBe(false);
  });

  it('persists the schema version across reopening the file', async () => {
    await migrate(db, [V1, V2], { backupDir });
    db.close();

    db = openDatabase(join(dir, 'app.sqlite'));
    expect(readSchemaVersion(db)).toBe(2);
    expect(tableNames(db)).toEqual(['notes', 'schema_migrations']);
  });
});
