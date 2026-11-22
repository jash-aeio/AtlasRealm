# 2026-11-22 · Placement undo and redo (M2-8, #73)

## Task
[#73](https://github.com/jash-aeio/AtlasRealm/issues/73): basic undo and redo for place, move and remove only, so placement mistakes are cheap without ever undoing unrelated work (UI_SPEC §17.2). Branch `feat/73-placement-undo-redo`, main checkout (no peer session).

## Plan (approved by the user)
1. `src/renderer/world/placement-history.ts`: an in-memory history per world session. Each saved change becomes an entry that can send its inverse (undo) or itself again (redo) as an ordinary placement command with the expected revision.
2. The placement tool reports every change the main process confirmed to the history (`PlacementRecorder`), and sends nothing while an undo or redo is on its way.
3. `PlacementHistoryControls.tsx`: Undo and Redo buttons above the map, Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z through the shortcut layer, and a result line.
4. Unit tests for the history, E2E for place → undo → redo.

## Decisions
- **Undo and redo wait while the placement tool is open or saving** (user approved this as part of the plan). Undoing under an unsaved preview would change the map it points at. Escape closes the tool first.
- Routine: at most 50 entries (the oldest are forgotten); a new change empties the redo list; a refused or unanswered undo/redo drops that one entry with a message and is never resent (PRODUCT_RULES §3.1).
- Routine: the history is rebuilt when the world or the active profile changes (a profile switch also reloads the window, ADR-0014).
- **Undoing a remove places the building again**: it gets a new ID and the bundled default appearance. Every building uses that appearance today, so nothing visible is lost. If custom appearances arrive, the create command will need to accept one.

## What was done
1. `placement-history.ts` + 12 unit tests (`tests/domain/placement-history.test.ts`), driven through the real placement tool against a fake main process that checks revisions, overlaps and one building per project. The chain test (place → move → remove, undo ×3, redo ×3, undo ×2) caught a real bug: when undo or redo produced a new building version, the entry being run was on neither stack and kept the old ID, so redoing a remove would have sent a deleted ID. Fixed by updating that entry as well.
2. `PlacementHistoryControls.tsx`, wired into `WorldView` and created per world and profile in `MainScreen`. The buttons' accessible names say what they would do (“Undo: place “Beta””).
3. Two E2E tests in `tests/e2e/placement.spec.ts`: place → Undo button → Ctrl+Y → Ctrl+Z → Ctrl+Shift+Z (the project stays Active and shows Not placed), and Ctrl+Z inside the search field doing nothing plus an undo refused after the building was moved through the API (another window).

Verification: typecheck, lint and format:check pass; unit/integration 985/985; full E2E 79/79.

## Open questions
- Should undo also cover rotation once rotatable footprints exist? The entries already store rotation, so it should just work.
