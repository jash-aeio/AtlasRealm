# 2026-11-13: M1-4 graph entity IDs (#31)

## Task
[#31](https://github.com/jash-aeio/AtlasRealm/issues/31): give every world and project a stable
graph entity record from day one (GRAPH_MODEL §30.5, DATA_MODEL §9.3), so the Realm Atlas (M2)
and imports build on IDs that already exist.

Work happens in a separate git worktree (`../AtlasRealm-31`, branch `feat/31-graph-entity-ids`)
because the main checkout holds the parallel #29 session's uncommitted work.

## Decisions (asked with AskUserQuestion)
1. **The paired write lives in the repositories.** `WorldRepository.create` and
   `ProjectRepository.create`, `trash` and `restoreFromTrash` write the graph entity in the same
   transaction. A small helper reuses a transaction that is already open through a SQLite
   `SAVEPOINT`, so a later application service (M1-7) can still wrap these calls in a bigger
   transaction. Rejected: database triggers (the rule can't be bypassed, but it's hidden from
   the code you read and UUIDs would be built in SQL), and leaving it to M1-7 (misses the
   acceptance criterion).
2. **Graph entities get their own UUID.** The entity points to its world or project through
   `world_id` / `project_id`. Later kinds (files, notes, tasks) have no project row of their own,
   so one ID space covers every graph node. Rejected: reusing the world or project ID.

## Plan
- Migration 3: `graph_entities` table plus a backfill for worlds and projects already in a v2
  database (trashed projects start tombstoned).
- `withSavepoint` helper in `database.ts`.
- `GraphEntityRepository` (create for a world or project, get, find by record, tombstone and
  clear tombstone).
- World and project repositories write their entity atomically.
- Tests: migration shape and constraints, v2 → v3 backfill, rollback when either insert fails,
  the trash/restore tombstone round trip, and no layout columns.

## Done
- **Slice 1** (4b3029d): migration 3 creates `graph_entities` (STRICT, own UUID, scope, ownership, optional source locator, tombstone, revision; no name or layout columns). A composite foreign key `(project_id, world_id)` keeps a project entity in its project's world, and partial unique indexes allow one entity per world and per project. v2 worlds and projects are backfilled with SQL-built version 4 UUIDs; trashed projects start tombstoned. The v1 → v2 test now runs only the first two migrations.
- **Slice 2** (d20281e): `withSavepoint` in `database.ts`; `GraphEntityRepository`; world/project create, project trash and restore write the entity in the same transaction. 13 new integration tests. A mutation check (removing the transaction on purpose) made the 4 rollback tests fail, which shows they really test atomicity.
- **Review fixes (/ship):** the security review found a latent Medium issue. After SQLite rolls back a whole transaction by itself (disk full, I/O error), a caller that caught the error and carried on would make the next `withSavepoint` commit on its own. `withTransaction` now tracks the transactions it opened. `withSavepoint` joins only those, marks one aborted when SQLite cancelled it, and then refuses further writes (`TransactionAbortedError`) and the commit. It also refuses to join a transaction it didn't open, and keeps the original error if undoing a savepoint fails. Six new tests, including a real full-disk case (`PRAGMA max_page_count`); a mutation check made three of them fail without the guards. The E2E and packaged specs now expect "schema v3". The invariant review found no violations.
- **Docs:** ADR-0018 (ADR-0017 was already claimed by the #29 session), lesson 016 (015 is taken by the #29 session), five glossary terms.
- **Checks:** typecheck, lint and format clean; unit/integration 421/421 passing (27 files).

Routine choices (spec defaults, not asked): archiving a project does not tombstone its entity; the backfill uses the record's `created_at` as the entity's `created_at`; the tombstone methods match on the entity's current state instead of taking an expected revision (the project change already checked it); `source_locator` is capped at 1024 characters.

## Open questions
- The LEARNING_LOG row for lesson 016 sits right after 014; if #29 lands lesson 015 first, the rows may conflict at merge (keep both, in order).
- DATA_MODEL's "content/index revision" column is left for the indexing work (M2/M3).
