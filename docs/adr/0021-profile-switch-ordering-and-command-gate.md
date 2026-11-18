# ADR-0021: Profile switch ordering (open the target first) and the command gate

- **Status:** Accepted
- **Date:** 2026-11-18
- **Milestone(s) affected:** M1 (M1-8 #35), M4 (run checkpointing replaces "pause the worker")
- **Decided by:** jash-aeio (asked via AskUserQuestion on 2026-11-18, during `/start-task 35`)
- **Refines:** [ADR-0014](0014-local-profiles-storage-and-switching.md) (in-process switch + window reload)

## Context
ADR-0014 decided that profiles switch in-process and the window then reloads. Issue #35 lists the steps as: stop the worker → close the current database → open the target → update last-used → reload. It also requires that a target which fails to open leaves the current profile active, never an empty database.

In that order, a failed open happens *after* the current database is closed. The app would have to reopen the current profile and restart its worker, and that reopen can itself fail. The app would then have no open profile.

The second question was what to do with commands that arrive during a switch. ADR-0014 said to refuse them (`profile_switching`) but not how long the refusal lasts.

## Options considered
**Ordering**
| Option | Pros | Cons |
|---|---|---|
| **Open the target first** | A failed open touches nothing of the current profile (database, worker, index). No recovery code | Two database files are open for a moment. If the target opens but the index write then fails, the target has one extra launch recorded |
| Issue's literal order (stop → close → open) | Only one database is ever open | Needs "reopen the current profile" recovery, which can fail and leave no profile open |

**How long commands are refused**
| Option | Pros | Cons |
|---|---|---|
| **Until the old page is gone (`did-navigate` of the reload), with a 10 s fallback** | The old page can never send a command to the new profile. The new page's first commands work, because `did-navigate` fires before its scripts run | Needs a timeout so the gate can't stay closed forever |
| Until the database swap is done | Simplest | For a moment the old page could act on the new profile with stale state |

## Decision
`ProfileSession.switchTo` (`src/main/services/profile-session.ts`) runs these steps:
1. Close the gate (`ActiveProfile.beginSwitch`). Every IPC command is refused with `profile_switching` (`refuseWhileSwitching` wraps all handlers), and `ActiveProfile.current()` refuses too.
2. In the profile-change queue shared with `profile.create`/`profile.rename`, open the target database next to the current one. That includes migrations, the pre-migration backup and `requireExisting`. Then make sure the target has a settings row.
3. Write last-used to `profiles-index.json` (atomic).
4. Pause the worker. Pending requests fail with `worker_stopped` and are not retried.
5. Close the old database and swap the holder.
6. Resume the worker (a fresh process).
7. Reply `{ activeProfileId, reloading: true }`, reload the window, and open the gate once the reload commits, fails, or after 10 s.

If step 2 or 3 fails, the target is closed again, the reply is `profile_unavailable` (fixed message, details only in the main log), the gate opens and nothing else changes. Switching to the profile that is already active is `invalid_transition`, and an unlisted ID is `not_found`.

## Consequences
- New stable error codes: `profile_switching` and `profile_unavailable`.
- `app.launchInfo` now reads the active profile on every call instead of the startup database handle.
- At quit, `will-quit` closes whichever database is open at that moment (`ActiveProfile.databaseForShutdown`).
- M4: "pause the worker" becomes "checkpoint and stop the profile's runner". The ordering above still holds.
- Revisit if: a profile's open can take long enough that the refusals bother users (show progress), or if a future window setup has more than one renderer.

## Learning note
When you replace something live, prepare the replacement fully *before* you let go of the original. If preparing fails, you still have what you started with. See lesson 019.
