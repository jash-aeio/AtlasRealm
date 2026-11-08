// Migration runner (DATA_MODEL §9.2, OFFLINE_AND_RECOVERY §19): brings a database up to the
// newest schema this app knows, one numbered migration at a time.
//   - The schema version lives in `PRAGMA user_version` (an integer in the file header).
//   - Each migration runs in its own transaction together with its version bump and its
//     `schema_migrations` row, so a failure leaves the database at the previous version.
//   - Before upgrading a database that already has data, a consistent copy is taken with
//     SQLite's online backup API. It is never deleted here: it is the recovery path.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { backupDatabase, type Database, openDatabaseReadOnly, withTransaction } from './database';
import { assertMigrationsAreValid, type Migration } from './migration-rules';

export interface MigrateOptions {
  /** Folder for pre-migration backups (created if missing). */
  readonly backupDir: string;
  /** Injected clock, so tests get predictable backup names. */
  readonly now?: () => Date;
}

export interface MigrationReport {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly applied: readonly number[];
  /** Where the pre-migration backup went, or null when none was needed. */
  readonly backupPath: string | null;
}

/** The database was written by a newer app version; opening it could corrupt its data. */
export class DatabaseNewerThanAppError extends Error {
  constructor(
    readonly databaseVersion: number,
    readonly appVersion: number,
  ) {
    super(
      `Database schema v${String(databaseVersion)} is newer than this app supports ` +
        `(v${String(appVersion)}). It was left untouched.`,
    );
    this.name = 'DatabaseNewerThanAppError';
  }
}

/** A migration threw. The database stays at `databaseVersion`; `backupPath` holds the copy. */
export class MigrationFailedError extends Error {
  constructor(
    readonly migration: Pick<Migration, 'version' | 'name'>,
    readonly databaseVersion: number,
    readonly backupPath: string | null,
    options: { cause: unknown },
  ) {
    super(
      `Migration v${String(migration.version)} "${migration.name}" failed; ` +
        `the database is still at v${String(databaseVersion)}.`,
      options,
    );
    this.name = 'MigrationFailedError';
  }
}

export function readSchemaVersion(db: Database): number {
  return Number(db.prepare('PRAGMA user_version').get()?.['user_version'] ?? 0);
}

const CREATE_SCHEMA_MIGRATIONS = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    applied_at TEXT    NOT NULL  -- UTC ISO-8601 instant
  ) STRICT;`;

export async function migrate(
  db: Database,
  migrations: readonly Migration[],
  options: MigrateOptions,
): Promise<MigrationReport> {
  assertMigrationsAreValid(migrations);
  const now = options.now ?? (() => new Date());

  const fromVersion = readSchemaVersion(db);
  const latest = migrations.at(-1)?.version ?? 0;
  if (fromVersion > latest) throw new DatabaseNewerThanAppError(fromVersion, latest);

  const pending = migrations.filter((migration) => migration.version > fromVersion);
  if (pending.length === 0) {
    return { fromVersion, toVersion: fromVersion, applied: [], backupPath: null };
  }

  // Version 0 means a brand-new, empty database: there is nothing to protect yet.
  const backupPath =
    fromVersion > 0 ? await backupBeforeMigrating(db, fromVersion, latest, options, now) : null;

  const applied: number[] = [];
  for (const migration of pending) {
    try {
      withTransaction(db, (tx) => {
        tx.exec(CREATE_SCHEMA_MIGRATIONS);
        tx.exec(migration.up);
        tx.prepare(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        ).run(migration.version, migration.name, now().toISOString());
        // PRAGMA can't take bound parameters; the version is a validated integer.
        tx.exec(`PRAGMA user_version = ${String(migration.version)};`);
      });
    } catch (error) {
      throw new MigrationFailedError(migration, readSchemaVersion(db), backupPath, {
        cause: error,
      });
    }
    applied.push(migration.version);
  }

  return { fromVersion, toVersion: latest, applied, backupPath };
}

async function backupBeforeMigrating(
  db: Database,
  fromVersion: number,
  toVersion: number,
  options: MigrateOptions,
  now: () => Date,
): Promise<string> {
  mkdirSync(options.backupDir, { recursive: true });
  // Windows forbids ':' in file names, so the ISO timestamp loses its colons.
  const stamp = now().toISOString().replace(/[:.]/g, '-');
  const path = join(
    options.backupDir,
    `app-v${String(fromVersion)}-before-v${String(toVersion)}-${stamp}.sqlite`,
  );
  await backupDatabase(db, path);

  // Never migrate on the strength of a backup we haven't looked at.
  const copy = openDatabaseReadOnly(path);
  try {
    if (readSchemaVersion(copy) !== fromVersion) {
      throw new Error(`Pre-migration backup ${path} does not match the database; not migrating.`);
    }
  } finally {
    copy.close();
  }
  return path;
}
