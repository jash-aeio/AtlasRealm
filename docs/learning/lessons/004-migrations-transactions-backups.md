# Lesson 004: Database migrations, transactions and safe backups
**Milestone:** M0 · **Date:** 2026-11-08 · **Related:** `src/main/storage/`, [ADR-0004](../../adr/0004-sqlite-local-first-storage.md), [ADR-0010](../../adr/0010-node-sqlite-binding.md), DATA_MODEL §9.2

## The concept (plain words)
- **Migration:** a numbered, never-edited script that changes the database's shape (e.g. "create table `app_meta`"). The database remembers the last number it ran. On startup the app runs every newer one, in order.
- **Transaction:** a group of writes that succeeds or fails *as one*. If anything inside fails, `ROLLBACK` undoes it all, as if nothing happened.
- **Online backup:** a consistent copy of a database that's in use, made by SQLite itself. Copying the `.sqlite` file directly can miss writes still sitting in the WAL (write-ahead log) file.

## Why Atlas Realm needs it
Users keep their data across app updates. Version 0.3 might add a column that 0.2 didn't have. Migrations upgrade old data step by step. Transactions make sure a crash halfway can't leave a half-upgraded database. The backup is the escape hatch if a migration has a bug. The spec's rule: *never overwrite the only copy* (OFFLINE_AND_RECOVERY §19).

## Where it lives in our code
- `migrations/index.ts`: the list. Append only.
- `migrate.ts`: the runner. Simplified:
  ```ts
  const from = PRAGMA user_version;          // last applied number
  if (from > latest) refuse;                 // DB from a newer app: don't touch it
  if (from > 0) await backup → backups/…;    // protect existing data first
  for (const m of pending)
    withTransaction(db, () => { exec(m.up); log row; user_version = m.version; });
  ```
  The version bump is *inside* the same transaction as the change, so the two can never disagree.
- `database.ts`: `withTransaction` (`BEGIN IMMEDIATE` … `COMMIT`, or `ROLLBACK` if it throws).
- `migration-rules.ts`: versions must be exactly 1, 2, 3, ….

## Common mistakes
- **Editing a released migration.** Users who already ran it never get your edit. Write a new migration instead.
- **`await` inside a transaction.** Other code can run while it's open. Our helper rejects async work.
- **Bumping the version outside the transaction.** A crash can then record a change that never happened.
- **Silently creating a fresh DB when opening fails.** To the user that looks like data loss. We show an error and quit.

## Try it (5–15 min exercise)
1. In `tests/integration/storage-migrate.test.ts`, add a `V3` migration that creates an index: `CREATE INDEX notes_body ON notes(body);`.
2. Write a test: migrate to v2, insert a note, migrate to v3. Assert that `report.backupPath` exists and the note is still there.
3. Bonus: make `V3` fail on purpose and check that `readSchemaVersion(db)` is still 2.

## Learn more
- SQLite transactions: https://www.sqlite.org/lang_transaction.html
- SQLite online backup API: https://www.sqlite.org/backup.html
- Node `node:sqlite`: https://nodejs.org/docs/latest-v24.x/api/sqlite.html
