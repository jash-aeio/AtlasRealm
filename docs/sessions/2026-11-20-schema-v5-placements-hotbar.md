# 2026-11-20 — Schema v5: building placements and hotbar slots (#67, M2-2)

**Branch:** `feat/67-schema-v5-placements-hotbar` · **Milestone:** M2 (lane A, first on the critical path)

## Task
Add two tables that record *where a building stands* and *what each hotbar slot points to*, in a way
that makes the product invariants (PRODUCT_RULES §3.1) impossible to break at the database level:
a project has at most one building, a hotbar slot holds one thing, and removing either one never
touches the project itself. Collision rules stay in application code (M2-1).

## Decisions (asked via AskUserQuestion, 2026-11-20)
| Question | Outcome |
|---|---|
| How a hotbar slot stores its target | ✅ Typed columns: `target_type`, `project_id` (foreign key to the project, same world) and `service_kind`, with a CHECK that exactly the matching one is set. The repository still shows `{ type, id }` |
| Same target in two slots? | ✅ No: each project or service is pinned at most once per world (UNIQUE index; easy to drop later) |
| How strict `service_kind` is | ✅ Slug shape in the database, exact list in code (`src/common/world/service-kinds.ts`), so a new service is a code change, not a table rebuild |

## Plan
1. Migration 5 + service kind list + frozen v4 fixture + migration/constraint tests + E2E "schema v5".
2. `PlacementRepository` + integration tests.
3. `HotbarRepository` + integration tests.
4. Docs: ADR-0023, DATA_MODEL §9.3, glossary, this log.

Recorded as [ADR-0023](../adr/0023-placement-and-hotbar-target-storage.md).

## What was done
- **Migration 5** (`src/main/storage/migrations/index.ts`): `building_placements` and `hotbar_slots`,
  both STRICT. A building has exactly one target and each project at most one building (UNIQUE
  index). A slot is unique per world and slot (primary key), and each target is pinned once per
  world (partial UNIQUE indexes). Project references are composite foreign keys to
  `projects (id, world_id)`, so a building or pin can't point at another world's project. Only new
  tables: no existing row is copied or changed, so every project starts unplaced.
- **`src/common/world/service-kinds.ts`**: the fixed service list (agents-guild, skill-library,
  tool-shops, automations, activity, settings).
- **`PlacementRepository`**: create, get, findByProject, listByWorld, move and remove with an expected
  revision, and `removeByProject` (no revision) for the archive/trash transaction in M2-3.
- **`HotbarRepository`**: list, get, findByTarget, assign (empty slots only), replace and clear with
  an expected revision.
- **`representation-target.ts`**: the shared `{ type, id }` target, checked against the world.
- **`repository-support.ts`**: `guardedDelete` and a shared `explainUnchanged`, so deletes give the
  same `not_found` / `revision_conflict` answers as updates. Existing callers behave as before.
- **Tests**: a frozen v4 fixture (`tests/fixtures/db/v4-app.sql`, with a test that it still matches
  migrations 1–4); v4 → v5 upgrade (data and indexes unchanged, v4 backup taken, no placements or
  pins); raw-SQL constraint tests; repository tests that compare the `projects` rows before and
  after every placement and hotbar change. E2E expectations are bumped to schema v5.
- One real ordering bug found by the tests and fixed before commit: replacing an *empty* slot
  reported "already pinned elsewhere" instead of "slot is empty".

## Decisions (routine; spec defaults, not asked)
- Removing a placement or clearing a slot deletes the row; "unplaced" = no row.
- Rotation in degrees (0/90/180/270), matching M2-1. Tiles 0–255 in the DB as a sanity range; real
  bounds come from the M2-1 rules and the world's grid size.
- No "one Guild per world" index yet: M2 doesn't place services (one `CREATE INDEX` later).
- The repositories don't check a project's status (archived/trashed). That's a service rule (M2-3,
  M2-4).

## Open questions
- `PLACEMENT_ROTATIONS` lives in the placement repository for now. When M2-1 lands its rotation type
  in `src/common/world/placement-rules.ts`, M2-3 should make one import the other.
