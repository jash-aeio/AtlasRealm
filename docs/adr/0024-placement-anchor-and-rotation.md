# ADR-0024: Placement anchor is the north corner tile; rotation turns the building in place

- **Status:** Accepted
- **Date:** 2026-11-20
- **Milestone(s) affected:** M2 (M2-1 #66, M2-3 #68, M2-7 #72), later every milestone that reads saved placements
- **Decided by:** the user (asked via AskUserQuestion on 2026-11-20)

## Context
Schema v5 (ADR-0023) stores a building as one tile position (`tile_x`, `tile_y`) and a rotation (0/90/180/270). UI_SPEC §17.1 says to "store grid position and rotation, not screen pixels", but nothing said *which* tile of the footprint that position names or what rotation does to the covered tiles. The shared placement rules (M2-1) need an answer before any building is saved, because saved rows can't be reinterpreted later without moving every building.

Constraints: ADR-0013 fixes footprints at 2×2, 3×3 and 4×4 tiles (the asset manifest allows any `columns × rows`) and puts the art's ground pivot on the footprint's **south** corner. The grid picker (`pickTile`) returns the tile under the pointer.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| **North corner anchor, turn in place** | Footprint always grows toward +x/+y, so bounds are `0 ≤ x` and `x + columns ≤ width`. Rotating never moves the building or pushes it off the map. Square buildings keep the same tiles at every rotation | The stored tile isn't the art pivot; the pivot is `(tileX + columns, tileY + rows)` |
| South corner anchor | The stored tile matches the art pivot | Footprint grows toward −x/−y, so every bounds and overlap check runs backwards from what the picker returns |
| Rotate around the anchor | Familiar from some puzzle games | Each turn swings the footprint around one tile, so rotating can push a building off the map or into a neighbour |

## Decision
We chose **north corner anchor, turn in place**:
- A placement's `(tileX, tileY)` is the lowest-x, lowest-y tile it covers. The footprint covers `tileX … tileX + columns − 1` and `tileY … tileY + rows − 1`.
- Rotation turns the art in place. A rectangular footprint swaps columns and rows at 90 and 270; the anchor stays put.
- The ADR-0013 south-corner pivot is drawn at grid point `(tileX + columns, tileY + rows)`, using the turned footprint.

It keeps the maths simple and the behaviour unsurprising: a building never jumps when you turn it.

## Consequences
- `src/common/world/placement-rules.ts` implements this and is the single source of the rotation list (the placement repository imports it).
- M2-3's handler and M2-7's preview both use `footprintRect` / `checkPlacement`; the renderer computes the sprite position from the turned footprint.
- A rectangular appearance turned at 90/270 can collide where it didn't before; `checkPlacement` covers it, so a rotate command must re-run the rules.
- Signals to revisit: buildings that should visibly rotate around a door or entrance tile, or non-rectangular footprints (L-shapes). Either would need a new ADR and a migration of saved rows.

## Learning note
When you store a position, decide exactly what that number means *before* the first row is saved. "Which corner?" sounds trivial, but once data exists, changing the answer means rewriting every saved row.
