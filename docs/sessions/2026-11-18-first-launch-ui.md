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

## Decision record
[ADR-0022](../adr/0022-first-launch-flow.md) records the first-launch rule and the two decisions above. Lesson: [020 Derived state, and the renderer as a cache](../learning/lessons/020-derived-state-and-renderer-cache.md).

## Done
Four commits on `feat/36-first-launch-ui`:
1. `feat(renderer)`: `src/renderer/state/session.ts`. A cache of the profile list, settings and worlds, re-read after each command. A `revision_conflict` reloads with a notice. Only the newest reload may write (a slow older read can't overwrite a newer one). 10 unit tests.
2. `feat(onboarding)`: profile picker (list, rename, create, disabled Switch), a placeholder SVG avatar with six palette colours plus Skip, and a create-world form. Names are checked with the shared `DisplayName` rule, so the message says what's wrong. Each new step's heading takes keyboard focus.
3. `feat(renderer)`: main screen (world name or selector, profile chip, Settings), an empty state that asks the main process before saying "no projects", Settings (profiles, change or remove the avatar, rename the world) and the collapsed "Developer spikes" section. Existing E2E specs reach the spikes through a shared helper (`tests/e2e/support/onboarding.ts`).
4. `test(e2e)`: `tests/e2e/onboarding.spec.ts` (3 tests): offline + keyboard-only first launch with no network attempts and a restart; avatar change and removal; profile picker.

**Something learned while fixing tests:** Chromium records no resource-timing entry for the first, uncached `app://` fetch of an image, only for a cached reload. The old sprite test passed only because the world mounted before the launch reload. It now reloads once more on purpose, and a comment explains why.

## Verification (2026-11-18, local Windows 11, worktree on ace8326)
- typecheck, lint, format:check pass.
- Unit/integration 653/654. The one failure is the known-flaky router test "rejects a huge binary payload"; its file passes 27/27 alone.
- E2E 41/41 (3 new).
- Mutation check: removing the heading focus makes the keyboard-only test fail.
- Packaged E2E not run locally; only its helper calls changed (it now opens Developer spikes before reading the M0 panels).

## Open questions
- Once M1-8 merges, the disabled Switch button needs wiring to `window.atlas.profile.switch` (whichever branch merges second).
