# 2026-11-22 · Main screen layout and keyboard shortcut layer (M2-5, #70)

## Task
Issue [#70](https://github.com/jash-aeio/AtlasRealm/issues/70): rebuild the main screen into the UI_SPEC §6.1 layout (top bar, sidebar entrances, world area, Atlas + inspector column, bottom bar) with one keyboard shortcut layer that never takes keys from text fields. Branch `feat/70-main-layout-shortcuts`.

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
