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

## Done / open
_(filled in as slices land)_
