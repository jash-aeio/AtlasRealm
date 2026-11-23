# 2026-11-23: Realm Atlas shell and Map tab (#77, M2-12)

## Task
Turn the M0 Atlas spike into the real upper-right Realm Atlas panel, with a Map tab that shows
the world's geography from saved placements (GRAPH_MODEL §30.1, UI_SPEC §6.1, §6.6).
Branch `feat/77-atlas-shell-map` (main @ fb786ed).

## Decisions so far
- **Display preferences live in the profile preferences JSON** (user choice). A new `atlasViews`
  key next to `comfort`, keyed by world ID and capped at 32 worlds so the 16 KiB limit holds. No
  revision; the last write wins, as with ADR-0028. The DATA_MODEL `graph_view_states` table waits
  until graph layout coordinates need saving (§30.7). Recorded as [ADR-0031](../adr/0031-atlas-view-preferences-and-docked-drawer.md).
- **The narrow-window drawer docks beside the world** (user choice) instead of overlaying it.
  The world gets narrower, so the drawer can never cover editing controls.
- Routine (spec defaults, not asked): the Connections tab stays a labelled "not built yet"
  placeholder until M2-13 (#78). Follow-selection is off by default and never moves the camera
  while the placement tool is open (§30.1 "do not force a camera jump while a user is editing").
  The Atlas context is the pinned project if there is one, else the selection.

## Plan
Five slices, one commit each: preferences contract + main; camera bridge; spike move; the real
panel with the Map tab, store and docked drawer; E2E.

## What was done
- `be66fd8` **Atlas view preferences.** `src/common/preferences/atlas-view.ts` (schema, forgiving
  parse, LRU cap 32) and `profile.atlasView.get/update` through contract, router, preload and
  `ProfileService`. Tests: `atlas-view-preferences` (12), `profile-contract` (+6), shell API shape.
- `c0e5053` **Camera bridge.** `src/renderer/world/world-camera.ts`: the world view reports its
  camera and canvas size, and `centerOn` moves the camera only when the Atlas asks for the user.
  `useWorldScene` gained `onViewport` and `centerOn`. Tests: `world-camera` (6).
- `5230200` **Spike moved.** The M0 mock-data panel is now `SpikeAtlasPanel.tsx`, shown only
  under Developer spikes.
- `6b109bf` **Realm Atlas panel.** `RealmAtlasPanel.tsx` (Map/Connections tabs, Collapse,
  Expand, pin with indicator, resize handle), `MapTab.tsx` (SVG whose `viewBox` is world pixels,
  plus a keyboard list), `map-geometry.ts`, `atlas-views.ts` (store with debounced width saves).
  The side column width comes from `--side-width`; the narrow drawer docks as a grid column.
  Tests: `atlas-map` (14).
- `179adfc` **E2E.** `tests/e2e/realm-atlas.spec.ts` (7 tests, 21/21 over `--repeat-each=3`).
  Negative control: with the old `position: fixed` drawer, the overlap test fails.
- A screenshot check showed 2×2 buildings were specks on a 64×64 Map. They now have a thick
  stroke in their own colour, which also enlarges the click target.

Evidence (local Windows 11): typecheck, lint, format:check pass; unit/integration 1110/1110;
full E2E 94/94.

## Reviews
- invariant-reviewer: no violations.
- security-auditor: approved, no Critical/High/Medium. L1 (size test used a smaller camera centre than allowed) fixed. L2 (unknown top-level preference keys share the 16 KiB budget) and L3 (world IDs not checked against the worlds table) recorded in [ADR-0031](../adr/0031-atlas-view-preferences-and-docked-drawer.md).

## What you wrote yourself
Nothing: Claude wrote all the code. You made the two decisions above.

## Open questions
- The narrow drawer docks, so in very narrow windows the world gets small while it is open
  (the trade-off you accepted). A min world width could come with the M8 UI pass.
- "Follow selection" only acts on a new selection; switching it on doesn't move the camera.
