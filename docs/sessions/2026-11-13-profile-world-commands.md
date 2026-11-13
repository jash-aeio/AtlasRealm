# 2026-11-13: Profile and world commands (M1-6, #33)

## Task
Expose profiles, profile settings and worlds to the renderer through validated IPC commands
only (ARCHITECTURE §16.1, SECURITY §21.1). Branch `feat/33-profile-world-commands`.

## Decisions (asked with AskUserQuestion, recorded in ADR-0019)
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

## Plan
1. `feat(ipc)`: domain error codes, mapped by the router.
2. `feat(profiles)`: active-profile holder, profile service, startup settings row, profile commands.
3. `feat(worlds)`: world commands.
4. `feat(preload)`: typed `window.atlas.profile.*` / `window.atlas.world.*`.
5. Docs: ADR-0019, glossary, lesson 017, status.

## What was done
_In progress._

## Open questions
_None yet._
