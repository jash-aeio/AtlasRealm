# 2026-11-13: Profile and world commands (M1-6, #33)

## Task
Expose profiles, profile settings and worlds to the renderer through validated IPC commands
only (ARCHITECTURE §16.1, SECURITY §21.1). Branch `feat/33-profile-world-commands`.

## Decisions (asked with AskUserQuestion, recorded in [ADR-0019](../adr/0019-profile-and-world-command-contracts.md))
- **Domain error codes.** IPC results gain `not_found`, `already_exists`, `revision_conflict`
  (with the current revision) and `invalid_transition`, so the UI can tell "someone changed this
  first" apart from bad input. Repository `invalid_input` maps to `invalid_payload`.
- **Rename only the active profile.** `profile.rename` updates both copies of the name
  (`profiles-index.json` and the profile's `profile_settings` row) together, so they can't drift.
- **Settings row at startup.** A profile that has no `profile_settings` row yet (such as the
  adopted M0 "Default") gets one with defaults right after its database opens. Reads stay reads.
- **Themes are a fixed list.** `world.create` accepts only the bundled theme `meadow` (the default).

## Routine choices (spec defaults, not asked)
- `limit_reached` joins the domain codes for the profile cap (50) and the world cap (100 per
  profile), so lists stay bounded without paging.
- Profile names must be unique, ignoring case: two "Default" entries in a picker are confusing.
- `profile.create` does not switch to the new profile; switching is M1-8 (#35).
- Default timezone for a new settings row: the system's IANA zone, or `UTC` if it can't be read.
- Avatar presets are a fixed list with one entry, `default`: no avatar art exists yet and the art
  bible plans one user avatar (ART_BIBLE §34.4), personalised by colour.
- Profile preferences are not exposed over IPC yet (no schema for them until a later milestone).

## Plan
1. `feat(ipc)`: domain error codes, mapped by the router.
2. `feat(profiles)`: active-profile holder, profile service, startup settings row, profile commands.
3. `feat(worlds)`: world commands.
4. `feat(preload)`: typed `window.atlas.profile.*` / `window.atlas.world.*`.
5. Docs: ADR-0019, glossary, lesson 017, status.

## What was done
Four commits on `feat/33-profile-world-commands`:
1. `feat(ipc)`: `CommandError` in the router plus `withRepositoryErrors`, which turns repository
   errors into fixed, user-safe IPC errors.
2. `feat(profiles)`: `ActiveProfile` (the holder M1-8 will swap), `ProfileService`,
   `ensureProfileSettings` at startup, `createProfileDatabase` (migrates without recording a
   launch), and the five `profile.*` commands.
3. `feat(worlds)`: `world.create`, `world.list`, `world.rename`.
4. `feat(preload)`: typed `window.atlas.profile.*` and `window.atlas.world.*`.

Along the way: when a Unicode escape such as `​` was written into a regex, it landed in the
file as the real invisible character. ESLint's `no-irregular-whitespace` caught it, and the line
was rewritten with escapes. This is the same "Trojan Source" risk the name rules guard against.

## Verification
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: clean.
- `pnpm test`: 554/555. The one failure was the known-flaky router test "rejects a huge binary
  payload" (it timed out at 5.7 s under full-suite load). It passes 27/27 when its file runs alone.
- New tests: `profile-contract` 38, `world-contract` 24, `ipc-repository-errors` 7, router +2.
- `pnpm test:e2e`: the first run had 36/37 (the worker-startup spec failed once and then passed
  5/5 on its own); the rerun had 37/37, including the new profile/world round-trip test.

## Open questions
- None blocking. Follow-up still open from earlier sessions: fix the flaky router test.
