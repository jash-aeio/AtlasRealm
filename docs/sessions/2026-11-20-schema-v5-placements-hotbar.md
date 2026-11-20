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

## What was done
_In progress._

## Open questions
_None yet._
