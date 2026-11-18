# 2026-11-18: Profile switching (M1-8, #35)

## Task
Issue #35: switch profiles safely. Stop the worker, swap the database, reload the window, refuse commands during the switch, and prove that projects, worlds and settings don't leak between profiles (§22.2 #23).

## Plan (approved)
1. Worker pause/resume in `WorkerBridge`: pending requests fail with `worker_stopped` and are never retried.
2. A switch gate: new error code `profile_switching`. `ActiveProfile` can now replace its state, and it owns the queue for index writes. `app.launchInfo` reads through it.
3. `ProfileSession.switchTo` + the `profile.switch` command (contract, preload) + a new `profile_unavailable` code for a target that can't be opened.
4. Integration tests (`tests/integration/profile-switch*.test.ts`).
5. E2E (`tests/e2e/profiles.spec.ts`).
6. Docs: ARCHITECTURE §16.1, ADR, lesson, glossary.

## Decisions
- **Open the target first** (asked via AskUserQuestion, user chose the recommended option). The target database is opened, migrated and checked while the current one is still open. Only then: last-used is written to the index, the worker is stopped, the old database is closed, the holder is swapped, the worker restarts, and the window reloads. A failed open leaves the current profile completely untouched. This differs from the issue's literal order (stop → close → open), which would need to reopen the current profile after a failure.
- Routine choices (spec defaults, not asked):
  - switching to the profile that is already active is refused with `invalid_transition`;
  - an unknown profile ID is `not_found`;
  - every IPC command is refused during a switch, including read-only ones such as `runtime.workerStatus`. The window reloads right after anyway.

## Done
_(filled in as slices land)_

## Open questions
_None yet._
