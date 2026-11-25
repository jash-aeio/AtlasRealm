# 2026-11-24: M2 acceptance E2E and packaged smoke (#80)

**Task:** [#80](https://github.com/jash-aeio/AtlasRealm/issues/80), M2-15, the M2 integrator task: prove every M2 Check and the Exit on the dev build and the packaged `.exe`. Test-only, no app code.
**Branch:** `chore/80-m2-acceptance` (from main @ 9204c9c)

## Plan (approved by the user)
1. Shared helpers (`tests/e2e/support/m2-ui.ts`) and one acceptance spec with one test per Check.
2. Packaged: "M2 Checks packaged" (offline, restart, bundled building art) and a packaged 100-building measurement.
3. Docs through `/ship`.

## What was done
- `tests/e2e/m2-acceptance.spec.ts`, 7 tests. Setup may go through `window.atlas`; the behaviour under test goes through the UI; forged commands go through `window.atlas` on purpose.
  | Criterion | Test |
  |---|---|
  | Create/cancel placement across a restart (§22.2 #1) | "Check: create/cancel placement persists across a restart" |
  | No silent slot replacement (§22.2 #2) | "Check: no silent slot replacement, through the UI and forged commands": ten pins via the UI, an 11th project, the replace dialog cancelled, forged `hotbar.assign` without `replace` and with the wrong `expectedTargetId` both `slot_occupied` naming the real occupant, all kept after a restart |
  | Collision revalidation, UI + forged (§22.2 #5) | "Check: collisions are rechecked…": blocked preview, refused click, refused drag; forged overlap, off-map, negative, NaN, huge, fractional, bad rotation, smuggled footprint/appearance, move onto another building |
  | Shortcuts do nothing while typing | "Check: E, 1–0, Escape and Ctrl+Z do nothing while typing…": four fields (Projects search, new-project name, rename, library search), then a positive control showing the same keys work outside a field |
  | Removing a building and unpinning keep the project (§22.2 #3) | "Check: removing a building and unpinning a shortcut keep the project": project record `toEqual` before/after and after a restart; external fixture files byte-identical |
  | Every critical action from the list view, world hidden | "Check: every critical action works from the list view…" |
  | Exit: >10 projects, placed and unplaced, after a restart | "Exit: the world matches the saved projects…": 14 projects, 9 placed (2 through the UI), 5 unplaced, archived in both groups |
  | Packaged smoke (schema v6, buildings offline from bundled art) | Schema v6 was already checked by the first packaged test; new "M2 Checks packaged" and "100 buildings in the packaged app" |
- `expectWorldMatchesSaved()` compares saved data (`placement.list`, `project.list` in every status) with three views: the world (`data-buildings`, status line, no "missing art"), the Atlas Map Buildings list (name + tile per building) and the library's Placed / Not placed filters for Active and Archived.
- Packaged pixel check: Playwright `page.screenshot` works over CDP, so a 1 × 1 clip (`scale: 'css'`) is decoded with `node:zlib`. For a single pixel every PNG row filter leaves the bytes unchanged, so no PNG library is needed. A grass pixel is the positive control.

## The 100-building measurement (Exit)
Measurement, not a guarantee (UI_SPEC §17.4). This machine only, Windows 11, ~144 Hz display.
| Build | Culling | Frames | Mean | p95 | Longest |
|---|---|---|---|---|---|
| Dev (`world.spec.ts` "100 buildings") | checked (fewer drawn zoomed in than out); counts not captured in this run | 110 over 731 ms of input | 6.9 ms | 7.1 ms | 7.3 ms |
| Packaged (`packaged.spec.ts`) | 9 of 100 drawn at 191%, 100 at 25% | 357 over 2432 ms of input | 6.9 ms | 7.1 ms | 7.3 ms |

A frame every ~6.9 ms is the display's refresh interval, so the world never fell behind while hovering, zooming and panning over 100 buildings.

## Verification
- typecheck, lint, format:check: pass. Unit/integration 1303/1303.
- New acceptance spec 7/7 (first run).
- Packaged E2E 17/17 after a fresh `pnpm package` + `pnpm package:test`.
- Full E2E: 115 passed, **1 failed**: `world.spec.ts:337` "hover, wheel zoom and middle-drag pan" (the hover readout stayed idle once). `world.spec.ts --repeat-each=5`: 95/95. This file isn't touched by this branch, so it's a rare earlier flake, now tracked as #108.

## Review
- invariant-reviewer: no violations; it re-ran the dev acceptance spec (7/7). Two wording risks fixed: the Exit title now says "more than ten in total" (9 placed + 5 unplaced, not ten each), and a comment says "off the map" is tested through forged input only, since the map's edge is off screen at the default camera. Spec re-run: 7/7.
- security-auditor: not run (test and docs only, nothing under `src/`).

## Decisions
- No ADR: test-only, followed the plan.
- Routine: windows sized 1400 × 900 in the acceptance spec (like `atlas-connections.spec.ts`) so the Realm Atlas is docked and the tiles used are on screen.
- The 100-building packaged test uses its own profile folder so its buildings don't share the M2 packaged world.
- Opened #108 for the `world.spec` flake instead of fixing it here (not in this task's files).

## Gaps, said plainly
- Undo isn't in the list-view test: Undo/Redo and Ctrl+Z live in the world view. Undo is covered with the world shown (the keyboard test and `placement.spec.ts`).
- §22.2 #3 "run history remains": runs don't exist until M4; the test checks the project record and nearby files only, and says so.

## Open questions
- None blocking. Next: merge #80, then `/close-milestone M2`.

## What the user wrote
Nothing. Claude wrote all code and docs; the user approved the plan.
