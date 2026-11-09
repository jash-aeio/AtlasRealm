# ADR-0003: React Flow for the Realm Atlas Connections graph

- **Status:** Accepted, confirmed by the M0-5 spike (2026-11-10)
- **Date:** 2026-11-06 (spike outcome added 2026-11-10)
- **Milestone(s) affected:** M0, M2, M5

## Context
The Connections tab shows typed relationship graphs with focus views and grouping (spec §30).

## Decision
React Flow owns relationship diagrams. It shares entity IDs and selection with PixiJS via committed events. There are no separate authoritative models per view.

## Consequences
- The M0-5 spike must prove selection sharing works. If performance at 150 nodes / 300 edges fails, revisit.

## M0-5 spike outcome (2026-11-10, #8): confirmed
- **Package:** `@xyflow/react` 12.12.1 (MIT), exact pin. It needs its CSS file, which Vite bundles into our stylesheet. It injects no runtime `<style>` tags, so the production CSP is unchanged and the E2E tests saw no violations.
- **Selection sharing works both ways** through one store (`src/renderer/state/`, built on `useSyncExternalStore`, no extra dependency). React Flow's selection is controlled: the store decides `selected`, and React Flow's "select" changes are forwarded to the store. E2E tests (built app) check graph click → Pixi highlight (by pixels), world click → graph node, keyboard paths, and a world remount.
- **Performance at 150 nodes / 300 edges** (local Windows 11, built app, 6 runs):
  - Loading the full graph: 84–184 ms.
  - Graph click → world shows the same ID: 67–100 ms.
  - Wheel-zoom frames: p50 6.9 ms (display refresh), p95 7–14 ms, worst 14–35 ms.
  - The spike didn't need `onlyRenderVisibleElements` or any other optimisation. These are rough spike numbers, not a benchmark.
- **Readability, not speed, is the limit.** At "fit to view", 150 nodes in a 320 px panel are too small to read. This supports §30.6's grouping/expansion controls and the "Expand" panel action, rather than drawing everything at once.
- **Follow-ups for M2/M5:**
  - Profile selection latency before raising the 150/300 limits.
  - Edge labels are hidden above 30 links (the list view shows them).
  - React Flow's attribution link points to an external site, and the shell blocks the navigation. Decide how to credit it.

## Learning note
A "spike" is a small throwaway experiment that answers a risky question before you commit to a choice.
