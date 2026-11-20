# ADR-0023: How building placements and hotbar slots store their target (schema v5)

- **Status:** Accepted
- **Date:** 2026-11-20
- **Milestone(s) affected:** M2 (M2-2 #67, M2-3 #68, M2-4 #69, M2-10 #75); later service placement
- **Decided by:** the user (asked via AskUserQuestion on 2026-11-20)

## Context
Schema v5 adds `building_placements` and `hotbar_slots` (DATA_MODEL §9.3). Both point at
something they *represent*: a project, or a service structure such as the Agents Guild or the Tool
Shops (UI_SPEC §6.1). PRODUCT_RULES §3.1 requires that a project exists independently of its
building and hotbar slot, that removing a shortcut never deletes its target, and that operations
resolve by stable project ID. DATA_MODEL §9.2 wants core relationships to be "queryable and
constrained". The spec describes the hotbar as "target type, target ID" without saying how the ID
is stored, whether a target may fill several slots, or how strict the list of service kinds is.

SQLite can't put a foreign key on a column whose meaning depends on another column, and it can't
change a CHECK constraint without rebuilding the table (migration v4 had to rebuild `projects` for
exactly that reason).

## Options considered
| Question | Option | Pros | Cons |
|---|---|---|---|
| Target storage | **Typed columns** `project_id` (composite FK to `projects (id, world_id)`) + `service_kind`, CHECK exactly one, matching `target_type` | The database refuses a pin or building for a missing project or another world's project; same shape in both tables | Two columns instead of one; the repository maps them to `{ type, id }` |
| | One generic `target_id TEXT` | Matches the spec wording; one column | No foreign key possible: only app code would stop a dangling or cross-world reference |
| Same target in two slots | **Once per world** (partial UNIQUE indexes) | "Unpin this project" is never ambiguous; ten slots aren't wasted on duplicates | Pinning an already-pinned project must be handled as a move (M2-4/M2-10) |
| | Allow duplicates | Game-like freedom | Commands must name the slot; adding the rule later needs a cleanup migration |
| `service_kind` strictness | **Slug shape in the DB, exact list in code** (`src/common/world/service-kinds.ts`) | A new service is a code change, not a table rebuild | Raw SQL could store an unknown slug (the repositories refuse it) |
| | Exact list as a DB CHECK | Strictest | Every new service means rebuilding both tables |

## Decision
- Both tables store the target as **typed columns**: `project_id` with a composite foreign key
  `(project_id, world_id) → projects (id, world_id)` (ON DELETE RESTRICT) and `service_kind`. A
  CHECK makes exactly one of them set; in `hotbar_slots` it must also match `target_type`.
  Repositories expose a single `RepresentationTarget` = `{ type: 'project' | 'service', id }`.
- **Each target is pinned at most once per world:** partial unique indexes on
  `(world_id, project_id)` and `(world_id, service_kind)`.
- **`service_kind` is checked for shape in the database** (1–64 characters of `a-z0-9-`) and against
  the exact `SERVICE_KINDS` list in the repositories. Entries in that list are never renamed or
  removed, because saved rows may use them.

Routine defaults chosen alongside (spec defaults, not asked): removing a placement or clearing a
slot deletes the row ("unplaced" = no row); rotation is stored in degrees (0/90/180/270); tiles are
sanity-checked to 0–255 in the database, with real bounds left to the M2-1 rules; there is no
"one Guild per world" index yet, because M2 doesn't place services.

## Consequences
- Easier: forged or stale references fail at the database even if a service forgets a check;
  M2-4's Zod contract can reuse `SERVICE_KINDS`.
- Harder: a target appears in exactly one slot, so the hotbar UI must offer "move here" rather
  than a second copy.
- Follow-up: M2-3 uses `PlacementRepository.removeByProject` inside archive/trash; M2-4 maps the
  repository's `already_exists` to `slot_occupied` with the current occupant.
- Revisit if: users ask for the same shortcut in two slots (drop the index; no data change), or
  hotbar targets grow beyond projects and services (e.g. workflows), which would mean another
  typed column and a table rebuild.

## Learning note
A database constraint is a promise the data can't break, no matter which code path writes it.
Splitting a "type + ID" pair into one column per type looks clumsy, but it lets the database check
each reference with a real foreign key instead of trusting every caller to remember.
