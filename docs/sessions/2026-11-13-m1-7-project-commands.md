# 2026-11-13: M1-7 project commands (#34)

**Branch:** `feat/34-project-commands` · **Issue:** [#34](https://github.com/jash-aeio/AtlasRealm/issues/34) · **Decision record:** [ADR-0020](../adr/0020-project-command-contracts.md)

## Task
Full project create / read / rename / goal / archive / restore / trash / restore-from-trash through an application service and `project.*` IPC commands. Every operation resolves by stable ID, mutations take an expected revision, the list is paged, and nothing is deleted (PRD §5.6, PRODUCT_RULES §3.1, ARCHITECTURE §16.1).

## Decisions (asked via AskUserQuestion, recorded in ADR-0020)
- **World scope:** every call names `worldId`. A project outside that world (or profile) is `not_found`.
- **Paging:** opaque keyset cursor (the last row's name + ID, bound to world and status), 50 per page, max 100.
- **Active runs:** archive and trash ask a probe. Until M4 it's a stub that always says "none", and results say `runCheck: 'stub'`. If a probe ever reports runs, both refuse.
- **Template IDs (found during the work):** the database refused `builtin.generic`, the real template ID format. Migration v4 rebuilds `projects` (and `graph_entities`, which points at it) with the spec rule. Before this fix, no project could be created from a bundled template.

Routine choices (spec defaults, not asked): `create` refuses an archived world (`invalid_transition`); a world holds at most 1000 projects, trash included (`limit_reached`); an unavailable or unknown template is `not_found`; the service lives in `src/main/services/` as the issue lists.

## What was done
1. `feat(db)`: `ProjectRepository.pageByWorld` (keyset paging) and `countByWorld`.
2. `feat(db)`: migration v4 (namespaced template IDs), `assertTemplateId` in the repository, E2E schema version bumped to v4.
3. `feat(ipc)`: `src/common/contracts/project.ts`, `src/main/services/project-service.ts`, `src/main/ipc/commands/project.ts`, wiring in channels / atlas-api / preload / register; contract tests; E2E round trip using the real `builtin.generic` template.

## Verification
- typecheck, lint, format:check: pass.
- Unit/integration: 646/646 (new: `project-contract.test.ts` 52, `storage-migration-v4.test.ts`, keyset paging tests in `storage-project-repository.test.ts`).
- E2E: 38/38 (new: project round trip in the built app; the preload API shape now includes `project`).
- Packaged E2E: not run locally. Its schema expectation was bumped to v4.
- After review: 644/644 unit/integration (4 database-level template-ID cases moved to the repository's rule, 2 tests added), E2E rerun after the fixes: 38/38.

## Reviews
- **invariant-reviewer:** no violations. Note: the per-world cap relies on the count and insert running synchronously in the main process (added to Known limitations).
- **security-auditor:** approve; no Critical/High/Medium.
  - L2 fixed: `ProjectSummary.name` is now a bounded plain string on output, so one oddly stored name (e.g. from a future restore) can't break every page. Test + mutation check.
  - L3 fixed: v4's template_id rule is now a superset of v2's, so an old row like `a--b-` can't make the upgrade fail; the repository enforces the exact shape for new rows. Test added.
  - L1 deferred (status Next task): invisible variation selectors and filler characters in names/goals. It touches the shared text rules, and it matters once goals reach prompts (M3).
  - Question raised: projects in an archived world can still be renamed/restored; only `create` is refused. Left open for M1-10.
- Also fixed while writing the lesson: a repository paging test added a project that cancelled out the change it was testing; it now proves what its comment says.

## How each acceptance criterion is shown
- Service with all operations, revisions, paged list scoped to profile + world: `project-contract.test.ts` (`project.list`, the lifecycle tests, stale-revision tests).
- Commands with forged-input contract tests: unknown IDs, other-world and other-profile IDs, stale revisions, extra keys, tampered cursors.
- Archive/trash never delete: the "walks the whole lifecycle without deleting a row" test counts `projects` and `graph_entities` rows. There is no delete command.
- Rename keeps the ID across restart: "finds the project by ID after a rename and a restart".
- Active-runs stub labelled as such: `noActiveRunsStub` (`STUB until M4` comment), `runCheck: 'stub'` in results, and a test with a probe that reports runs.

## Open questions / follow-ups
- M4: replace the stub probe with real run handling; archive should then request cancellation (ADR-0020).
- Lesson 018: [keyset paging and rebuilding a SQLite table](../learning/lessons/018-keyset-paging-and-table-rebuilds.md).
- Nothing was written by the user this session; all code was written by Claude (CLAUDE.md learning mode).
