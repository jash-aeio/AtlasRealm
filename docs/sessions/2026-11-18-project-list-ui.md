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
Five commits, one for each slice in the plan:
1. `55a0332` adds the store (`project-list.ts`) and 12 unit tests. It passes back the cursor it
   was given and never builds one. A slower, older read can't overwrite a newer one. A stale
   cursor makes the list start over from the top. A `revision_conflict` or `not_found` reloads
   the list and shows a notice.
2. `5ce9bad` adds the list panel on the world home: filters, search, Load more, and one polite
   status line instead of an announcement for every row. Each project's status is written as
   text, not shown only by colour.
3. `ddb16e6` adds the create form. Templates are radio buttons whose descriptions are the real
   bundled metadata. Unavailable templates are listed with the reason.
4. `129292d` adds rename and goal editing in place, plus the four lifecycle actions behind a
   native modal dialog. The dialog says what happens and what does not: no files are moved or
   deleted, and "No AI runs exist yet", which is the honest reading of `runCheck: 'stub'`.
5. `9ee5884` adds 5 Electron E2E tests (`tests/e2e/projects.spec.ts`), one or more for each
   acceptance criterion. The onboarding E2E now checks the new empty-list text.

Checks: typecheck, lint and format are clean. Unit tests: 692 of 693 passed on the full run.
The one failure was the known ipc-router "huge binary payload" flake, which passed 27/27 when
re-run alone; this branch changes no main-process code. E2E: 48/48.

Docs: IMPLEMENTATION_STATUS, ROADMAP, the M1 milestone table, CHANGELOG, GLOSSARY ("Modal
dialog", "Live region") and lesson 021 (accessible confirmations). No ADR was written: the
search decision changes no contract, so it is recorded here and in the status Decisions. The
user wrote no code this session.

## Open questions
- Search loads every remaining page of a filter. At today's limit of 1000 projects per world
  that is at most 10 calls. If worlds grow, move search into `project.list`.
- F5 (projects inside archived worlds) is still open; see Decisions.
- The #34 L1 follow-up (variation selectors and invisible fillers in names and goals) is still
  open. It is not part of this issue.
