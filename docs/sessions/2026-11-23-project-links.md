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

## Open questions
None so far.
