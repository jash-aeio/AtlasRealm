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
_(filled in during the work)_

## Open questions
_(none yet)_
