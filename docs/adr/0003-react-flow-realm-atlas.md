# ADR-0003: React Flow for the Realm Atlas Connections graph

- **Status:** Accepted, pending an M0-5 spike to confirm layout/performance
- **Date:** 2026-11-06
- **Milestone(s) affected:** M0, M2, M5

## Context
The Connections tab shows typed relationship graphs with focus views and grouping (spec §30).

## Decision
React Flow owns relationship diagrams. It shares entity IDs and selection with PixiJS via committed events. There are no separate authoritative models per view.

## Consequences
- The M0-5 spike must prove selection sharing works. If performance at 150 nodes / 300 edges fails, revisit.

## Learning note
A "spike" is a small throwaway experiment that answers a risky question before you commit to a choice.
