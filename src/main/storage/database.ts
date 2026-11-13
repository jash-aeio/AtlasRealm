// The only module that imports `node:sqlite` (ADR-0010). Everything else in the app reaches
// the database through repositories in this folder, so an API change in the binding (it is a
// release candidate) or a switch to another binding stays contained here.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

export type Database = DatabaseSync;
/** A value that can be bound to a statement parameter. */
export type { SQLInputValue } from 'node:sqlite';

/** How long a statement waits for a lock held by another connection before failing. */
const BUSY_TIMEOUT_MS = 5_000;

/**
 * Settings for every connection, including ones to files we didn't create (restores, imports):
 * - defensive: ordinary SQL can't deliberately corrupt the file (explicit, though the default)
 * - trusted_schema OFF: functions with side effects can't run from views or triggers stored
 *   in the file, so a crafted database can't make the app do things just by being queried
 * Extensions stay disabled (`allowExtension` is never set).
 */
const SAFE_CONNECTION = { defensive: true } as const;

function hardenConnection(db: Database): void {
  db.exec('PRAGMA trusted_schema = OFF;');
}

/**
 * Opens (creating if needed) the SQLite file at `path` with the app's standard settings:
 * foreign keys enforced (DATA_MODEL §9.2) and write-ahead logging, which keeps the file
 * consistent if the app crashes mid-write and lets readers run while one writer writes.
 */
export function openDatabase(path: string): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, {
    ...SAFE_CONNECTION,
    enableForeignKeyConstraints: true,
    timeout: BUSY_TIMEOUT_MS,
  });
  try {
    hardenConnection(db);
    db.exec('PRAGMA journal_mode = WAL;');
    // Safe with WAL: a crash can lose the last commit but never corrupts the database.
    db.exec('PRAGMA synchronous = NORMAL;');
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

/** Opens an existing database file for reading only (used to check backups). */
export function openDatabaseReadOnly(path: string): Database {
  const db = new DatabaseSync(path, { ...SAFE_CONNECTION, readOnly: true });
  try {
    hardenConnection(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

/**
 * Writes a consistent copy of a live database to `path` using SQLite's online backup API.
 * Copying the .sqlite file directly could miss writes still sitting in the WAL file.
 * The copy is switched out of WAL mode so it stays one self-contained file.
 */
export async function backupDatabase(db: Database, path: string): Promise<void> {
  await backup(db, path);
  const copy = new DatabaseSync(path, SAFE_CONNECTION);
  try {
    copy.exec('PRAGMA journal_mode = DELETE;');
  } finally {
    copy.close();
  }
}

/** Reads the live flag (a plain property read would be narrowed by TypeScript to its old value). */
function inTransaction(db: Database): boolean {
  return db.isTransaction;
}

/**
 * Thrown when a transaction can't go on: SQLite already rolled it back on its own (it does that
 * after some I/O, disk-full or out-of-memory errors), or undoing a failed savepoint failed.
 * Nothing in it can be committed; the outermost withTransaction rolls back whatever is left.
 */
export class TransactionAbortedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TransactionAbortedError';
  }
}

// The transactions withTransaction opened, one per connection. withSavepoint joins only these,
// so it can tell "inside our transaction" from "SQLite cancelled it" and from "something else
// left a transaction open" (which it refuses instead of silently joining).
interface TransactionFrame {
  aborted: boolean;
}
const openTransactions = new WeakMap<Database, TransactionFrame>();

/**
 * Runs `work` inside one transaction: everything it writes is committed together, or, if it
 * throws, none of it is. `work` must be synchronous. An `await` inside would let other code
 * run while the transaction is still open, so a returned Promise is rejected (and rolled back).
 */
export function withTransaction<T>(db: Database, work: (db: Database) => T): T {
  if (inTransaction(db) || openTransactions.has(db)) {
    throw new Error('withTransaction: a transaction is already open (nesting is not supported)');
  }
  // IMMEDIATE takes the write lock now, so the transaction can't fail halfway on a busy lock.
  db.exec('BEGIN IMMEDIATE;');
  const frame: TransactionFrame = { aborted: false };
  openTransactions.set(db, frame);
  try {
    const result = work(db);
    if (result instanceof Promise) {
      throw new Error('withTransaction: work must be synchronous (it returned a Promise)');
    }
    // `work` may have caught an error that cancelled the transaction and carried on.
    if (frame.aborted || !inTransaction(db)) {
      throw new TransactionAbortedError(
        'withTransaction: the transaction was aborted; not committing',
      );
    }
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    if (inTransaction(db)) db.exec('ROLLBACK;');
    throw error;
  } finally {
    openTransactions.delete(db);
  }
}

/**
 * Like withTransaction, but it also works inside a transaction withTransaction opened. With no
 * open transaction it simply calls withTransaction. Inside one, it marks a SAVEPOINT (a named
 * checkpoint): if `work` throws an ordinary error (a failed constraint, invalid input), only the
 * writes since the checkpoint are undone and the outer transaction can carry on; if `work`
 * succeeds, its writes join the outer transaction and are committed (or rolled back) with it.
 * Repositories use this for writes that must happen together, so a caller can still group
 * several of those calls in its own transaction.
 *
 * If SQLite rolled the whole transaction back on its own, the transaction is marked aborted:
 * every later withSavepoint in it throws TransactionAbortedError and the outer one won't commit.
 * Writes can never fall through to autocommit (saved one by one) by accident.
 */
export function withSavepoint<T>(db: Database, work: (db: Database) => T): T {
  const frame = openTransactions.get(db);
  if (frame === undefined) {
    if (inTransaction(db)) {
      throw new Error('withSavepoint: a transaction not opened by withTransaction is open');
    }
    return withTransaction(db, work);
  }
  if (frame.aborted || !inTransaction(db)) {
    frame.aborted = true;
    throw new TransactionAbortedError('withSavepoint: the surrounding transaction was aborted');
  }
  // One fixed name is enough: savepoints nest, and RELEASE / ROLLBACK TO act on the most
  // recent one with that name.
  db.exec('SAVEPOINT nested_write;');
  try {
    const result = work(db);
    if (result instanceof Promise) {
      throw new Error('withSavepoint: work must be synchronous (it returned a Promise)');
    }
    db.exec('RELEASE nested_write;');
    return result;
  } catch (error) {
    if (!inTransaction(db)) {
      // SQLite already rolled back the whole transaction, savepoint included.
      frame.aborted = true;
      throw error;
    }
    try {
      // ROLLBACK TO undoes the writes but keeps the savepoint open; RELEASE then removes it.
      db.exec('ROLLBACK TO nested_write;');
      db.exec('RELEASE nested_write;');
    } catch (rollbackError) {
      // The transaction is in an unknown state: don't let anything commit it.
      frame.aborted = true;
      throw new TransactionAbortedError('withSavepoint: undoing the savepoint failed', {
        cause: new AggregateError([error, rollbackError]),
      });
    }
    throw error;
  }
}
