# Lesson 007: Rendering as a pure view: isometric projection, canvas lifecycle and honest fallbacks
**Milestone:** M0 · **Date:** 2026-11-10 · **Related:** `src/renderer/world/`, ADR-0002, ADR-0011, UI_SPEC §17.1

## The concept (plain words)
A **pure view** draws data but never owns it. The world canvas is a picture, like a map of a city: you can redraw, zoom, crash or delete the map, and the city is unchanged. Three ideas make that work:
1. **Coordinates are data; pixels are presentation.** We store grid positions `(gx, gy)`. Pixels are calculated only at draw time, by the isometric projection.
2. **The canvas has a lifecycle.** A GPU context is a limited resource, so whoever creates it must release it, even when startup is still running.
3. **Failure is visible and contained.** If graphics don't work, the world says so, and everything else keeps working.

## Why Atlas Realm needs it
The product rules say layout is cosmetic and projects exist without buildings. If the view held the truth, a GPU driver crash could "lose" a project. ADR-0002 keeps the truth in the main process and SQLite.

## Where it lives in our code
- `projection.ts`: pure math with no DOM, so it's unit-tested in Node:
  ```ts
  screenX = (gx - gy) * W / 2      // forward (grid → world)
  gx = x / W + y / H               // inverse (world → grid)
  world = (screen - pan) / zoom    // undo the camera first
  ```
- `grid-scene.ts`: Pixi only. It draws, it doesn't decide anything.
- `WorldCanvas.tsx`: owns the lifecycle. Because `app.init()` is async, the cleanup can run *before* init finishes, so a `disposed` flag makes a late init destroy its own app.
- `WorldErrorBoundary.tsx`: catches a crash so it stays inside the world area.

## Common mistakes
- **Storing pixels.** Pixel values change with zoom, tile size and art. Grid coordinates don't.
- **`Math.floor` at exact edges.** `0.3 * x / 0.3` can come out as `0.9999999`. We add a tiny epsilon and test all 4096 tiles.
- **Forgetting async cleanup.** React StrictMode mounts twice on purpose, to expose exactly this mistake.
- **A fallback nobody tested.** Our E2E tests remove WebGL and check that Canvas2D really draws pixels.
- **A test that can't fail.** Break the code on purpose (a mutation check) and watch the test go red.

## Try it (5–15 min exercise)
1. Work out by hand which tile is at world `(80, 60)` with 64×32 tiles. Check your answer with a one-line test in `tests/domain/projection.test.ts`. (Answer: tile 35, 32.)
2. In `WorldCanvas.tsx`, temporarily delete `created.destroy();` inside `if (disposed)`. Run `pnpm test:e2e` and see which test fails and why. Then undo the change.

## Learn more
- [PixiJS Application guide](https://pixijs.com/8.x/guides/components/application)
- [React: synchronizing with effects (cleanup)](https://react.dev/learn/synchronizing-with-effects)
- [MDN: WebGL context loss](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextlost_event)
