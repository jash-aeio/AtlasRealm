import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type Database,
  openDatabase,
  TransactionAbortedError,
  withSavepoint,
  withTransaction,
} from '../../src/main/storage/database';

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

  it('does not trust code stored in the schema (views/triggers)', () => {
    expect(db.prepare('PRAGMA trusted_schema').get()).toEqual({ trusted_schema: 0 });
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

describe('withSavepoint', () => {
  const insertParent = (id: string): void => {
    db.prepare('INSERT INTO parent VALUES (?)').run(id);
  };
  const parents = (): string[] =>
    db
      .prepare('SELECT id FROM parent ORDER BY id')
      .all()
      .map((row) => String(row['id']));

  it('opens its own transaction when none is open', () => {
    expect(() =>
      withSavepoint(db, () => {
        insertParent('p1');
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(count('parent')).toBe(0);
    expect(db.isTransaction).toBe(false);
  });

  it('undoes only its own writes after an ordinary error, and nests', () => {
    withTransaction(db, () => {
      insertParent('a');
      withSavepoint(db, () => {
        insertParent('b');
        expect(() => {
          withSavepoint(db, () => {
            insertParent('c');
            insertParent('a'); // duplicate key
          });
        }).toThrow(/UNIQUE/);
      });
    });
    expect(parents()).toEqual(['a', 'b']);
  });

  it('refuses to join a transaction that withTransaction did not open', () => {
    db.exec('BEGIN;');
    expect(() => {
      withSavepoint(db, () => {
        insertParent('p1');
      });
    }).toThrow(/not opened by withTransaction/);
    db.exec('ROLLBACK;');
  });

  // SQLite rolls back the whole transaction by itself after some errors (disk full, I/O). A
  // raw ROLLBACK inside `work` stands in for that, deterministically.
  it('never lets later writes autocommit after SQLite cancelled the transaction', () => {
    expect(() => {
      withTransaction(db, () => {
        insertParent('a');
        try {
          withSavepoint(db, () => {
            db.exec('ROLLBACK;');
            throw new Error('database or disk is full');
          });
        } catch {
          // A caller that (wrongly) carries on...
        }
        withSavepoint(db, () => {
          insertParent('b');
        });
      });
    }).toThrow(TransactionAbortedError);
    expect(count('parent')).toBe(0);
    expect(db.isTransaction).toBe(false);
  });

  it('refuses to commit if work swallowed the error that cancelled the transaction', () => {
    expect(() => {
      withTransaction(db, () => {
        insertParent('a');
        try {
          withSavepoint(db, () => {
            db.exec('ROLLBACK;');
            throw new Error('disk I/O error');
          });
        } catch {
          // swallowed
        }
      });
    }).toThrow(TransactionAbortedError);
    expect(count('parent')).toBe(0);
  });

  it('with a really full disk, keeps all writes or none, never half', () => {
    const pageCount = Number(db.prepare('PRAGMA page_count').get()?.['page_count']);
    db.exec(`PRAGMA max_page_count = ${String(pageCount + 1)};`);
    db.exec('CREATE TABLE big (data BLOB) STRICT;');
    let outcome: unknown = 'committed';
    try {
      withTransaction(db, () => {
        insertParent('a');
        try {
          withSavepoint(db, () => {
            db.prepare('INSERT INTO big VALUES (randomblob(1000000))').run();
          });
        } catch {
          // carry on
        }
        withSavepoint(db, () => {
          insertParent('b');
        });
      });
    } catch (error) {
      outcome = error;
    }
    // Whether SQLite cancelled the whole transaction or only the statement, the result is
    // consistent: both writes, or (with TransactionAbortedError) neither.
    if (outcome === 'committed') expect(parents()).toEqual(['a', 'b']);
    else {
      expect(outcome).toBeInstanceOf(TransactionAbortedError);
      expect(parents()).toEqual([]);
    }
    expect(db.isTransaction).toBe(false);
  });
});
