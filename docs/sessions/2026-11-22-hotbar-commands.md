# 2026-11-22: M2-4 hotbar commands (#69)

**Branch:** `feat/69-hotbar-commands` · **Issue:** [#69](https://github.com/jash-aeio/AtlasRealm/issues/69)

## Task
Add IPC commands that list, pin and unpin hotbar shortcuts in one world. Filling a slot that already holds something must always be an explicit choice, never a silent overwrite (§22.2 #2, PRODUCT_RULES §3.1). A pin is a shortcut, never the project, so clearing a slot never changes its target.

## Plan
1. **Contracts, error shape and service:** `src/common/contracts/hotbar.ts`, a new `slot_occupied` error code that carries the slot's current occupant (`ipc-result.ts`, `router.ts`, following the `CommandErrorDetails` pattern from ADR-0025), `src/main/services/hotbar-service.ts` and `src/main/ipc/commands/hotbar.ts`. Contract tests go through the real router against a real profile database.
2. **Wiring and E2E:** `channels.ts`, `atlas-api.ts`, the preload, `register.ts`, plus an E2E spec in the built app.
3. **Docs:** ADR-0026, the glossary, this log. Then `/ship`.

## Decisions
- **User, via AskUserQuestion, recorded in [ADR-0026](../adr/0026-hotbar-command-contracts.md):**
  - `replace` and `clear` name the **expected target ID** (what the caller thinks is in the slot), not a revision. A slot that is cleared and filled again starts back at revision 1, so an old revision could match a different pin. A target ID can't be fooled that way.
  - **A project in the trash can't be newly pinned** (`invalid_transition`). Archived projects can be. This matches placement. Pins that already exist stay when a project is archived or trashed, and `hotbar.list` reports the project's status.
  - **`replace` on an empty slot simply fills it.** Nothing is overwritten, so nothing can be lost.
- **Routine, following the spec and the issue:**
  - Slots are numbered 0–9 in the contract, as in the database. Slot 0 is key `1`, slot 9 is key `0`.
  - Assigning the target that is already in that slot returns the slot unchanged, so a retry is harmless.
  - A target that is already pinned to another slot gives `already_exists` (each target is pinned at most once per world, ADR-0023).
  - An archived world refuses `assign` and `clear` (`invalid_transition`). `list` still works (F5, #59).

## What was done
- Slice 1 (`9d82f27`): hotbar contracts, the `slot_occupied` error code with the occupant (`ipc-result.ts`, `router.ts`), `HotbarService` and the command handlers. `HotbarRepository` now takes its slot count from the contract. 23 integration tests through the real router, plus a router test showing that only known `hotbar` fields cross. Negative control: with the occupant check disabled, 3 tests fail (the slot_occupied, wrong-expected-target and §22.2 #2 tests).
- Slice 2 (`8be67d9`): `window.atlas.hotbar` in the preload and `register.ts`. E2E `tests/e2e/hotbar.spec.ts` in the built app, and the preload-shape test lists `hotbar`.
- Docs: ADR-0026, the ARCHITECTURE §16.1 row, the status Decisions entry.
- Checks: typecheck, lint and format:check pass; unit/integration 934/934 (before slice 2, which adds no unit tests); E2E 54/54.

### Incident: two sessions in one folder
The #70 session (lane B) was working in the same checkout without its own worktree. It switched the folder's branch, so my slice-1 commit first landed on `feat/70-main-layout-shortcuts` on top of its commit. With the user's OK, #69 moved to its own worktree (`D:/MyProjectsJCB/AtlasRealm-69`) and the commit was cherry-picked onto `feat/69-hotbar-commands`. #70 moved itself to `AtlasRealm-70`. Nothing was lost. Lesson: parallel lanes need separate worktrees from the start (MULTI_AGENT_GUIDE). The old shared checkout still needs tidying by the user (it is on a stale branch with leftover copies of my uncommitted edits).

## Open questions
- Moving a pin from one slot to another is two steps today (clear, then assign). The hotbar UI issue decides whether a `hotbar.move` command is worth adding.
- Whichever of #69 and #70 merges second must combine the preload-shape test (`tests/e2e/shell.spec.ts`) and any shared preload/API edits.
