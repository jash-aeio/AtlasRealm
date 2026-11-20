# 2026-11-20 · M1-11 acceptance E2E and packaged smoke (#38)

**Branch:** `chore/38-m1-acceptance-e2e` (from main @ d90a819) · **Issue:** #38

## Task
Prove every M1 Check (ROADMAP_SPEC M1) end to end on the dev build and the packaged build, before `/close-milestone M1`. This is a test-only change: no app code, contracts or dependencies changed.

## Plan (approved)
1. `tests/e2e/m1-acceptance.spec.ts`: one test per M1 Check, driven through the UI a user sees.
2. `tests/e2e-packaged/packaged.spec.ts`: first launch through the real UI, plus the offline, identity and external-file checks in the packaged build.
3. Full verification, and an evidence table here.

## What was done
- **New `tests/e2e/m1-acceptance.spec.ts`** (4 tests, dev build).
- **New `tests/e2e/support/m1-ui.ts`**: shared UI steps (onboarding, create, rename, edit goal, every lifecycle change) and the external-file snapshot, used by both suites.
- **Packaged smoke updated:**
  - The first test now goes through the real first-launch UI (Continue → Skip → name the world). Before, it used the API shortcut.
  - The second launch checks that first launch doesn't come back.
  - New test: "M1 Checks packaged".

## Decisions (routine, no ADR)
- **Offline "attempts" include CSP refusals.**
  - The first version of the packaged recorder only listened for network requests. A positive control (a deliberate `fetch('https://example.invalid/…')`) showed it recorded **nothing**. The page CSP (`connect-src 'self'`) refuses such a fetch before it becomes a request. So an empty list proved nothing.
  - Both suites now also count CSP refusals, which Chromium reports as console errors.
  - Both suites end the offline check with a positive control. In dev it makes one attempt from main (`net.fetch`) and one from the page. In packaged it makes one from the page.
  - Lesson: a check that "nothing happened" needs a control that shows it can see something happen.
- **Packaged offline covers the renderer only.** The packaged fuses block `--inspect`, so the test can't reach the main process there. Main-process traffic is recorded in the dev test (`session.webRequest` on the default session).
- **Where the external fixtures go:**
  - `userData/profiles/External Project/notes.md`, next to the profile folder
  - `userData/External Project/plan.txt`
  - `userData/Ünïcødé bilder 图/karte 地图.bin` (4 KiB of binary)
  - The project is named "External Project", so any delete that went by name would hit those folders.
  - The test compares SHA-256, size, mtime and folder listings.

## Evidence: M1 Checks
All runs are on this branch (3 commits on d90a819), Windows 11, 2026-11-20.

| M1 Check (spec §23) | Dev build (`pnpm test:e2e`) | Packaged build (`pnpm test:e2e:packaged`) | Result |
|---|---|---|---|
| Project creation/reopening works offline | `m1-acceptance` › *a project is created and reopened fully offline, across a restart*: first launch, create and edit all done in the UI with main + renderer offline; 0 attempts; control recorded | *M1 Checks packaged*: create, restart, reopen, edit, all offline (renderer); 0 attempts; control recorded | ✅ both |
| Data survives restart | Same offline test, plus `projects.spec` › *…survives a restart*, `onboarding.spec`, `storage.spec` | *launches from a path with spaces…* (launch #1 → #2, world kept); *M1 Checks packaged* (project kept) | ✅ both |
| Name changes preserve identity | `m1-acceptance` › *a rename keeps the project identity across a restart*: same ID, `createdAt`, template; revision +1; exactly 1 project | *M1 Checks packaged*: rename, restart, same ID, `createdAt`; revision +1 | ✅ both |
| Profile isolation works through commands (§22.2 #23) | `m1-acceptance` › *profiles are isolated through the UI…*: B's list, filters and search are empty. `get`, `list`, `rename`, `trash` and `create` with A's IDs → `not_found`. Switching back shows A unchanged. Also `profiles.spec` (M1-8) | Not repeated packaged: same code and same commands; out of the acceptance criteria's packaged scope | ✅ dev |
| External files are not deleted with a project | `m1-acceptance` › *archive and trash never touch files outside the profile folder*: archive → restore → trash → restore → archive → trash; fixtures byte-identical after quit and after relaunch; project only trashed | *M1 Checks packaged*: same cycle; fixtures byte-identical | ✅ both |
| Profile switching handles runner state | Same isolation test: the worker pid shown in the Developer spikes panel changes after a Settings switch, and the old pid no longer exists. Also `profiles.spec` (one worker process left, per `getAppMetrics`) | Not repeated packaged (worker restart in packaged: `packaged.spec` M0-6 test) | ✅ dev |

**Full results:**
- typecheck, lint and format:check clean
- unit/integration **693/693** (39 files)
- dev E2E **52/52**: the 48 existing tests plus 4 new
- packaged E2E **15/15**: the 14 existing tests (the first one updated) plus 1 new
- Packages built with `pnpm package` and `pnpm package:test` on this branch.

**Labelled limits:**
- There are no real runs yet: "runner state" means the M0 worker process, and archive/trash report `runCheck: 'stub'` (M4).
- Packaged offline is renderer-only, as explained above.

## Open questions
- None new. The follow-ups from IMPLEMENTATION_STATUS still stand: F5 (projects in archived worlds), L1 invisible-character refusal, the `WorldSummary.name` output type, and the L4 caps on read.
- Next: `/close-milestone M1` once this PR is merged.
