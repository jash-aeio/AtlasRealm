# ADR-0002: PixiJS for the isometric world and 2.5D interiors

- **Status:** Accepted (spec §7.1, §17, §31)
- **Date:** 2026-11-06
- **Milestone(s) affected:** M0 (spike), M2, M5

## Context
We need a 2D/2.5D renderer for terrain, buildings, sprites and cutaway interiors, embedded inside the React app.

## Decision
PixiJS renders visual scenes only. It is **not** the source of project state or the scheduler. Full rotatable 3D is deferred.

## Consequences
- Domain state lives in the main process and SQLite; Pixi subscribes to committed events.
- Every canvas action needs an accessible list/form equivalent.

## Learning note
Keep "what is true" (data) separate from "how it looks" (rendering). Then the view can crash or be redesigned without losing work.
