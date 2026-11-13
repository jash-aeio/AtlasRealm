# Session 2026-11-13: M1-2 profile storage (#29)

**Branch:** `feat/29-profile-storage` (main checkout) · **Issue:** #29 · **Milestone:** M1

## Task
Give the app real local profiles. `userData/profiles-index.json` lists them, and each profile has its own folder and `app.sqlite`. The M0 folder `profiles/default/` is adopted, and startup opens the last-used profile.

## Plan (as approved)
1. Profile ID + index module + tests (`feat(db)`).
2. Startup resolution, `app-database.ts` taking a profile ID, `index.ts` wiring, E2E path helper (`feat(db)`). Slices 2 and 3 of the plan were committed together so every commit typechecks.
3. Docs: ADR-0017, glossary, DATA_MODEL note, this log, then `/ship`.

## Decisions
| Decision | Outcome | How |
|---|---|---|
| ID of the first profile on a brand-new install | ✅ A new UUID; only adopted M0 installs keep `default` | AskUserQuestion → [ADR-0017](../adr/0017-fresh-install-profile-gets-uuid.md) |
| Order on the first launch | Open and migrate the DB first, then write the index. A failed first launch leaves no index, so the next launch retries | Routine design |
| Indexed profile whose `app.sqlite` is missing | Startup stops with its own dialog (`ProfileDataMissingError`) instead of creating an empty DB that would look like lost data | Routine; follows OFFLINE_AND_RECOVERY §19 and the existing "no silent fallback" rule |
| Corrupt index | Startup stops with a dialog naming the problem kind (`unreadable`, `invalid_json`, `invalid_shape`). The file is never rewritten, and nothing is adopted or created | Issue AC |
| Display-name rules in the index | Same as every other name (`normalizeName`: trimmed, 1–80 chars, no control characters) | Spec default |
| One source of truth for the ID pattern | `profile-settings-repository.ts` now imports `PROFILE_ID_PATTERN` from `profiles/profile-id.ts` | Routine |
| Writing a `profile_settings` row | Not done here; it belongs to M1-6 (#33) | Scope |

## What was done
- `src/main/storage/profiles/profile-id.ts`: `ProfileIdSchema` (a branded Zod string: `default` or a lowercase UUID), `toProfileId`, `newProfileId`, `InvalidProfileIdError` (it doesn't echo the rejected value).
- `src/main/storage/profiles/profiles-index.ts`: a strict schema (unknown keys refused, unique IDs, non-empty list, last-used must be listed, schema version 1), `readProfilesIndex` (never writes), and `writeProfilesIndex`, which writes atomically: a temp file opened with `wx`, then fsync, then rename. It validates on the way out too.
- `src/main/storage/profiles/startup.ts`: `openStartupProfile` returns the DB plus `profileId`, `displayName` and `source` (`index` / `adopted` / `created`).
- `src/main/storage/app-database.ts`: `profilePaths` and `openAppDatabase` take a `ProfileId` and re-check it at runtime.
- `src/main/index.ts`: startup uses `openStartupProfile`, with separate path-free dialogs for a corrupt index, missing profile data and other DB failures.
- Tests: `storage-profiles-index.test.ts` (IDs, traversal and odd inputs, corrupt files kept byte for byte, atomic replace with no temp file left behind) and `storage-profiles-startup.test.ts` (adoption keeps launch history, fresh UUID start, a failed first launch writes no index, the last-used profile is opened, missing DB refused, a corrupt or malicious index refused with nothing created).
- E2E: `tests/e2e/support/profile-data.ts` finds the DB through the index. `storage.spec.ts` also checks that a fresh install's index holds one UUID "Default". The packaged blocked-switch tests now check that *no* profile data (index or folder) was written, which is stronger than before.

## Verification (real results)
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: clean
- `pnpm test`: 24 files, 359/359 passed
- `pnpm test:e2e`: 35/35 passed
- `pnpm package` + `pnpm package:test` + `pnpm test:e2e:packaged`: 14/14 passed

## Open questions / follow-ups
- If the very first DB open fails on a **fresh** install, the new UUID folder stays on disk without an index, and the next launch creates another UUID folder. This only happens when a brand-new empty DB can't be created or migrated (a bug or a broken disk). Cleaning up orphan folders could come with M1-8 or M7 recovery work.
- Untested: the three startup error dialogs (`startupFailureMessage` in `index.ts`). Tests prove the right error type is thrown and nothing is written, but no test opens the app with a corrupt index to see the dialog.
