# 2026-11-18: First-launch UI (M1-9, #36)

## Task
An offline first launch that reaches a usable, empty world without any account. The avatar step can be skipped and changed later (PRD §5.1). Branch `feat/36-first-launch-ui`, worked in the worktree `D:/MyProjectsJCB/AtlasRealm-36`.

## Decisions (asked with AskUserQuestion)
- **Profile switching is shown but disabled.** Switching is #35 (M1-8), which isn't merged yet. The picker lists every profile and marks the active one. Each other profile has a disabled "Switch" button labelled "arrives with M1-8".
- **Avatar presets are colour presets.** ADR-0019 fixed one avatar preset (`default`), personalised by colour. The avatar step offers one placeholder figure in six art-bible palette colours, so the IPC contract doesn't change.

## Routine choices (spec defaults, not asked)
- "First launch" means **the active profile has no active world**. There's no extra "onboarding done" flag, so a skipped avatar step never comes back.
- The "Create project" button on the empty state is disabled and says the form arrives in M1-10 (#37).
- The M0 spike panels mount only while "Developer spikes" is expanded, so Pixi never starts inside a hidden box.
- Existing E2E specs finish onboarding through the preload API (`world.create`), then reload and open Developer spikes. Their assertions stay as they were.

## Plan (approved)
1. `feat(renderer)`: session store (profiles, settings, worlds; reload after each command, reload on `revision_conflict`) + unit tests.
2. `feat(onboarding)`: profile, avatar and world steps.
3. `feat(renderer)`: main screen, empty state, settings view, Developer spikes; adapt existing E2E.
4. `test(e2e)`: `tests/e2e/onboarding.spec.ts`, including an offline, keyboard-only run.
5. Docs: ADR-0022, glossary, status.

## Incident: shared checkout
A peer session was working on #35 in the main checkout. My `git switch -c feat/36-first-launch-ui` there moved that checkout onto my branch, so the peer's three M1-8 commits landed on `feat/36`. Nothing was lost. With the user's OK (and the peer's), the commits moved to `feat/35-profile-switching`, `feat/36` was reset to `main` (ace8326), and #36 moved to its own worktree. Lesson: check `ListAgents` and `git worktree list` before any `git switch` in a shared checkout.

## Done
_(filled in as slices land)_

## Open questions
- Once M1-8 merges, the disabled Switch button needs wiring to `window.atlas.profile.switch` (whichever branch merges second).
