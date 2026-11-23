# 2026-11-23: Realm Atlas shell and Map tab (#77, M2-12)

## Task
Turn the M0 Atlas spike into the real upper-right Realm Atlas panel, with a Map tab that shows
the world's geography from saved placements (GRAPH_MODEL §30.1, UI_SPEC §6.1, §6.6).
Branch `feat/77-atlas-shell-map` (main @ fb786ed).

## Decisions so far
- **Display preferences live in the profile preferences JSON** (user choice). A new `atlasViews`
  key next to `comfort`, keyed by world ID and capped at 32 worlds so the 16 KiB limit holds. No
  revision; the last write wins, as with ADR-0028. The DATA_MODEL `graph_view_states` table waits
  until graph layout coordinates need saving (§30.7). To be recorded as ADR-0031.
- **The narrow-window drawer docks beside the world** (user choice) instead of overlaying it.
  The world gets narrower, so the drawer can never cover editing controls.
- Routine (spec defaults, not asked): the Connections tab stays a labelled "not built yet"
  placeholder until M2-13 (#78). Follow-selection is off by default and never moves the camera
  while the placement tool is open (§30.1 "do not force a camera jump while a user is editing").
  The Atlas context is the pinned project if there is one, else the selection.

## Plan
See the plan in the conversation (slices 1–5). Filled in as slices land.

## What was done
_In progress._

## Open questions
_None yet._
