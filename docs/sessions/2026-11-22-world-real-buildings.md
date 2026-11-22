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
- **Hit testing:** the front-most building whose sprite box or footprint contains the point. The
  sprite box includes the image's transparent corners: an accepted approximation.
- **Not in scope:** building name labels and their toggle (UI_SPEC §6.6), drag placement (M2-7).
