# Lesson 031: A tool as a state machine: preview, commit, cancel
**Milestone:** M2 · **Date:** 2026-11-22 · **Related:** `src/renderer/world/placement-tool.ts`, `WorldView.tsx`, `PlacementToolBar.tsx`, `tests/domain/placement-tool.test.ts`, UI_SPEC §6.2 / §17.2, lesson 026

## The concept (plain words)
A **state machine** is a small, fixed list of states plus the moves allowed between them. The placement tool has three states: `idle`, `placing` (a new building for a project) and `moving` (an existing building). Every action is a move: `startPlacing` goes from idle to placing, `commit` or `cancel` goes back to idle. Because the states are a TypeScript union, the compiler won't let you read `mode.placementId` unless you have checked that the mode is `moving`.

## Why Atlas Realm needs it
Without explicit states, a tool becomes a pile of booleans (`isPlacing`, `isDragging`, `isMoving`) that can disagree. Then a click both selects a building and places one, or Escape cancels something that was never open. With a state machine, each input means exactly one thing in each state. Escape in `idle` does nothing; in `placing` it cancels and saves nothing (§6.2: "never discard saved project data").

## Where it lives in our code
```ts
type ToolMode =
  | { kind: 'idle' }
  | { kind: 'placing'; project; footprint; rotation }
  | { kind: 'moving'; project; placementId; footprint; rotation; origin };
```
- **Derived state:** the preview isn't stored. `previewOf(toolState, world, placements)` works it out each time from the tool's anchor and the latest buildings, using the shared `checkPlacement` (lesson 026). So if a building appears while the tool is open, the preview turns red at once.
- **Commit on release:** `WorldView` updates the preview on every pointer move and commits when the left button is *released*. A click and a drag are then the same gesture: a click is just a drag that didn't go anywhere. `setPointerCapture` keeps the release coming to the map even if the pointer leaves it.
- **Two kinds of refusal:** a spot the preview already refuses is refused locally (no IPC call). A spot the preview allows can still be refused by the main process, for example when another window placed a building there. Then the tool shows the message, reloads the map and stays open. The command decides; the preview is a hint.
- **Busy guard:** `busy: true` while a command is on its way, so a double click can't send two creates.
- **Focus:** opening the tool focuses Place here; closing it gives focus back to the opener, or to the result line if the opener is gone.

## Common mistakes
- Storing the preview's "fits" flag. It goes stale when the buildings change.
- Committing on `click`. Then a drag needs a separate code path, and the click that follows a drag selects a building by accident.
- Forgetting `finally`: if a call throws, `busy` never resets and the tool freezes.

## Try it (10 min)
In `tests/domain/placement-tool.test.ts`, write a test that calls `cancel()` while `moving` and checks that `api.placement.move` was never called and the saved tile is unchanged.

## Learn more
- [TypeScript: discriminated unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions)
- [MDN: Element.setPointerCapture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture)
