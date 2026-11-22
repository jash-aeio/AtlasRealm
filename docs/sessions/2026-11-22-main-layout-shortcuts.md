# 2026-11-22 · Main screen layout and keyboard shortcut layer (M2-5, #70)

## Task
Issue [#70](https://github.com/jash-aeio/AtlasRealm/issues/70): rebuild the main screen into the UI_SPEC §6.1 layout (top bar, sidebar entrances, world area, Atlas + inspector column, bottom bar) with one keyboard shortcut layer that never takes keys from text fields. Branch `feat/70-main-screen-layout`, in the worktree `D:/MyProjectsJCB/AtlasRealm-70` (see "Shared checkout clash" below).

## Definition of Ready
- Acceptance criteria: present on the issue.
- Depends on: none.
- No `needs-decision` label.

## Plan
1. **Shortcut layer** (`src/renderer/app/shortcuts.ts` + unit tests): one `keydown` listener on `window`. It skips events from `input`, `textarea`, `select` and `contenteditable`, while a modal `<dialog>` is open, during IME composition, on key repeat, and when another handler already used the event. Bindings match one key plus exact modifiers, so Ctrl+Z (M2-8) and `1`–`0` (M2-10) can register later through a small React context.
2. **Layout** (`MainScreen.tsx`, new `Sidebar.tsx`, `EntrancePanel.tsx`, `app.css`): CSS grid with top bar, sidebar, world area, right column (Realm Atlas + inspector placeholders) and bottom bar (Library [E] button + ten numbered hotbar slots, both labelled "not built yet"). Below 60rem the right column becomes a drawer opened from the top bar.
3. **Entrances**: Projects opens the existing M1-10 project list (open by default, so every M1 action stays one screen away). Settings opens the existing Settings view. Agents Guild, Skill Library, Tool Shops, Automations and Activity open a panel that says "Not built yet (planned for M3+)" and nothing else invented.
4. **Escape and focus**: Escape closes the drawer first, then the open panel. Closing only unmounts the view; nothing saved is touched. Focus returns to the button that opened the panel.
5. **Developer spikes** move out of the page body to a collapsed section below the shell (still labelled as M0 mock data).
6. **E2E** (`tests/e2e/shell.spec.ts`): layout regions, each unbuilt entrance's label, `E` toggling the library placeholder but not while typing, Escape closing a panel and restoring focus, narrow-width drawer. All existing E2E must stay green.

## Decisions so far (routine, following the spec)
- No new dependency: the shortcut logic is tested in plain Node with small fake events, so no jsdom is needed.
- Top-bar search, runner, connections and the "Stop work" button are left out until their features exist, rather than shown as fake controls.
- The world area shows a labelled placeholder until M2-6 (#71) draws real buildings.
- Escape typed into a text field is left to the field (the create form uses it to cancel its draft), so it never closes the panel behind it.
- Clicking an entrance that is already open keeps it open; the Library button and `E` toggle.

## What was done
- `c01c7ca` shortcut layer (`shortcuts.ts`, `ShortcutLayer.tsx`) with 21 unit tests (`tests/domain/shortcuts.test.ts`).
- `4433f3f` the §6.1 layout: `MainScreen.tsx`, `Sidebar.tsx`, `EntrancePanel.tsx`, `entrances.ts`, `use-media-query.ts`, `app.css`. The title moved into the top bar (`App.tsx`).
- `f116f9c` ten new E2E tests in `shell.spec.ts`: the regions, each unbuilt entrance, Escape and "Back to world" restoring focus, `E` ignored in a text field and while the archive dialog is open (the project stays active), and the narrow-width drawer. A screenshot check found the panel's right edge clipped (fixed with `box-sizing: border-box`).
- Evidence on f116f9c: typecheck, lint, format:check pass; unit 910/910; E2E 63/63 (53 existing + 10 new).

## Docs (at /ship)
- Lesson 029 (one keyboard shortcut layer); lesson 028 went to #69. Glossary: keyboard shortcut layer, event bubbling, focus restoration, drawer. Changelog, status, roadmap and M2 milestone updated. No ADR: every choice here was routine and follows the spec.
- Nothing in this task was written by the user; Claude wrote all code and docs.

## Shared checkout clash
The #69 session (hotbar commands) was working in the same folder, `D:/MyProjectsJCB/AtlasRealm`. Its commit landed on this task's first branch, and the uncommitted files of both tasks were mixed. The user chose to move #70 to its own worktree. Only #70's files were copied over, and they were removed from the shared checkout. The other session moved #69 to `D:/MyProjectsJCB/AtlasRealm-69`. The old branch `feat/70-main-layout-shortcuts` is stale, and the shared checkout still holds #69's leftover copies, which the user will clean up.

## Open questions
- Whichever of #69 and #70 merges second must combine the `preload exposes only the explicit API` expectations in `shell.spec.ts` (#69 adds `hotbar`).
