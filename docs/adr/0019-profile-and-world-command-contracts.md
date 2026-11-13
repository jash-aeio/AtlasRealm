# ADR-0019: Profile and world command contracts: domain error codes, active-profile rename, settings row at startup, fixed theme list

- **Status:** Accepted
- **Date:** 2026-11-13
- **Milestone(s) affected:** M1 (M1-6 #33; M1-7 #34 reuses the error codes, M1-8 #35 swaps the active profile, M1-9 #36 builds the UI on these commands)
- **Decided by:** jash-aeio (asked via AskUserQuestion on 2026-11-13, during `/start-task 33`)

## Context
M1-6 exposes profiles, profile settings and worlds to the renderer (ARCHITECTURE §16.1, SECURITY §21.1). Writing the contracts raised four questions:

1. **Error codes.** IPC results only had `forbidden_sender`, `payload_too_large`, `invalid_payload` and `internal_error`. The repositories already report stable codes (`not_found`, `revision_conflict`, …), and §16.1 asks commands to validate target ownership and the expected revision. Without matching IPC codes the UI couldn't tell "someone changed this first" from bad input.
2. **Two copies of the profile name.** `profiles-index.json` holds display names so the picker can list profiles without opening every database (DATA_MODEL §9.1). The profile's `profile_settings` row also holds its display name (§9.3). A rename has to keep them in step.
3. **Missing settings rows.** Existing profiles (the adopted M0 "Default", and every profile from M1-2) have no `profile_settings` row yet.
4. **World themes.** `world.create` takes a theme (§16.1), but there is no theme catalog yet. The database accepts any slug.

## Options considered
| Question | Option | Pros | Cons |
|---|---|---|---|
| Errors | **Add domain codes** | Stable codes the UI can act on; M1-7 reuses them | Contract grows |
| | Reuse `invalid_payload` | No contract change | Stale edits look like bad input |
| Rename | **Active profile only** | Both copies change together; matches "commands work on the active profile" | Renaming another profile means switching first |
| | Any profile by ID | Picker can rename directly | Inactive profiles' settings name goes stale |
| Settings row | **Create at startup** | Reads stay pure reads; every command can rely on the row | One small write per startup when missing |
| | Create lazily on first get | Less startup work | A query that writes |
| Themes | **Fixed list (`meadow`)** | Nothing stores a theme the app can't draw | New themes need a contract change |
| | Any valid slug | Flexible | Renderer must handle unknown themes |

## Decision
- **Domain error codes.** `IpcErrorCode` gains `not_found`, `already_exists`, `revision_conflict` (the error carries `currentRevision`), `invalid_transition` and `limit_reached`. Handlers throw `CommandError` (`src/main/ipc/router.ts`); repository errors are translated with fixed, user-safe messages (`src/main/ipc/repository-errors.ts`), and repository `invalid_input` becomes `invalid_payload`. Anything else stays `internal_error`. A world ID from another profile isn't in the active database, so it is reported as `not_found` too, and nothing about other profiles leaks.
- **Rename only the active profile.** `profile.rename` checks the expected revision, writes the index, then updates the settings row; if the row update fails it writes the old index back. A crash between the two writes is repaired at the next start (the index wins, because that is what the picker showed).
- **Settings row at startup.** `ensureProfileSettings` runs right after the profile's database opens: it creates a missing row (name from the index, no avatar, the system's IANA timezone or `UTC`) and repairs a name that differs from the index. `profile.create` writes the row for new profiles immediately.
- **Fixed lists for themes and avatar presets.** `world.create` accepts only `meadow` (the default). Avatar presets are likewise a fixed list with one entry, `default` (ART_BIBLE §34.4 plans one user avatar; the colour personalises it). Output schemas accept any slug, so one odd stored value can't break a whole list.

Routine choices made alongside (session log): at most 50 profiles and 100 worlds per profile (`limit_reached`), so lists stay bounded without paging; profile names are unique ignoring case; `profile.create` never switches profiles.

## Consequences
- M1-7 project commands get `not_found`/`revision_conflict`/`invalid_transition` for free through `withRepositoryErrors`.
- Command handlers read the database through `ActiveProfile.current()`, so M1-8 only has to swap that holder's state.
- The renderer can offer "reload and retry" on `revision_conflict` using `currentRevision`.
- Adding a theme or an avatar preset is a one-line contract change plus art.
- Revisit if: users need to rename profiles from the picker without switching; the profile or world caps feel tight (then add paging); or community themes arrive (then themes come from an installed-resource catalog instead of an enum).

## Learning note
An error code is part of a contract just like a field: the UI branches on it, so it must be stable and must never leak internals. Keeping one source of truth (here the index for the name, repaired into the settings row) is how you stay safe when one change has to touch two places that can't share a transaction.
