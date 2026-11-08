import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Database, openDatabase, withTransaction } from '../../src/main/storage/database';

let dir: string;
let db: Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-db-'));
  // A nested folder that doesn't exist yet: openDatabase must create it.
  db = openDatabase(join(dir, 'nested', 'app.sqlite'));
  db.exec('CREATE TABLE parent (id TEXT PRIMARY KEY) STRICT;');
  db.exec(
    'CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parent(id)) STRICT;',
  );
});

afterEach(() => {
  if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

const count = (table: string): number =>
  Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n']);

describe('openDatabase', () => {
  it('enforces foreign keys', () => {
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    expect(() => {
      db.exec("INSERT INTO child VALUES ('c1', 'missing-parent');");
    }).toThrow(/FOREIGN KEY/);
  });

  it('uses write-ahead logging', () => {
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
  });
});

describe('withTransaction', () => {
  it('commits all writes when work succeeds', () => {
    const result = withTransaction(db, (tx) => {
      tx.exec("INSERT INTO parent VALUES ('p1');");
      tx.exec("INSERT INTO child VALUES ('c1', 'p1');");
      return 'done';
    });
    expect(result).toBe('done');
    expect(count('parent')).toBe(1);
    expect(count('child')).toBe(1);
  });

  it('rolls back every write when work throws midway', () => {
    expect(() => {
      withTransaction(db, (tx) => {
        tx.exec("INSERT INTO parent VALUES ('p1');");
        tx.exec("INSERT INTO child VALUES ('c1', 'missing-parent');"); // FK violation
      });
    }).toThrow(/FOREIGN KEY/);
    expect(count('parent')).toBe(0);
    expect(db.isTransaction).toBe(false);
  });

  it('rejects async work and rolls it back', () => {
    expect(() =>
      withTransaction(db, async (tx) => {
        tx.exec("INSERT INTO parent VALUES ('p1');");
        await Promise.resolve();
      }),
    ).toThrow(/synchronous/);
    expect(count('parent')).toBe(0);
  });

  it('refuses to nest', () => {
    expect(() => withTransaction(db, (tx) => withTransaction(tx, () => 1))).toThrow(/nesting/);
    expect(db.isTransaction).toBe(false);
  });
});
