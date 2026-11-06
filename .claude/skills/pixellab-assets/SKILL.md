---
name: pixellab-assets
description: Produce a small, reviewed batch of fantasy pixel assets with the PixelLab MCP following the art bible, then package them locally with manifest and provenance. Use for /pixellab-assets, typically from M5 onward.
disable-model-invocation: true
argument-hint: "<asset family, e.g. terrain | exteriors | interior-kit | characters | status-icons>"
---

# /pixellab-assets $ARGUMENTS

Follow `docs/art/ART_BIBLE.md` §34 and ADR-0006. PixelLab is a **development-time** tool; the app must never depend on it at runtime.

## 0. Preconditions (stop if any fail and continue with placeholders instead)
- The PixelLab MCP is configured at **user scope** (`claude mcp list` shows it). Never add its token to `.mcp.json` or any committed file.
- Use AskUserQuestion to confirm the account plan/trial, quota, and **the credit budget for this batch** (cap on requests and retries).
- Terms reviewed and recorded with the date in `docs/art/ASSET_PROVENANCE.md`.
- `docs/art/ART_BIBLE.md` technical contract values confirmed (projection, tile size, pivots, palette).

## 1. Plan the batch
- One coherent family only (see §34.4 order). List the exact assets, sizes and states. Inspect the **live MCP tool schemas** before calling. Don't assume parameters.
- Show the plan and budget, and get approval.

## 2. Generate → stage
- Save outputs to `resources/assets/_staging/` (gitignored). Record request/job IDs.
- Don't blindly retry after an uncertain timeout. Don't run unbounded auto-fix loops.

## 3. Review checklist (with the user)
Dimensions, transparent edges, seams between neighboring tiles, scale vs other assets, camera angle, light direction, palette, ground pivot, footprint, animation continuity, readability in reduced motion. Rejected outputs stay out of the bundle.

## 4. Package
- Move accepted files to `resources/assets/fantasy/...`. Update `resources/assets/asset-manifest.json` (ID/version, path, dimensions, pivot, footprint, frames, digest, provenance ref).
- Add rows to `docs/art/ASSET_PROVENANCE.md`.
- Verify they render in the app with networking off. Commit on a branch and open a PR via `/ship`.
