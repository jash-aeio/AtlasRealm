# Lesson 008: One store, many views (shared selection)
**Milestone:** M0 · **Date:** 2026-11-10 · **Related:** `src/renderer/state/`, `src/renderer/atlas/`, `src/renderer/world/WorldCanvas.tsx`, ADR-0003, GRAPH_MODEL §30

## The concept (plain words)
When two parts of the screen show the same thing, they must agree on what's selected. The trap is giving each view its own copy of "selected". Then every click has to update both copies, and sooner or later one is missed.

The fix is a **single source of truth**. The value lives in one place, a **store**, and the views only *read* it and *ask* it to change. A view never owns the value. It shows whatever the store currently holds.

Our store is an **external store**: the value lives outside any React component. React reads it with `useSyncExternalStore`, React's built-in hook for exactly this job. Non-React code can subscribe to it directly.

## Why Atlas Realm needs it
The world (Pixi) and the Realm Atlas graph (React Flow) both show projects. ADR-0003 says they share entity IDs and have "no separate authoritative models per view". Selecting a project in either view must highlight it in the other.

## Where it lives in our code
- `state/store.ts`: about 30 lines with `get`, `set` and `subscribe`. `set` skips equal values, so nothing re-renders for nothing.
- `state/selection.ts`: `select(id, source)` refuses IDs that aren't in the current graph.
- **Graph** (`ConnectionsGraph.tsx`): selection is *controlled*. The store decides which node has `selected: true`. React Flow's own "select" changes are forwarded to the store and nothing else:
  ```ts
  if (change.type === 'select' && change.selected) state.select(change.id, 'atlas');
  ```
- **World** (`WorldCanvas.tsx`): reads the store and tells the Pixi scene `setSelected(tile)`. The scene itself knows nothing about stores (lesson 007: pure view).

The loop is: click → store → every view redraws. No view ever talks to another view directly.

## Common mistakes
- **`get()` returning a new object each call.** `useSyncExternalStore` compares results, so a fresh object every time means it loops forever. Our store returns the same object until `set` changes it.
- **Half-controlled components.** If React Flow kept its own selection *and* we passed ours, they could disagree. Pick one owner.
- **Forgetting late subscribers.** A Pixi scene created after the selection changed must still draw it. `WorldCanvas` applies the current value when the scene finishes starting (an E2E test checks this).
- **Re-creating every node object** on each selection change makes React Flow re-render all 150 nodes. We replace only the selected one.

## Try it (5–15 min exercise)
In `tests/domain/selection-store.test.ts`, add a test: subscribe two listeners, call `select('mock-thesis', 'atlas')` twice, and assert each listener ran exactly once. Then explain which line in `store.ts` makes that true.

## Learn more
- React: [useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore)
- React Flow: [`<ReactFlow />` props](https://reactflow.dev/api-reference/react-flow) (`nodes`, `onNodesChange`, `selected`)
