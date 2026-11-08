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
- (in progress)

## Open questions
- (none yet)
