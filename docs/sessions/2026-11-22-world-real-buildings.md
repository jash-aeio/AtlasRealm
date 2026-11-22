# 2026-11-22: The world shows real buildings (#71, M2-6)

## Task

Replace the "World view: not built yet" placeholder on the main screen with a Pixi world that draws
the buildings saved by `placement.list`. Click selects a building and shows its project in the
inspector. "Open" or a double-click shows the project details. Unplaced projects are marked
"Not placed" in the list. The flaky world-canvas E2E test is made deterministic.

Branch `feat/71-world-real-buildings`, main checkout (no peer session active).

## Plan (approved by the user)

1. Pure world math (`src/renderer/world/buildings.ts`): pivot, footprint rectangle, screen
   bounds, a stable depth sort, culling and hit testing, with unit tests.
2. A project selection store (`state/selection.ts`) and a per-world placements store.
3. The product world (`WorldView.tsx`) in `.world-area`, sized to the world's grid, with
   placeholder building sprites, an archived look and a "Missing art" placeholder.
4. Inspector summary, a Project details panel, "Unarchive" for archived projects, and a
   "Not placed" tag in the Projects panel.
5. E2E rewrite for the product world, the flaky test fix, and a 100-building measurement.

## Decisions so far

- **Depth sort key:** the centre of the footprint on the ground, `x + y + (columns + rows) / 2`,
  ties broken by x, y, then placement ID. It is exact for square footprints (every ADR-0013
  size): two squares that overlap on screen never tie. Routine choice, no ADR.
- **Hit testing:** the front-most building whose silhouette contains the point: inside its drawn
  box and not below the front edges of its footprint, so the ground in front of a building stays
  ground. The box still includes the image's transparent top corners: an accepted approximation.
- **Not in scope:** building name labels and their toggle (UI_SPEC §6.6), drag placement (M2-7).

## What was done

Five commits on `feat/71-world-real-buildings`:

1. `buildings.ts`: pivot, footprint, depth key, culling and silhouette hit test, with 13 unit
   tests (including a brute-force check over every pair of square buildings).
2. `world-placements.ts` (per-world copy of `placement.list`, ignores stale answers) and
   `createProjectSelection` in `selection.ts`, with 5 unit tests.
3. `WorldView.tsx` on the main screen and a building layer in `grid-scene.ts`: placeholder art,
   an "Archived" look, a "Missing art" block, a selection outline and culling. The camera code
   moved into a shared `useWorldScene` hook, so the M0 spike grid uses the same code.
4. `ProjectInspector.tsx`, `ProjectDetails.tsx` (a "project" panel), Unarchive behind a
   confirmation, and the "Not placed" tag in the Projects list. The list and the world reload
   each other after changes.
5. `tests/e2e/world.spec.ts` rewritten for the product world (15 tests).

## Verification

- typecheck, lint, format:check pass. Unit/integration 954/954. E2E 70/70. Packaged E2E 15/15.
- Camera, selection and pixel tests: 140/140 over `--repeat-each=20`.
- 100 buildings, built app: frame gap mean 6.9 ms, p95 7.3 ms, longest 8.5 ms over 908 ms of
  hover, zoom and pan. One machine, one run: a measurement, not a guarantee.
- invariant-reviewer: no violations. security-auditor not needed (renderer, tests, docs only).

## The flaky test

The old test "hover, wheel zoom and middle-drag pan" assumed the map centre sat exactly in the
middle of the canvas host, and checked fixed tiles after fixed pixel moves. Anything that shifted
the layout or camera a little made it fail now and then. The world now writes its real camera to
`data-camera`, and the test works out the expected tile from it with `projection.ts`. Pans are
checked as exact camera changes (+64 px), and the zoom check confirms the world point under the
cursor stays put (within one world pixel, because the browser reports the pointer in whole
pixels). A pan also ends when a pointer move arrives without the middle button held, or when
pointer capture is lost, so a missed button-up can't keep dragging the map.

## Decisions (routine, no ADR)

- Depth key and hit test as planned above.
- "Open" shows a details panel, as `docs/pm/milestones/M2.md` says for M2; the workspace is labelled
  as planned for M5.
- Unarchive uses the same kind of confirmation as Restore in the list, plus "Its building stays
  where it is in the world" when the project has a building.
- `ProjectsPanel`/`ProjectItem` (outside the issue's file list) got the "Not placed" tag and
  refresh hooks. No other lane was working in those files.

## Open questions

- The issue asks for the 100-building measurement "on a dev build". The numbers here come from the
  production build that E2E runs, because starting `pnpm dev` from Claude was blocked earlier.
  The user can repeat it in `pnpm dev` if they want dev-build numbers.
- Building name labels and their toggle (UI_SPEC §6.6) are not in any M2 issue yet.

Lesson: [030 Drawing order, culling and hit testing](../learning/lessons/030-drawing-order-culling-hit-testing.md).
The user wrote no code in this session (CLAUDE.md: Claude writes all code).
