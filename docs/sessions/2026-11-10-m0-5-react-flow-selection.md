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
