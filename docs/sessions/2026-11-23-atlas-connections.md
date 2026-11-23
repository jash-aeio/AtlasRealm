# 2026-11-23 · Realm Atlas Connections tab (M2-13, #78)

Branch: `feat/78-atlas-connections` (main checkout, from main @ fca518a).

## Task
Fill the Connections tab of the Realm Atlas with the world's real projects (placed and unplaced) and
their typed links, using `graph.worldConnections`. Let the user create and remove links through
forms, with a keyboard list that shows source, relation, target and origin (GRAPH_MODEL §30.3–30.6).

## Decisions (user, via AskUserQuestion)
- **Layout:** our own deterministic ring layout, no layout library. Placed projects on an outer
  ring, unplaced ones on an inner ring, in the server's stable order. No continuous movement
  (§30.6). Recorded in [ADR-0032](../adr/0032-connections-ring-layout-session-positions.md).
- **Dragged positions:** kept only for the session (in the panel's memory), with a "Reset layout"
  button. No schema change; saved positions wait for `graph_view_states`. This defers §30.6
  "preserve manual positions" across restarts. Recorded in [ADR-0032](../adr/0032-connections-ring-layout-session-positions.md).

## Plan
1. `connections-layout.ts` (pure): ring layout, React Flow node/edge mapping, legend labels.
   Unit tests in `tests/domain/atlas-connections.test.ts`.
2. `use-world-connections.ts`: reads `graph.worldConnections`, re-reads after each committed
   link change and when the parent's project `version` changes. React Flow never holds the
   authoritative copy.
3. `ConnectionsGraph.tsx` becomes the real graph (controlled selection through
   `ProjectSelection`, draggable nodes with session-only positions, fit-view animation off under
   reduced motion). The M0 spike graph moves to `SpikeConnectionsGraph.tsx`.
4. `ConnectionsList.tsx` (projects and links, keyboard list) and `LinkForm.tsx` (create form;
   remove confirms that only the link goes).
5. `ConnectionsTab.tsx` wires it into `RealmAtlasPanel.tsx`; `MainScreen.tsx` passes `comfort`.
6. E2E in `tests/e2e/realm-atlas.spec.ts` for every acceptance criterion.

## Routine choices (not asked)
- The link form picks from the graph's nodes. When the graph is truncated (more than 150
  projects), the form says so; projects past the cut can't be picked there yet.
- Link type styles: depends on = solid line, supports = dashed, references = dotted, all with an
  arrowhead at the target and a text label. Archived projects have a dashed border and
  "(archived)"; unplaced projects show "no building".

## What was done
- `db7f9df` ring layout, labels and legend words (pure, unit-tested).
- `6e867a9` the M0 spike graph moved to `SpikeConnectionsGraph.tsx`.
- `2bb546c` the Connections tab: `ConnectionsTab`, `ConnectionsGraph`, `ConnectionsList`, `LinkForm`
  (with `RemoveLinkDialog`), `use-world-connections`; `RealmAtlasPanel` and `MainScreen` pass `comfort`.
- E2E in a new `tests/e2e/atlas-connections.spec.ts` (7 tests) instead of `atlas.spec.ts`, which
  holds the M0 spike tests. `realm-atlas.spec.ts`'s placeholder test now checks the real counts.
- A screenshot check (`webContents.capturePage`) found all four nodes in one vertical line, with
  the link running through the unplaced ones. Fixed: the inner ring is turned half a step and kept
  about one node width from the centre (unit test added).
- Checks: typecheck, lint, format:check pass; unit 1119/1119; E2E 101/101.
- Honest limit: the reduced-motion E2E checks the `data-layout-animation` attribute, which comes
  from the same flag that sets the fit-view duration; it doesn't measure the animation itself.

## Open questions
_None yet._
