# 2026-11-22 · Placement tool (M2-7, #72)

## Task
[#72](https://github.com/jash-aeio/AtlasRealm/issues/72): let the user place, move and remove buildings on the map, with a clear valid/invalid preview. Every change goes through the placement commands (UI_SPEC §6.2, §17.2). Branch `feat/72-placement-tool`, main checkout (peer sessions idle).

## Plan
1. **Tool core** (`src/renderer/world/placement-tool.ts`): a per-world store with a small state machine (`idle` → `placing` / `moving` → `idle`). It works out the preview with the shared `checkPlacement` rules and sends changes through `placement.create/move/remove`, then refreshes the placements store. Auto-place uses `findNearbyPlot`. Unit-tested with a fake API. `DEFAULT_BUILDING_APPEARANCE` moves to `src/common/world` so the preview and the server use the same footprint.
2. **Scene preview:** footprint tiles with the valid/invalid placeholder markers, a faded copy of the building, and a text sign so colour is never the only signal.
3. **World interaction:** the preview follows the pointer, and a left-button release commits (click places, drag moves). A tool bar has Place here / Auto-place / Cancel (Esc). Arrow keys nudge the preview, and Escape cancels.
4. **Entry points:** Place on map / Auto-place / Remove from map in the project list. Move building / Remove from map in the inspector. Removing asks for confirmation in plain words.
5. **E2E** in `tests/e2e/placement.spec.ts`, including §22.2 #1 (cancel placement, restart, the project is still there and unplaced).

Out of scope: rotation (only square footprints exist) and undo (M2-8, #73).

## Decisions
- **An invalid drop leaves the building at its saved spot** (user choice, recommended option). Nothing is saved and a message says why. We read UI_SPEC §17.2 "an invalid drop preserves the last valid location" as the last *saved* location, not the last valid tile the drag passed over, so a building never lands somewhere the user didn't let go.
- **Auto-place saves straight away** (user choice, recommended option). It finds the nearest free plot and says where it put the building. It works from the project list without the map. When no plot fits it says the world is full and changes nothing.
- Routine: the preview anchor puts the pointer on the footprint's centre tile (the north tile for 2×2). Only left-button releases commit; middle-drag still pans.

## What was done
Four commits on :
1. : the state machine, the preview (, shared ), and place/move/remove/auto-place through the placement commands.  moved to  (main re-exports it). 16 unit tests in .
2. :  draws the footprint tiles with the valid () or invalid () marker, a faded copy of the building (tinted red when blocked), and a text sign. A building being moved is drawn faded at its saved spot.
3. UI:  (mode, tile, a ✓/✕ text label, Place/Move here, Auto-place, Cancel Esc, result line).  turns pointer moves into the preview and a left release into a commit, and registers arrow keys and Escape with the shortcut layer. The Projects list gets Place on map / Auto-place / Remove from map. The inspector gets Move building / Place on map / Remove from map. Removing asks for confirmation. Starting the tool closes the open panel.
4. E2E: 7 new UI tests in  (one test per acceptance criterion, including §22.2 #1 with a real restart, and a world filled with 484 buildings so auto-place finds no plot).

Verification: typecheck, lint and format:check pass; unit/integration 970/970; placement E2E 8/8; full E2E 76/77. The one failure was the known hover/zoom/pan flake in , which passed 5/5 when run again on its own. The failed run's hover readout moved without the test moving the mouse, which points to real cursor movement over the test window. Screenshots (taken with Electron's , not committed) confirmed the blocked and fits previews draw as intended.

Not done: rotation (only square footprints exist) and undo (M2-8, #73). At 50% zoom the preview sign's text is small; the same text is always in the HTML tool bar.

## Open questions
- The arrow keys follow the grid axes (Right = +x, which is down-right on screen), not the screen directions. The tool bar shows the tile. Worth revisiting if it feels odd in use.
