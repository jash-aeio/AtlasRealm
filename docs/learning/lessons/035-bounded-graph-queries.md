# Lesson 035: Bounded graph queries
**Milestone:** M2 · **Date:** 2026-11-23 · **Related:** ADR-0029, migration 6, GRAPH_MODEL §30.4–30.6, `project-relation-repository.ts`, `graph-service.ts`

## The concept (plain words)
A graph is dots (projects) joined by arrows (links). Storing and showing one safely takes five ideas:
1. **Direction lives in one place.** `A depends_on B` is stored as source = A, target = B. A separate "direction" column could disagree with that order, so there isn't one.
2. **The database guards the rules.** Each end of a link is a *pair*, `(project, world)`, and that pair must match a real row in `projects (id, world_id)`. A link between two worlds can't be saved, even with raw SQL.
3. **Bounded answers.** A request returns at most 150 projects and 300 links, plus how many were left out.
4. **Deterministic order.** The same data always produces the same cut.
5. **Caps on stored data.** A world holds at most 5000 links.

## Why Atlas Realm needs it
- Graph queries run on the main process. A huge answer would freeze the app, and showing it would freeze the UI.
- Silently dropping rows would break the honesty rule, so the reply says what is missing.
- Trashed projects must not leak through **counts** either (§30.5), so they are left out of the totals as well as the rows.
- Without a cap, a buggy UI could create millions of links. That is a *resource-exhaustion* attack: nothing is stolen, but the app becomes unusable.

## Where it lives in our code
- `src/main/storage/migrations/index.ts`, migration 6:
  ```sql
  FOREIGN KEY (source_project_id, world_id) REFERENCES projects (id, world_id)
  CHECK (source_project_id <> target_project_id)
  ```
- `ProjectRelationRepository.connections()`:
  ```sql
  ORDER BY (p.status = 'active') DESC, link_count DESC, p.created_at, p.id
  LIMIT :max_nodes
  ```
  It never orders by name, because a rename would reshuffle the cut. `id` is the final tie-breaker, so no two rows ever tie.
- `GraphService.create()` refuses with `limit_reached` at `MAX_RELATIONS_PER_WORLD`.

## Common mistakes
- Filtering the rows but not the counts. "3 of 5 projects" reveals 2 trashed projects.
- Ordering by something that can tie, then asserting the order in tests. Our first contract tests created projects within the same millisecond. Their order then came down to random UUIDs, so the tests passed only by luck. The fix was a **ticking clock** (`now` returns +1 s on every call) injected into the services.
- Treating a limit as hiding data. The limit is per request; nothing stored is removed.

## Try it (10 min)
In `tests/integration/relation-graph-contract.test.ts`:
1. Remove `tick` from `openSession`.
2. Run the file a few times with `corepack pnpm vitest run tests/integration/relation-graph-contract.test.ts`. Watch for order failures, then put `tick` back.
3. Write down which `ORDER BY` column broke the tie.

## Learn more
- SQLite foreign keys: https://www.sqlite.org/foreignkeys.html
- SQLite `json_each`: https://www.sqlite.org/json1.html#jeach
- OWASP, uncontrolled resource consumption: https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/
