# ADR-0018: Graph entities get their own IDs and are written by the world and project repositories

- **Status:** Accepted
- **Date:** 2026-11-13
- **Milestone(s) affected:** M1 (M1-4 #31, M1-7 #34), M2 (Realm Atlas), M3 (imports)
- **Decided by:** jash-aeio (asked via AskUserQuestion on 2026-11-13, during #31)

## Context
GRAPH_MODEL §30.5 says the graph is backed by existing SQLite entities, with stable IDs kept separate from file names, display names and graph positions. DATA_MODEL §9.3 lists a `graph_entities` table. Spec §23 M1 asks for every world and project to have a graph entity from day one, so the Realm Atlas (M2) and imports don't have to add IDs to existing data later. Issue #31 requires the entity to be written in the same transaction as the world or project, and a project's entity to be tombstoned when the project is trashed. That left two questions:
1. Where does the "write both together" rule live?
2. Is the entity ID new, or the world's or project's own ID?

## Options considered
**Where the paired write lives**

| Option | Pros | Cons |
|---|---|---|
| **In the world and project repositories**, with a nestable transaction helper | Visible in TypeScript next to the insert it pairs with. Easy to test and to follow | A raw SQL insert could skip it (only repositories write these tables, so this is a rule, not a guarantee) |
| SQLite triggers in migration 3 | Nothing can skip it, not even raw SQL | The behavior is hidden in the schema. UUIDs would have to be built in SQL on every insert |
| Later, in the M1-7 application service | Smallest change now | Misses #31's acceptance criterion. Anything that writes before M1-7 skips it |

**Entity ID**

| Option | Pros | Cons |
|---|---|---|
| **Its own UUID**, pointing to the world or project through `world_id` / `project_id` | One ID space for every graph node, including later kinds (files, notes, tasks) that have no project row | One extra lookup to go from a project to its entity |
| Reuse the world or project ID | Simpler joins and backfill | The graph's IDs depend on the project table. Later kinds would need a different rule |

## Decision
We chose **the repositories** and **a separate UUID**.
- `WorldRepository.create` and `ProjectRepository.create` insert the record and its entity inside `withSavepoint`. `ProjectRepository.trash` sets `tombstoned_at` and `restoreFromTrash` clears it, in the same transaction as the status change. Archiving doesn't tombstone, because an archived project still exists.
- `withSavepoint` (in `database.ts`) opens a normal `BEGIN IMMEDIATE` transaction if none is open. Inside an open one it uses a SQLite `SAVEPOINT`, so an application service can group several repository calls in its own transaction, and a failed inner call undoes only its own writes.
- `graph_entities` stores scope (`world_id`, and `project_id` for project entities), ownership (`app_owned` / `external`), an optional source locator (required when `external`), the tombstone time, timestamps and the revision. It has no name or layout columns: layout is cosmetic and goes in `graph_view_states` later.
- A two-column foreign key `(project_id, world_id) → projects (id, world_id)` makes sure a project entity's world is really its project's world. Partial unique indexes allow one entity per world and per project.
- Migration 3 backfills entities for any worlds and projects already in a v2 database. Trashed projects start tombstoned.

## Consequences
- M1-7 services can wrap repository calls in `withTransaction` (or `withSavepoint`) freely. They read entity IDs through `GraphEntityRepository.findByProject` / `findByWorld`.
- The entity revision changes only together with its project, which already checked the caller's expected revision. So the tombstone methods match on the entity's current state instead of taking a revision. That changes once entities can be edited on their own (manual edges, external locators), and those methods will then need expected revisions.
- Adding new kinds (`file`, `note`, …) means rebuilding the table in a later migration, because SQLite can't change a CHECK constraint in place. `projects.status` works the same way.
- DATA_MODEL's "content/index revision" column is left for the indexing work (M2/M3). It isn't needed for worlds and projects.
- Revisit the triggers option if writers outside the repositories ever appear, for example a bulk import that inserts rows directly.

## Learning note
When two writes must happen together, put them in one transaction, close to the code that does them. A savepoint is a "checkpoint inside a transaction". It lets small all-or-nothing steps be combined into a bigger all-or-nothing step without the steps knowing about each other.
