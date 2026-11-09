# 2026-11-10: M0-4 PixiJS placeholder isometric canvas (#7)

**Branch:** `spike/7-pixi-canvas` · **Issue:** [#7](https://github.com/jash-aeio/AtlasRealm/issues/7)

## Task
Prove PixiJS can render inside the React layout as a pure view (ADR-0002):
- A placeholder isometric grid drawn with the UI_SPEC §17.1 projection math.
- Projection and inverse projection unit-tested: edges, zoom, negative camera.
- The canvas resizes with its container and cleans up when unmounted.
- If WebGL/canvas fails, the rest of the UI stays usable and shows a visible message.

## Decisions (asked through AskUserQuestion)
- **React integration:** plain `pixi.js` (8.22.0) plus our own `WorldCanvas` component. We don't use `@pixi/react`. That means one dependency, and we control the lifecycle ourselves. The world is a view, so React doesn't need to own the scene tree.
- **Renderer order:** WebGL first, then Canvas2D. WebGPU stays off until it's tested on real machines. If both renderers fail, the UI shows a message.

## Findings before coding
- PixiJS 8 uses `new Function()` for shader/uniform code. Our CSP (Content Security Policy, the browser's list of allowed code sources) blocks that. The official fix is `import 'pixi.js/unsafe-eval'`. Despite the name, it swaps in static code so `unsafe-eval` is **not** needed, and the CSP stays unchanged.
- React `StrictMode` mounts every component twice in development. Pixi's `app.init()` is async, so the component has to cope with "unmounted before init finished".

## Plan
1. `feat(world)`: projection math (`src/renderer/world/projection.ts`, pure, no DOM) plus `tests/domain/projection.test.ts`.
2. `feat(world)`: add `pixi.js`, a `WorldCanvas` component that draws a 64×64 placeholder diamond grid (64×32 px tiles, ART_BIBLE), resizes with its container, and destroys Pixi on unmount. Hovering a tile shows its grid coordinate (this exercises the inverse projection).
3. `feat(world)`: failure handling. An init error or a render crash shows a message inside the world area, and the panels keep working.
4. `test(e2e)`: the canvas renders under the production CSP, resizes with the window, and a forced WebGL failure falls back or shows the message while the IPC panel still works.
5. Docs: ADR-0011, glossary terms, lesson note, status.
