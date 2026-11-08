# 2026-11-08: M0-3 SQLite binding, migrations and persistence (#6)

**Branch:** `feat/6-sqlite-migrations` · **Issue:** [#6](https://github.com/jash-aeio/AtlasRealm/issues/6)

## Task
Show that local storage works inside Electron: a SQLite file under `userData`, numbered migrations applied in transactions, a backup taken before upgrading an existing database, and a record that survives a restart. Only main-process repositories touch the database.

## Decisions
- **SQLite binding: `node:sqlite`**: [ADR-0010](../adr/0010-node-sqlite-binding.md). Electron 45.2.3 bundles Node 24.22.2 (SQLite 3.53.4). I checked that `node:sqlite` loads there, and `backup()` is available. The Node docs mark it as a release candidate. The user picked it over better-sqlite3 (AskUserQuestion), mainly to avoid shipping a native module.
- Routine defaults (proposed in the plan, listed here for the record):
  - The DB lives at `userData/profiles/default/app.sqlite`, following the DATA_MODEL §9.1 layout. Real profile IDs come with the profile feature.
  - The schema version is stored in `PRAGMA user_version`, and each migration is logged in a `schema_migrations` table.
  - The first real table is a small `app_meta` key/value table, used for the "survives restart" proof.

## Plan
See the plan in the conversation / PR. Slices:
1. ADR-0010 + this log
2. DB open helper and transaction helper
3. Migration runner and pre-migration backup
4. Migration 0001 (`app_meta`) and its repository, plus a persistence integration test
5. Wire it into main startup, plus an E2E restart test

## What was done
- `src/main/storage/database.ts`: opens the DB with foreign keys on, WAL and a 5 s busy timeout. `withTransaction` commits or rolls back as a unit, refuses async work and nesting. `backupDatabase` uses the online backup API and leaves a single self-contained file. This is the only file that imports `node:sqlite`.
- `migrate.ts`: one transaction per migration (SQL + `schema_migrations` row + `user_version`). Existing databases are backed up to `profiles/default/backups/` and the copy is checked before migrating. A database from a newer app is refused untouched. A failure leaves the old version and keeps the backup.
- `migrations/index.ts`: migration 0001 `app_meta`. `repositories/app-meta-repository.ts` has typed keys and `recordLaunch()`.
- `app-database.ts` + `src/main/index.ts`: startup opens `userData/profiles/default/app.sqlite`, migrates and counts the launch. On failure it shows an error box and quits, with no silent empty database.
- **Learning piece:** offered `assertMigrationsAreValid` as a `TODO(you)`; the user asked Claude to write it. One rule (`version === index + 1`) covers gaps, duplicates, order, start and fractions; 9 tests.
- Both E2E specs now launch with a temporary `--user-data-dir`, so tests never write to the real profile.

## Verification (local Windows 11, 2026-11-08)
- typecheck, lint and format:check pass. Unit/integration: 69 passed. E2E 9/9.
- The E2E restart test (`tests/e2e/storage.spec.ts`) starts the built app twice and reads `launch_count = 2` from the file. Mutation check: with launch recording removed, it failed (`Received: undefined`).
- Found and fixed while testing: the first backup version left `-wal`/`-shm` side files next to the copy.
- Not yet tested automatically: the error box on a failed migration at startup (the logic underneath is covered by integration tests).

## Open questions
- `node:sqlite` in a **packaged** build is still unproven (M0-7, #10).
- Unit tests on plain Node 24.13 print an "ExperimentalWarning" for SQLite. It's harmless: Electron's Node 24.22 has it as a release candidate.
