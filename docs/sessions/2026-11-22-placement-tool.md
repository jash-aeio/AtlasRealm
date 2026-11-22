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
_(filled in at the end)_

## Open questions
_None yet._
