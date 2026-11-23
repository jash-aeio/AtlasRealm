# 2026-11-23 — Library panel (M2-9, #74)

**Branch:** `feat/74-library-panel`. The work happens in its own worktree, `D:\MyProjectsJCB\AtlasRealm-wt-74`, because a peer session has the main checkout on `feat/76-project-links`.

## Task
Build the library from UI_SPEC §6.3: a panel that `E` or the bottom-bar "Library [E]" button toggles, with these tabs:
- **Projects:** works fully, with search and the filters Active / Archived / Trash / Placed / Not placed. It also lists unplaced projects, so the world can grow past ten.
- **Agents, Skills, Tools and Workflows:** labelled "Planned for M3".
- **Building Appearances:** lists the bundled placeholder appearance, marked as a placeholder.

Every critical project action must work from the list without the canvas, including with the world view hidden.

## Decisions (asked with AskUserQuestion)
1. **Hiding the world:** a session-only "Hide world view" / "Show world view" button in the world area. It unmounts the canvas until it is pressed again or the app restarts, and saves nothing. *Why:* it is the smallest real way for a user (and the E2E test) to work without a canvas. A saved comfort setting would change the preferences contract and collide with #62 in `SettingsView.tsx`.
2. **Filters:** two groups. **Status** (Active / Archived / Trash) and **On map** (All / Placed / Not placed) combine, for example "Archived + Not placed". While a map filter is on, the list reads every page of that status, the same way search already does (at most 1000 projects per world). *Why:* filtering one page at a time could show an empty page even though matches exist further on.

Neither decision changes a contract, schema or permission, so neither gets an ADR. Both are recorded here.

## Plan (slices, one commit each)
1. **Map filter in the list store** (`project-list.ts`). Add `placement: 'all' | 'placed' | 'unplaced'`, `setPlacement()`, and a `visibleProjects(state, placedIds)` that applies search plus the map filter. A map filter loads every page. Unit tests in `tests/domain/project-list-store.test.ts`.
2. **Projects list UI** (`ProjectsPanel.tsx`, `ProjectItem.tsx`, `project-messages.ts`). Add the "On map" filter group, a summary that names it, and an **Open** button on each row, so opening a project needs no canvas. The sidebar Projects panel gets the same list.
3. **Library panel** (`src/renderer/library/*`). `LibraryPanel` uses the WAI-ARIA tabs pattern: arrow keys, Home and End move between tabs, and only the selected tab is in the Tab order. The Projects tab reuses `ProjectsPanel`. The Agents, Skills, Tools and Workflows tabs say "Planned for M3". The Building Appearances tab reads the bundled manifest and shows each appearance with its footprint and a "Placeholder art" label. Wire it into `MainScreen` in place of the library placeholder. The pure tab-key logic gets a unit test.
4. **Hide world view** toggle in the main screen's world area.
5. **E2E** `tests/e2e/library.spec.ts`:
   - E and the button toggle the library, and E typed in a field doesn't.
   - The tabs and labels are there.
   - The appearance is listed as a placeholder.
   - Twelve projects, with filters and paging.
   - Open, rename, archive, trash, restore, place and remove from map all work with the world hidden.
   - Keyboard-only use.

   `shell.spec.ts` drops its "library placeholder" assertion.

## Done
Five commits on `feat/74-library-panel`, all checks green:
1. `5685e80`: the store gets the "On map" filter. A map filter, or a search set while the first page is still loading, now reads every remaining page too. (Search used to stop at the first page in that race.)
2. `69633a7`: the list gets the "On map" button group, summaries such as "Showing 55 active projects not placed.", and an **Open** button on each row. Until now a project could only be opened from its building or the inspector.
3. `3acadff`: `LibraryPanel` with the six tabs (WAI-ARIA tabs pattern, roving tabindex), `AppearancesTab` (read from the manifest through a new `buildingAppearances()` in `world-assets.ts`), and `library-tabs.ts` with a unit test. The main screen remembers the last tab for the session. The `library` entry left `NOT_BUILT`.
4. `5522050`: the top bar gets a "Hide world view" button. Hiding the world cancels an open placement tool. "Place on map" and "Move" show the world again.
5. `ef0783b`: `tests/e2e/library.spec.ts` (3 tests). `atlas.spec.ts` and `world.spec.ts` now look for their "world view" toggle inside Developer spikes, because the main screen has one too.

**Evidence (worktree, 2026-11-23):** typecheck, lint and format:check pass. Unit/integration: 1030/1030. E2E: 86/86. Packaged E2E: 15/15 (run during /ship). invariant-reviewer: no violations. security-auditor not needed (renderer only). Lesson 034 written (WAI-ARIA tabs and roving tabindex). The user wrote no code in this task; Claude wrote all of it.

## How each acceptance criterion is shown
- **E and the button toggle the library:** `library.spec` test 1 and `shell.spec` "E toggles the library…". Typing E in the search field stays in the field.
- **Projects tab: search, the five filters, paging, keyboard:** `library.spec` test 2 uses 57 active and 2 archived projects. It covers Load more, Not placed and Placed across every page, Archived combined with each map filter, map filter plus search, and Trash. It also shows the filter buttons work with Tab and Enter.
- **Other tabs say "Planned for M3", and the appearance is marked as a placeholder:** `library.spec` test 1 and `tests/domain/library-tabs.test.ts`.
- **Every critical action from the list:** `library.spec` test 3 does open, rename, auto-place, remove from map, archive and restore, trash and restore from trash, then place on map.
- **Works with the world hidden:** test 3 checks that no `canvas` exists while the actions above run.

## Open questions / notes
- When the world is hidden, the undo and redo buttons go away with it, because they live in the world view. Undo history is kept and comes back when the world is shown again.
- Closing a project's details after opening it from the library sends focus to the top of the page, not back to the library. This is the same as opening from the inspector today. It could become a follow-up for M8 (UI polish).
- The library and the sidebar Projects panel share one list component, so each new filter appears in both.
