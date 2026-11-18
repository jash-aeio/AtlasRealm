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

- **The command gate stays closed until the old page is gone.** It opens on the reload's `did-navigate` (which fires before the new page's scripts run), on a failed load, or after 10 s. Recorded with the ordering decision in ADR-0021.

## Done
1. `WorkerBridge.pause()` / `resume()` (`worker-bridge.ts`). Pending requests fail with `worker_stopped` ("…not retried"). While paused, no worker can start. A paused worker's exit doesn't count as a crash. 5 new tests in `worker-messaging.test.ts`.
2. `ActiveProfile` can replace its state during a switch and owns the profile-change queue (shared with `ProfileService`). `refuseWhileSwitching` wraps every IPC handler in `register.ts` (now a small `handle()` helper). New codes `profile_switching` and `profile_unavailable`. `app.launchInfo` reads the active profile. `will-quit` closes whichever database is open. Tests: `profile-switch-gate.test.ts`.
3. `profile.switch`: contract (`ProfileSwitchInput`/`Output`), channel, preload `window.atlas.profile.switch`, `ProfileSession` (`src/main/services/profile-session.ts`), command `profile-switch.ts`, and `reloadMainWindow` in `index.ts`.
4. `tests/integration/profile-switch.test.ts` (13 tests):
   - §22.2 #23 isolation in both directions: world list/rename, project list/get/rename/archive/trash/create with the other profile's IDs, settings, launch info;
   - a failed open for 3 reasons (missing, newer, damaged) leaves A untouched, with no empty database created;
   - a failed index write closes the target;
   - every command gets `profile_switching` during a slow open and until the reload;
   - with a real `WorkerBridge`, a pending request fails with `worker_stopped` and a fresh worker starts.
   A mutation check (gate disabled) made 2 tests fail, as expected.
5. `tests/e2e/profiles.spec.ts` (2 tests, built app):
   - a switch reloads the window (a page marker is gone), B shows no data, a new worker pid appears and the old process is gone, and the panel shows "Worker running · pid N" after a refresh;
   - the choice survives a restart, and switching back shows A's world;
   - a failed switch doesn't reload and changes nothing.
6. Docs: ADR-0021, lesson 019, glossary (make-before-break, command gate), ARCHITECTURE §16.1.

## Verification
- typecheck, lint, format: clean.
- Unit/integration: 668/669. The one failure is `ipc-router.test.ts` "rejects a huge binary payload…". It also fails on a clean `main` with this suite on this machine (it takes 2.3 s alone and goes past the 5 s timeout under parallel load), so it isn't caused by this change.
- E2E: 40/40. After the review fixes, one run hit the known flaky world-canvas test; world + profiles then passed 11/11.
- Reviews (during /ship): invariant-reviewer found no violations. security-auditor found three Lows, all fixed with a test where one was possible:
  - L1: the reload gate ignores subframe failures, forces the old page to unload, and logs a timeout;
  - L2: a quit mid-switch also closes the target database;
  - L3: the window the app created is reloaded, not "the first window".

## Process note
A parallel #36 session ran `git switch -c feat/36-first-launch-ui` in this same checkout after this branch was created, so the first three M1-8 commits landed on `feat/36`. The #36 session moved the branch pointers (same commits, no file changes) and moved its own work to a separate worktree.

## Open questions
- The router test timeout above: raise its timeout or shrink the payload in a small follow-up?
- No switching UI yet (M1-9/M1-10 add the profile picker). The worker panel shows the state at mount; after a switch the new worker may still be "starting" until the panel is refreshed.
