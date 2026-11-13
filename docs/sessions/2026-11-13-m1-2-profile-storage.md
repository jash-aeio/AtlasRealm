# Session 2026-11-13: M1-2 profile storage (#29)

**Branch:** `feat/29-profile-storage` (main checkout) · **Issue:** #29 · **Milestone:** M1

## Task
Give the app real local profiles. `userData/profiles-index.json` lists them, and each profile has its own folder and `app.sqlite`. The M0 folder `profiles/default/` is adopted, and startup opens the last-used profile.

## Plan (as approved)
1. Profile ID + index module + tests (`feat(db)`).
2. Startup resolution, `app-database.ts` taking a profile ID, `index.ts` wiring, E2E path helper (`feat(db)`). Slices 2 and 3 of the plan were committed together so every commit typechecks.
3. Docs: ADR-0017, glossary, DATA_MODEL note, this log, then `/ship`.
4. (Added during `/ship`) Fixes from the security review (`fix(db)`), then a rebase onto main after #32 and #43 merged (two import-line and one glossary conflict, resolved by keeping both sides).

## Decisions
| Decision | Outcome | How |
|---|---|---|
| ID of the first profile on a brand-new install | ✅ A new UUID; only adopted M0 installs keep `default` | AskUserQuestion → [ADR-0017](../adr/0017-fresh-install-profile-gets-uuid.md) |
| Order on the first launch | Open and migrate the DB first, then write the index. A failed first launch leaves no index, so the next launch retries | Routine design |
| Indexed profile whose `app.sqlite` is missing | Startup stops with its own dialog (`ProfileDataMissingError`) instead of creating an empty DB that would look like lost data | Routine; follows OFFLINE_AND_RECOVERY §19 and the existing "no silent fallback" rule |
| Corrupt index | Startup stops with a dialog naming the problem kind (`unreadable`, `invalid_json`, `invalid_shape`). The file is never rewritten, and nothing is adopted or created | Issue AC |
| Display-name rules in the index | Same as every other name (`normalizeName`: trimmed, 1–80 chars, no control characters) | Spec default |
| One source of truth for the ID pattern | `profile-settings-repository.ts` now imports `PROFILE_ID_PATTERN` from `profiles/profile-id.ts` | Routine |
| Missing index while profile databases exist | ✅ Stop and explain (`ProfilesIndexMissingError`); nothing is created or written. Rebuilding the index is M7 recovery work | AskUserQuestion → addendum in [ADR-0017](../adr/0017-fresh-install-profile-gets-uuid.md) |
| Index written by a newer app | Reported as `newer_version` ("written by a newer version"), not as damaged | Security review L4 |
| Index write on Windows | Async, rename retried 5× over ~0.5 s on `EPERM`/`EBUSY`/`EACCES`; cleanup errors never hide the real error; stale temp files removed at startup | Security review L3 |
| Writing a `profile_settings` row | Not done here; it belongs to M1-6 (#33) | Scope |

## What was done
- `src/main/storage/profiles/profile-id.ts`: `ProfileIdSchema` (a branded Zod string: `default` or a lowercase UUID), `toProfileId`, `newProfileId`, `InvalidProfileIdError` (it doesn't echo the rejected value).
- `src/main/storage/profiles/profiles-index.ts`: a strict schema (unknown keys refused, unique IDs, non-empty list, last-used must be listed, schema version 1), `readProfilesIndex` (never writes), and `writeProfilesIndex`, which writes atomically: a temp file opened with `wx`, then fsync, then rename. It validates on the way out too.
- `src/main/storage/profiles/startup.ts`: `openStartupProfile` returns the DB plus `profileId`, `displayName` and `source` (`index` / `adopted` / `created`).
- `src/main/storage/app-database.ts`: `profilePaths` and `openAppDatabase` take a `ProfileId` and re-check it at runtime.
- `src/main/index.ts`: startup uses `openStartupProfile`, with separate path-free dialogs for a corrupt index, missing profile data and other DB failures.
- Tests: `storage-profiles-index.test.ts` (IDs, traversal and odd inputs, corrupt files kept byte for byte, atomic replace with no temp file left behind) and `storage-profiles-startup.test.ts` (adoption keeps launch history, fresh UUID start, a failed first launch writes no index, the last-used profile is opened, missing DB refused, a corrupt or malicious index refused with nothing created).
- E2E: `tests/e2e/support/profile-data.ts` finds the DB through the index. `storage.spec.ts` also checks that a fresh install's index holds one UUID "Default". The packaged blocked-switch tests now check that *no* profile data (index or folder) was written, which is stronger than before.

## Review fixes (during /ship)
- invariant-reviewer: approved, no violations.
- security-auditor: no Critical or High findings. All five findings were fixed:
  - **M1:** with no index, startup used to look only for `profiles/default/`. A lost index would therefore have hidden a UUID profile behind a new empty "Default". Startup now lists the profile folders that hold a database, then adopts, creates or stops (your decision).
  - **L1:** a database file that vanished between the existence check and the open would have been created empty and migrated. Now `openAppDatabase(…, { requireExisting: true })` refuses a version-0 database.
  - **L2:** an M0 `default` folder without `app.sqlite` used to be adopted, which created an empty DB. It is now refused.
  - **L3:** the index rename is retried on Windows lock errors, cleanup can't mask the original error, and leftover temp files are removed.
  - **L4:** the newer-version wording.
- New tests: `storage-profiles-index-retry.test.ts` (a mocked rename fails with EBUSY/EPERM, then succeeds; gives up after 5 tries; no retry on ENOSPC). Six more startup cases and three more index cases.

## Verification (real results)
- Before the review fixes: unit/integration 359/359, E2E 35/35, packaged E2E 14/14.
- Final, rebased on main @ cb0034f: `pnpm typecheck`, `pnpm lint`, `pnpm format:check` clean; `pnpm test` 28 files, 451/451; `pnpm test:e2e` 36/36; `pnpm package` + `pnpm package:test` + `pnpm test:e2e:packaged` 14/14.

## Open questions / follow-ups
- If the very first DB open fails on a **fresh** install after `app.sqlite` was created, the folder stays on disk without an index. Since the review fix, the next launch stops with "profile list missing" instead of piling up new folders. This only happens when a brand-new DB can't be migrated (a bug or a failing disk). Recovery belongs to M7.
- Untested: the three startup error dialogs (`startupFailureMessage` in `index.ts`). Tests prove the right error type is thrown and nothing is written, but no test opens the app with a corrupt index to see the dialog.
- What you wrote yourself: nothing. Claude wrote all the code. You made two decisions: a UUID for fresh installs, and stopping on a lost index.
