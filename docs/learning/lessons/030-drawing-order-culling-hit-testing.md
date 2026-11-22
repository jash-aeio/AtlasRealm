# Lesson 030: Drawing order, culling and hit testing in an isometric world

**Milestone:** M2 · **Date:** 2026-11-22 · **Related:** `src/renderer/world/buildings.ts`, `src/renderer/world/grid-scene.ts`, `tests/e2e/world.spec.ts`, UI_SPEC §17.2 and §17.4, ADR-0013, ADR-0024

## The concept (plain words)
A 2D world with no real 3D depth has to answer three questions itself:

1. **Drawing order (the painter's algorithm).** Draw the things far away first and the near things on top, like a painter covering the background. In an isometric view, "nearer" means further down and to the front. We give each building a **depth key** and sort by it.
2. **Culling.** Don't draw what can't be seen. A building whose box is entirely outside the view is hidden (`visible = false`), so the GPU skips it.
3. **Hit testing.** Find what is under the mouse. The mouse sees the picture, so the answer must be the **front-most** building at that point, not the first one in a list.

## Why Atlas Realm needs it
Buildings overlap on screen: a tall house hides part of the one behind it. With the wrong order, a far house would be painted over a near one. UI_SPEC §17.4 also asks for a responsive world with 100 buildings, which is why we cull. And clicking a roof must select the house you see.

## Where it lives in our code
`buildings.ts` holds plain functions with no Pixi in them, so they run in fast unit tests:

```ts
// Centre of the footprint on the ground: a larger sum is nearer the viewer.
depthKey(rect) = rect.x + rect.y + (rect.columns + rect.rows) / 2
// Ties fall back to x, then y, then the ID, so the order never changes between redraws.
```

A brute-force test (`tests/domain/world-buildings.test.ts`) checks every pair of non-overlapping 2×2, 3×3 and 4×4 buildings on a small grid. Whenever one stands in front of the other, it has the larger key. `isOnScreen` compares a building's box with the view after the camera transform. `pickBuilding` walks the sorted list **from the back** (nearest first) and returns the first silhouette that contains the point.

## Common mistakes
- **Sorting by the anchor tile.** A big building anchored further back can still reach in front of a small one. Use the footprint, not one corner.
- **A comparator that can tie.** `Array.sort` with ties can come out in a different order on each redraw, which makes sprites flicker. Always add tie-breakers.
- **Picking the first hit instead of the front-most.**
- **Tests that guess the camera.** Our old E2E assumed where the map centre was and flaked. Now the world writes its real camera to `data-camera`, and the test works out the expected tile with the same `projection.ts` code.

## Try it (5–15 min exercise)
In `world-buildings.test.ts`, change `depthKey` in a copy to use only `rect.x + rect.y` and run the brute-force test. Which pair fails, and why does the 4×4 beside a 2×2 break it?

## Learn more
- MDN, *Painter's algorithm* overview via 2D canvas compositing: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Compositing
- PixiJS guide, culling: https://pixijs.com/8.x/guides/concepts/culling
