# ADR-0022: First-launch flow: onboarding while the profile has no world, avatar colour presets, switching shown disabled until M1-8

- **Status:** Accepted
- **Date:** 2026-11-18
- **Milestone(s) affected:** M1 (M1-9 #36; M1-8 #35 wires up switching)
- **Decided by:** the user (asked via AskUserQuestion on 2026-11-18); the first-launch rule is a routine spec default

## Context
PRD §5.1 asks for an offline first launch: `local profile → starter world → first project prompt → usable world`, with avatar customisation skippable and editable later and no online account. Issue #36 adds the first UI for this. Three questions came up:

1. **When is it "first launch"?** The app needs a rule for showing onboarding instead of the main screen.
2. **Avatar presets.** The issue asks for "a few placeholder presets", but ADR-0019 fixed one avatar preset (`default`) personalised by colour, because the art bible plans a single user avatar (ART_BIBLE §34.4).
3. **Switching profiles.** The issue's profile picker includes "switch", but switching is M1-8 (#35), built in parallel and not merged yet.

## Options considered
| Question | Option | Pros | Cons |
|---|---|---|---|
| First launch | **No active world in the active profile** | No new data; a skipped avatar never nags; correct after restore or a new profile | A profile whose worlds are all archived sees onboarding again |
| | A stored "onboarding finished" flag | Explicit | New preference or schema; can disagree with real data |
| Avatar | **Colour presets on the one placeholder avatar** | Fits ADR-0019 and the art bible; no contract change | Less variety until real art ships |
| | More presets in the contract | Matches the issue wording | Contract change; invents art nobody planned |
| Switching | **Show it, disabled, labelled "arrives with M1-8"** | Honest; M1-8 only has to enable the button | A visible control that doesn't work yet |
| | Build M1-8 first | Picker really switches | #36 waits a whole task |
| | Leave it out | Simplest | Picker looks incomplete; the criterion moves to #35 |

## Decision
- **Onboarding shows while the active profile has no active (unarchived) world.** The renderer derives this from `world.list`; nothing new is stored. Onboarding has three steps: the profile picker, a skippable avatar step, and create-world (name + bundled theme).
- **The avatar step offers six colours from the art-bible palette** for the one placeholder figure (`avatarPreset: 'default'` + `avatarColour`). It is labelled "Placeholder avatar" everywhere it appears. Settings can change or remove it.
- **The picker lists every profile and can rename the active one and create new ones.** Other profiles get a disabled "Switch" button with the note "Switching profiles arrives with M1-8".

## Consequences
- No schema or IPC contract change in M1-9. The renderer keeps a small session cache (`src/renderer/state/session.ts`) that re-reads profiles, settings and worlds after each command.
- Follow-up: whichever of #35 and #36 merges second wires the Switch button to `window.atlas.profile.switch`. **Done in PR #51** (#35 merged first, on 2026-11-18), so the button shipped enabled.
- Follow-up: when world archiving gets a UI, decide what a profile whose worlds are all archived should see (onboarding again, or a "restore a world" screen).
- Revisit if: onboarding gets more optional steps (e.g. a guided intro or example world, PRD §5.1) that need their own "seen" state; or several avatar figures ship (then extend `AvatarPreset`).

## Learning note
Prefer deriving UI state from data you already have over storing a second flag that can drift. "No world yet" says exactly what onboarding is for, so it can never disagree with the database.
