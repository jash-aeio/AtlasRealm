# 2026-11-10: M0-5 React Flow selection-sharing spike (#8)

**Branch:** `spike/8-react-flow-selection` · **Issue:** [#8](https://github.com/jash-aeio/AtlasRealm/issues/8)

## Task
Prove the Realm Atlas graph (React Flow) and the world view (Pixi) can share selection through shared entity IDs (ADR-0003):
- A small React Flow graph renders in an upper-right panel placeholder.
- Selecting a node updates a shared selection store, and the Pixi view reacts to the same ID.
- A quick performance check with ~150 nodes / 300 edges, recorded on the issue.
- The outcome is noted in ADR-0003.

## Decisions (asked through AskUserQuestion)
- **Selection store:** our own tiny store built on React's `useSyncExternalStore`, not zustand. It adds no dependency, and non-React code (the Pixi scene) can subscribe to it too.
- **Scope:** selection works in both directions. Clicking a marker in the world also selects the matching graph node.

## Findings before coding
- React Flow is `@xyflow/react` 12.12.1 (MIT). It needs a CSS import (`@xyflow/react/dist/style.css`), and Vite bundles that into our own stylesheet, so `style-src 'self'` should be enough. The E2E tests check this.
- React Flow already depends on zustand 4 internally. We don't import it.

## Plan
1. `chore(deps)`: add `@xyflow/react` at an exact version.
2. `feat(state)`: selection store and the M0 mock entities, plus unit tests.
3. `feat(atlas)`: Realm Atlas panel (upper right) with a Connections graph and a keyboard-usable list.
4. `feat(world)`: entity markers on the grid, a selection highlight, and click-to-select.
5. `test(e2e)`: selection both ways, CSP, and a stress-graph performance check (150 / 300).
6. Docs: ADR-0003 outcome, status, glossary, lesson.

## Routine choices (spec defaults, not asked)
- Mock entities are 8 labelled projects near the map centre. Every view shows "M0 spike · mock data" or "(mock)".
- Selection never moves the world camera (GRAPH_MODEL §30.1: "do not force a camera jump").
- Graph nodes can't be dragged, connected or deleted in the spike. The layout is cosmetic.
- Left-clicking empty ground clears the selection. Middle-drag still pans.
- React Flow's attribution stays visible (its maintainers ask non-subscribers to keep it).

## Plan → what was done
1. `chore(deps)`: `@xyflow/react` 12.12.1, with no install scripts.
2. `feat(state)`: `store.ts`, `use-store.ts`, `selection.ts`, `spike-graph.ts`, plus 13 unit tests.
3. `feat(atlas)`: `RealmAtlasPanel` + `ConnectionsGraph`, a workspace grid in `App.tsx`/`app.css`. World E2E locators are now scoped to the world section, because React Flow's controls also have "Zoom In/Out" buttons.
4. `feat(world)`: markers and a selection highlight in `grid-scene.ts`, and the store connection plus click-to-select in `WorldCanvas`.
5. `test(e2e)`: `tests/e2e/atlas.spec.ts`, 6 tests. Results: unit 138/138, E2E 29/29.
6. Docs: ADR-0003 outcome, lesson 008, glossary.

## Verification
- Mutation checks, each of which made a test fail:
  - the Pixi highlight turned off (2 tests failed)
  - no initial selection on a new scene (1)
  - the graph ignoring the store (4)
  - click-only selection, with no keyboard path (1)
- Performance at 150 / 300 (6 runs): load 84–184 ms, click → world 67–100 ms, frame p95 7–14 ms. Details are in ADR-0003 and on the issue.
- Screenshots were checked by eye: the highlight and the selected node use the same blue. The stress graph is unreadable at "fit to view" (a finding, see ADR-0003).

## Mistake and lesson
During a mutation check, `git checkout <file>` also threw away that file's *uncommitted* slice changes. A backup made just before restored them. From now on, commit a slice before running mutation checks on it.

## Open questions
- How to credit React Flow, since its attribution link can't open (navigation is blocked).
- Selection latency (~70–100 ms with 150 nodes) is under the "feels instant" bar, but should be profiled before the limits go up.
