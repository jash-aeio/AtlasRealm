# Lesson 025: Database uniqueness constraints as invariants
**Milestone:** M2 · **Date:** 2026-11-20 · **Related:** `src/main/storage/migrations/index.ts` (migration 5), `placement-repository.ts`, `hotbar-repository.ts`, ADR-0023, PRODUCT_RULES §3.1

## The concept (plain words)
An *invariant* is a rule that must always hold. You can enforce it in application code ("check,
then write") or in the database schema (a constraint that refuses the bad row). Code checks are
easy to forget on a new path; a constraint holds for **every** writer, including future code,
scripts and bugs. SQLite gives you several tools for this:
- **UNIQUE index**: no two rows share a value. A **partial** one only covers rows matching a `WHERE`.
- **CHECK**: a condition each row must satisfy.
- **Foreign key**: a value must exist in another table. A **composite** one checks two columns together.

## Why Atlas Realm needs it
PRODUCT_RULES §3.1 says that a project has at most one building, that a hotbar slot holds one thing,
and that a building or pin belongs to a project in the same world. If any of these broke, the map
or the hotbar would lie about the user's projects.

## Where it lives in our code
```sql
-- building_placements: exactly one target, and at most one building per project
CHECK ((project_id IS NULL) <> (service_kind IS NULL))
CREATE UNIQUE INDEX building_placements_one_per_project ON building_placements (project_id);
-- a building's project must live in the building's world
FOREIGN KEY (project_id, world_id) REFERENCES projects (id, world_id)
-- hotbar: each project pinned at most once per world (service pins are not covered by this index)
CREATE UNIQUE INDEX hotbar_slots_one_per_project
  ON hotbar_slots (world_id, project_id) WHERE project_id IS NOT NULL;
```
The repositories still check first (`findByProject`, `assertNotPinnedElsewhere`) so that callers
get a clear `already_exists` instead of a raw "UNIQUE constraint failed". The two layers do
different jobs: the **code check gives a good message**, and **the constraint gives the guarantee**.

## Common mistakes
- Relying only on the code check. One forgotten path, and the data is wrong forever.
- Relying only on the constraint. Users then see SQLite's error text.
- Forgetting that `NULL`s never collide in a UNIQUE index. Here that is useful: service structures
  have `project_id = NULL`, so the one-per-project rule doesn't limit them.
- Storing "type + ID" in one generic column. SQLite can't put a foreign key on it (ADR-0023).

## Try it (5–15 min exercise)
In `tests/integration/storage-migration-v5.test.ts`, temporarily delete
`CREATE UNIQUE INDEX hotbar_slots_one_per_project …` from migration 5 and run
`corepack pnpm exec vitest run tests/integration/storage-migration-v5.test.ts`. Which test fails?
Now run the hotbar repository tests: do they still pass? Why? (Hint: the code check.) Put the
index back.

## Learn more
- SQLite partial indexes: https://www.sqlite.org/partialindex.html
- SQLite foreign keys (composite keys, §3): https://www.sqlite.org/foreignkeys.html
- SQLite CREATE TABLE constraints: https://www.sqlite.org/lang_createtable.html
