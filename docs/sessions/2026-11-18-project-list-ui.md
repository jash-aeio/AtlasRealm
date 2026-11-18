# 2026-11-18 · Project list UI (M1-10, #37)

## Task
Give each world a conventional project list: search, Active / Archived / Trash filters and
paging, a create form that shows real template metadata, and rename, goal, archive / restore
and trash / restore with clear confirmations. Branch `feat/37-project-list-ui`.

## Plan
1. A pure project list store (`src/renderer/projects/project-list.ts`) with unit tests.
2. A list panel with filters, search and paging, shown on the world home.
3. A create form with template metadata.
4. Rename, goal and lifecycle actions with confirmation dialogs.
5. Electron E2E (`tests/e2e/projects.spec.ts`).

## Decisions
- **Search runs in the renderer** (user choice, via AskUserQuestion). `project.list` has no
  search parameter. When you type a search, the list loads the remaining pages for the current
  filter, which is at most 10 calls because a world holds at most 1000 projects. Then it filters
  by name and goal on screen. The IPC contract stays the same. If worlds ever get much larger, a
  server-side query can replace this.
- Routine choice: confirmations use the native `<dialog>` element opened with `showModal()`.
  It keeps keyboard focus inside the dialog, closes on Escape, and returns focus to the button
  that opened it.
- Deferred: open question F5 (rename, goal and restore still work on projects inside an archived
  world). The UI only lists active worlds, so this can't be reached from the screen yet. Revisit
  when world archiving gets a UI.

## Done
_(filled in as slices land)_

## Open questions
_None yet._
