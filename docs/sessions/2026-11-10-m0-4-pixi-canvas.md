# 2026-11-10: M0-4 PixiJS placeholder isometric canvas (#7)

**Branch:** `spike/7-pixi-canvas` · **Issue:** [#7](https://github.com/jash-aeio/AtlasRealm/issues/7)

## Task
Prove PixiJS can render inside the React layout as a pure view (ADR-0002):
- A placeholder isometric grid drawn with the UI_SPEC §17.1 projection math.
- Projection and inverse projection unit-tested: edges, zoom, negative camera.
- The canvas resizes with its container and cleans up when unmounted.
- If WebGL/canvas fails, the rest of the UI stays usable and shows a visible message.

## Decisions (asked through AskUserQuestion; recorded in [ADR-0011](../adr/0011-plain-pixijs-webgl-canvas-fallback.md))
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

## Routine choices (spec defaults, not asked)
- Rendering happens on demand, with no 60 FPS loop. The grid is static, and UI_SPEC §17.4 says users shouldn't need a GPU-heavy scene running.
- Resizing uses a `ResizeObserver` on the container. Pixi's own `resizeTo` only reacts to window resizes, so it would miss layout changes.
- Controls: wheel zoom around the cursor, middle-drag pan (UI_SPEC §6.2), and Zoom in/out/Reset buttons, so zoom also works without a mouse (§6.6). Zoom bounds are 0.25×–4×, and the view starts at 0.5×.
- The tile under the cursor is shown as text ("Tile 32, 32"). This is a non-canvas readout, and the E2E tests use it.
- "Hide world view" toggle, labeled as part of the M0 spike. It exists to exercise unmounting.
- The pnpm prompt "Agent skills awaiting approval: pixi.js" was left unapproved. Those are optional AI-assistant instruction files that ship inside the package, and we don't need them.

## Plan → what was done
1. `feat(world)` projection math + 17 unit tests.
2. + 3. `feat(world)` canvas and failure handling, combined into one commit because both live in `WorldCanvas`. The failure handling covers init failure, a lost WebGL context, and render crashes (`WorldErrorBoundary`).
4. `test(e2e)` `tests/e2e/world.spec.ts`, 8 tests (all E2E: 23/23).
5. Docs: ADR-0011, glossary, lesson.

## Things learned along the way
- **Mutation checks caught three weak tests.**
  - The first edge-precision unit test passed even without the fix. The tile I picked happened to round cleanly, so the test now sweeps all 4096 tiles at four zoom levels.
  - The "hide during init" E2E test never actually raced. Two synchronous clicks get batched by React, so the world never mounted. Even with a gap of one task, init usually finished first (4/20). Hiding a microtask after showing makes it race reliably, and the test now asserts that more than 10 of 20 cycles raced.
  - Counting canvases couldn't see a leaked WebGL context, because a late init never adds its canvas to the page. The test now records every WebGL context through a passive wrapper and counts the ones still alive.
- **Pixi keeps one page-wide helper context** (`getTestContext()`, used to read GPU limits). It's created once and reused, so the leak test compares against that baseline instead of zero.
- **Pixels are checked for real.** `webContents.capturePage()` reads composited pixels in the main process. It confirms green ground in the centre and the dark background past the map edge, so the test isn't just checking that a canvas element exists.

## Mutation checks (each made a test fail)
| Mutation | Failed test |
|---|---|
| Remove `import 'pixi.js/unsafe-eval'` | renders under production CSP (state `failed`) |
| Remove the ResizeObserver resize | canvas follows its container |
| Grey ground colour | both pixel tests |
| Skip `destroy()` on unmount | hide/show leak test |
| Skip `destroy()` for a late-finishing init | hide/show leak test (live-context count) |
| Remove `EDGE_EPSILON` | unit: exact edges under float error |

## Not verified
- `pnpm dev` (StrictMode's double mount) wasn't run by hand. That path is the same "unmount before init finishes" case the E2E race test covers in the built app.
- Canvas2D was only forced in tests, not seen on a real GPU-less machine. CI runners have no GPU, so the CI run will show which renderer they pick. Either one is accepted.
- Performance targets (§17.4: 100 buildings, 60 FPS) weren't measured. There are no buildings yet.
- The packaged app wasn't re-run with the world view. The packaged E2E checks shell, storage and assets, and `pnpm test:e2e` covers the built `out/` that gets packaged.
