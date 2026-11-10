# ADR-0014: Local profiles: adopt the M0 folder, switch in-process with a window reload

- **Status:** Accepted
- **Date:** 2026-11-11
- **Milestone(s) affected:** M1 (M1-2 #29, M1-8 #35), M7 (restore into a fresh profile)
- **Decided by:** jash-aeio (asked via AskUserQuestion on 2026-11-11, during `/plan-milestone M1`)

## Context
M1 adds real local profiles (spec §23 M1; DATA_MODEL §9.1: `profiles-index.json` + `profiles/<profile-id>/app.sqlite`). Two questions came up:

1. **The M0 data folder.** M0-3 already writes `userData/profiles/default/app.sqlite`, where `default` was a placeholder ID. DATA_MODEL §9.2 wants stable collision-resistant IDs (UUIDs) and never display names as keys.
2. **How switching works.** ARCHITECTURE §7.4 says switching profiles must not leave the old profile's runs going unnoticed (default: stop and checkpoint). TEST_PLAN §22.2 #23 says projects, memory, query results and credentials must not leak between profiles through application services.

## Options considered
**M0 folder**
| Option | Pros | Cons |
|---|---|---|
| **Adopt as profile "Default", keep ID `default`** | No file moves. Keeps the M0 launch history. Simple first-launch code | One profile ID isn't a UUID, so the ID validator must allow the literal `default` forever |
| Rename the folder to a UUID | Every ID has the same format | The first M1 launch has to move a folder holding a live database. A crash in the middle needs recovery code |
| Ignore it and start fresh | Simplest | Leaves orphaned data on disk |

**Switching**
| Option | Pros | Cons |
|---|---|---|
| **In-process, then reload the window** | Fast. A reload wipes all renderer state, so old-profile data can't linger in React stores. Easy to test | A short reload flash. Main must stop the worker and swap the DB carefully |
| Relaunch the app | Strongest isolation, least code | Takes a few seconds, the window flickers, and it's awkward to drive in Playwright |
| In-process, no reload | Smoothest | Every renderer store must be cleared correctly, so a missed one leaks data (§22.2 #23) |

## Decision
- **Adopt `profiles/default/` as the profile "Default".** `default` is a permanently allowed legacy ID. New profiles get UUIDs. Folder paths are built only from IDs that pass validation (UUID or exactly `default`), never from display names or raw index contents.
- **Switch in-process, then reload the window.** Stop the worker (pending requests fail visibly and are not retried), close the DB, open the target profile's DB (normal migrations + backup), record last-used, then reload the renderer. If the target fails to open, the current profile stays active.

## Consequences
- M1-2 (#29) owns the index format and the adoption path. M1-8 (#35) owns the switch sequence and the isolation tests.
- Commands that arrive during a switch are refused (`profile_switching`) rather than queued.
- Once real runs exist (M4), the "stop the worker" step becomes "checkpoint and stop the profile's runner". This ADR's ordering still holds.
- Revisit if: the reload causes visible data loss (for example unsaved form drafts) that users complain about, or if M7's restore-into-fresh-profile needs a different index format.

## Learning note
A **profile** here is a separate local data set, not a security account. Reloading the window after a switch is a cheap way to guarantee that no memory from the previous profile survives in the UI: instead of remembering to clear every piece of state, we throw all of it away.
