# 2026-11-20: M2-1 placement rules (#66)

**Branch:** `feat/66-placement-rules` · **Issue:** [#66](https://github.com/jash-aeio/AtlasRealm/issues/66)

## Task
Build one pure, well-tested module that decides whether a building may stand on a set of tiles. The placement preview (renderer, M2-7) and the placement commands (main, M2-3) will both use it, so the preview and the real check can never disagree (UI_SPEC §17.2).

## Plan
1. `src/common/world/placement-rules.ts`: footprint tiles, `checkPlacement`, `findNearbyPlot`, plus the shared rotation list.
2. `tests/domain/placement-rules.test.ts`: edges, corners, bad coordinates, every rotation, reserved areas, overlaps, a full world, an exact-fit gap, determinism and a speed check.
3. Docs: ADR-0024, spec notes, glossary, lesson 026, then `/ship`.

## Decisions
- **[ADR-0024](../adr/0024-placement-anchor-and-rotation.md) (user, via AskUserQuestion):** a placement's `(tileX, tileY)` is the footprint's north corner tile, and rotation turns the building in place. Square buildings cover the same tiles at every rotation; rectangular ones swap columns and rows at 90/270.
- Routine, following the spec:
  - Checks run in a fixed order and the first failure wins: rotation → bounds → reserved → other buildings.
  - `overlaps` lists each blocking building once, in input order.
  - A footprint or rotation that could only come from a bug (not from the user) throws `RangeError` instead of returning a result.
  - **Reserved areas** are an input (`world.reserved`). Nothing defines any yet, so callers pass `[]`. This is labelled in the code.
  - Auto-place searches square rings outward from the start. Within a ring it goes top row first, left to right. A start outside the map is moved to the nearest spot on the map. It uses a summed-area table, so checking a whole rectangle takes constant time.
  - The rotation list (`PLACEMENT_ROTATIONS`) now lives in the rules module. The placement repository imports and re-exports it. This was the "unify the rotation type" handoff from the #67 review.

## What was done
- Slice 1 (`6d9a739`): rules module, 34 unit tests, and the repository using the shared rotation list.
- Verification: typecheck, lint and format:check pass; `pnpm test` 848/848.

## Open questions
- What should a reserved area be: a spawn plaza, a path, the avatar's start tile? Nothing in the spec says yet. The rule is ready for whichever feature defines one.
