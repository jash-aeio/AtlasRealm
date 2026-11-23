# 2026-11-23: Project links (M2-11 #76)

**Branch:** `feat/76-project-links` (main checkout; a peer session works on #74 in `D:/MyProjectsJCB/AtlasRealm-wt-74`)

## Task
User-created, typed, descriptive links between projects, plus the bounded query that feeds the Realm Atlas Connections tab (GRAPH_MODEL §30.3–30.7). The UI comes later in M2-13 (#78).

## Decisions
- **ADR-0029** (user, via AskUserQuestion, after an `architect` review):
  - Links live in a dedicated `project_relations` table, not a general `graph_edges` table. Two-column foreign keys keep both ends inside one world.
  - Direction is the source → target order. All three types are directed, so A→B and B→A are different links, and there is no direction column.
  - Links of a trashed project are kept but hidden from the graph and its counts. Restoring the project brings them back.
- Routine choices, following the review and the existing patterns:
  - `relation.create` refuses a trashed project and allows an archived one.
  - `relation.remove` needs the revision the caller saw and returns the removed link.
  - The graph keeps at most 150 projects and 300 links, picked by a fixed order that never uses names.

## Plan (slices, one commit each)
1. **Migration 6 + repository.**
   - `project_relations` in `src/main/storage/migrations/index.ts`.
   - `ProjectRelationRepository` (create, get, remove with expected revision, list by world).
   - Tests: migration v6 (constraints: self-link, duplicate, cross-world FK, origin/confirmation CHECKs) and repository tests.
   - Bump the "schema v6" expectation in the E2E specs.
2. **Contracts + service + commands.**
   - Contracts: `src/common/contracts/{relation,graph}.ts`.
   - Service: `src/main/services/graph-service.ts`, which runs the world, endpoint and trashed checks and the bounded query.
   - Commands and wiring: `src/main/ipc/commands/{relation,graph}.ts`, `channels.ts`, `register.ts`, `atlas-api.ts`, `src/preload/index.ts`.
   - Tests: contract and service integration tests: forged and cross-world IDs, self-links, duplicates, the trashed rule, unplaced projects included, truncation counts with 151+ projects and 301+ links, trashed projects left out of the counts, removal leaving the projects untouched, restart survival and profile isolation.
3. **Docs.** Glossary terms, then status/roadmap through `/ship`.

## What was done
- `e0a74d6` docs: ADR-0029. Notes added to DATA_MODEL §9.3, GRAPH_MODEL §30.4 and the status Decisions list.
- `c6c861b` slice 1:
  - Migration 6 creates `project_relations`.
  - New `ProjectRelationRepository`.
  - `guardedDelete` now also accepts `project_relations`. A manual link is not a product record, so deleting one is allowed (GRAPH_MODEL §30.5).
  - The E2E specs now expect schema v6.
- `be84da7` slice 2:
  - New contracts `relation.ts` and `graph.ts`, plus `GraphService`.
  - New commands `relation.create`, `relation.remove` and `graph.worldConnections`, wired through `register.ts`, `atlas-api.ts` and the preload.
  - The bounded query lives in the repository (the only code that reads the table). It runs three SQL queries: visible nodes with their link counts, the totals, and the edges between kept nodes.
  - Tests:
    - `relation-graph-contract.test.ts`: 19 tests, one or more per acceptance criterion.
    - `storage-migration-v6.test.ts` and `storage-project-relation-repository.test.ts`.
    - `tests/e2e/relations.spec.ts`: link, refusals, graph, restart, remove through the built app.
- Slice 3: glossary terms (project link, directed edge, truncation, deterministic ordering).

## How each acceptance criterion is shown
| Criterion | Evidence |
|---|---|
| Migration 6 stores the fields | `storage-migration-v6.test.ts` (columns, CHECKs, FKs, unique index, STRICT). Direction is the source → target order (ADR-0029) |
| Commands; same world only; self, duplicate and forged refused | `relation-graph-contract.test.ts` › relation.create (forged project and world, another world's project, self-link at the contract and in the service, duplicate) |
| ≤150 nodes / 300 edges with counts; unplaced included | "returns at most 150 nodes and 300 edges…" (160 projects, 311 links → 10 / 11 omitted); "includes unplaced projects…" |
| Removing a link removes only the relation; no side effects | "deletes only the link and returns it" and "never changes a project, a building, a pin or a graph entity" (snapshots of every other table) |
| Survives restart; profile isolation | "a link survives a restart" (integration and E2E); "another profile sees none of…" |

## Verification (2026-11-23, branch head be84da7)
- typecheck, lint and format:check all pass.
- Unit/integration: 1063/1063.
- E2E: 83 passed after the storage spec's migration list got version 6 (the first run failed on exactly that list), plus the new relations spec (1/1).
- Packaged E2E not run yet. Its schema expectation was bumped to v6.

## Open questions
None. Handoff to M2-13 (#78):
- Refetch `graph.worldConnections` after each committed change. React Flow's state must never become the authoritative copy.
- Show `omittedNodes` and `omittedEdges` to the user.
- Draw archived nodes differently.
- Use the source → target order for arrowheads.
