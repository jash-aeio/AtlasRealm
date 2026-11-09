# ADR-0011: Plain `pixi.js` with our own React wrapper; WebGL first, then Canvas2D

- **Status:** Accepted
- **Date:** 2026-11-10
- **Milestone(s) affected:** M0-4 (Pixi spike), M2 (world), M5 (interiors)
- **Decided by:** jash-aeio (asked via AskUserQuestion on 2026-11-10)

## Context
ADR-0002 chose PixiJS as a pure view for the world (UI_SPEC §17). M0-4 (issue #7) had two open questions:
1. **How React hosts the canvas.** We could add the official React bindings or write our own small component.
2. **Which renderers Pixi may try.** If the chosen renderer fails, the rest of the UI must stay usable with a visible message (issue #7 acceptance criteria).

Evidence gathered on 2026-11-10 (context7, pixi.js v8.22.0 docs and source):
- `pixi.js` 8.22.0 was released 2026-10-01 under the MIT license and has no install scripts. `@pixi/react` 8.0.5 needs React 19 and `pixi.js` ^8.2.6.
- `preference` as an **array** limits Pixi to exactly those renderers, in that order. `app.renderer.name` reports which one Pixi actually picked.
- Pixi 8 generates shader code with `new Function()`, which our CSP blocks. The fix is to import `pixi.js/unsafe-eval` first. It swaps in prebuilt code, so the CSP stays unchanged.

## Options considered
**React integration**
| Option | Pros | Cons |
|---|---|---|
| **Plain `pixi.js` + our own `WorldCanvas`** | One dependency. We control the async init and destroy, including React StrictMode's double mount. This fits ADR-0002: data never lives in the scene tree. | We write the lifecycle code ourselves (about 100 lines) and keep the scene updates imperative. |
| `@pixi/react` | Pixi objects can be written as JSX, which is nice for large scenes. | A second dependency. React's reconciler sits between our data and the scene, which makes it tempting to keep state in the view. |

**Renderer order**
| Option | Pros | Cons |
|---|---|---|
| **`['webgl', 'canvas']`** | WebGL is mature in Electron. Canvas2D still draws the world without a GPU. | No WebGPU yet. |
| Pixi default (WebGL → WebGPU → Canvas) | More fallbacks. | WebGPU support varies by driver, which adds an untested path. |
| WebGL only | Simplest. | Machines without WebGL get only the message. |

## Decision
We chose **plain `pixi.js` 8.22.0** (exact pin), hosted by `src/renderer/world/WorldCanvas.tsx`, and **`preference: ['webgl', 'canvas']`** (`RENDERER_PREFERENCE` in `grid-scene.ts`). If neither renderer starts, `WorldCanvas` shows a message in the world area, and the other panels keep working. The same happens when a WebGL context is lost or the view crashes (caught by `WorldErrorBoundary`).

## Consequences
- Easier: the world view needs only one dependency, and the lifecycle is explicit and tested. The E2E tests count live WebGL contexts across 20 mounts plus hides during init.
- Harder: scene updates are imperative calls (`setCamera`, `setHover`). As the world grows (M2), we'll need a clear "committed events → scene" layer.
- The CSP keeps forbidding `unsafe-eval`. `grid-scene.ts` must keep importing `pixi.js/unsafe-eval` before any renderer exists. A mutation check showed the world fails to start without it.
- Signals to revisit:
  - M2 scene code becomes hard to keep in sync by hand. In that case, reconsider `@pixi/react`.
  - Canvas2D turns out too slow for the 100-building target (§17.4).
  - WebGPU becomes worth testing on the reference machine. Add it to `RENDERER_PREFERENCE` only after it's tested.

## Learning note
A library that "fits React" isn't automatically the right choice. When the canvas is only a picture of data stored elsewhere, a small hand-written bridge is easier to reason about than another layer. Also, a fallback is only real if a test forces it to happen. Here the E2E tests take WebGL away and check that Canvas2D draws.
