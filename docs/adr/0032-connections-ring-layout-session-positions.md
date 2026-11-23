# ADR-0032: Connections graph uses a built-in ring layout and session-only node positions

- **Status:** Accepted
- **Date:** 2026-11-23
- **Milestone(s) affected:** M2 (M2-13 #78); later graph work (project interior, Knowledge/Files presets)
- **Decided by:** the user (asked via AskUserQuestion on 2026-11-23)

## Context
The Realm Atlas Connections tab (GRAPH_MODEL §30.1, §30.6) draws up to 150 projects and 300 links
from `graph.worldConnections`. React Flow (ADR-0003, ADR-0030) draws nodes where we tell it but
does not lay them out, so we need positions. §30.6 asks for "stable layouts", no continuous movement
while the user reads, and to "preserve manual positions". §30.5 and UI_SPEC §6.4 say graph
coordinates are cosmetic and never move files or buildings. ADR-0031 left the `graph_view_states`
table (DATA_MODEL §9.3) for when layout coordinates need saving.

Two questions: how to place nodes, and whether nodes the user drags keep their spots across a
restart.

## Options considered
**Layout**

| Option | Pros | Cons |
|---|---|---|
| A. Built-in deterministic ring (chosen) | No new dependency; same input → same picture; never moves while reading; placed projects on an outer ring and unplaced ones inside, so "has no building" shows in the shape too | Crowded near 150 nodes; ignores link structure |
| B. Layout library (d3-force, dagre, elkjs) | Nicer pictures for large or directed graphs | New dependency, license check and ADR; force layouts move continuously, which §30.6 warns against |

**Dragged positions**

| Option | Pros | Cons |
|---|---|---|
| A. Session only (chosen) | No schema change; a "Reset layout" button restores the ring | Positions are lost on reload; §30.6 "preserve manual positions" is only met within a session |
| B. Save per world in `graph_view_states` now | Matches §30.6 fully | Migration v7, repository, revisioned IPC command and tests: about a day more for cosmetic data |

## Decision
We chose a **built-in ring layout** (`src/renderer/atlas/connections-layout.ts`) and **session-only
dragged positions** (held in `ConnectionsTab` state), because both keep M2 small and reversible
while meeting the readability rules. The ring keeps the server's stable order (never names), turns
the inner ring half a step so inner nodes sit between outer ones and clear of links across the
ring, and keeps them at least about one node width from the centre.

Spec change: §30.6 "preserve manual positions" is, for now, met within a session only. A note was
added in GRAPH_MODEL §30.6.

## Consequences
- Dragging a node never calls the main process, so it cannot touch placements (E2E proves the
  placements are identical before and after a drag).
- Reduced motion only affects the fit-to-view zoom animation, because the layout itself never
  animates.
- Follow-up: when saved positions or collapsed groups are needed, add `graph_view_states`
  (migration, repository, `graph.viewState.*` commands) and seed the ring from saved positions.
- Revisit if users find the ring unreadable at 50+ projects, if they ask for positions to survive
  a restart, or when the Work/Files presets need a layered (directed) layout. A library would then
  need its own ADR.

## Learning note
A layout doesn't have to be clever to be useful: a fixed, predictable arrangement that never
jumps around is often easier to read than a "smart" one that keeps moving. And when data is
purely cosmetic, keeping it in memory first is a cheap way to learn whether it's worth a
database table at all.
