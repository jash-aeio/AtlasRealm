# ADR-0013: Art technical contract: tile size, footprints, ground pivot, palette and asset manifest

- **Status:** Accepted
- **Date:** 2026-11-10
- **Milestone(s) affected:** M0-8 (placeholders), M1 (buildings and placement), M5 (first PixelLab batch), M7 (offline asset verification)
- **Decided by:** the user (asked via AskUserQuestion on 2026-11-10)

## Context
ART_BIBLE §34.3 lists *proposed* values (tile size, footprints, anchors, palette) and says to validate them before any bulk generation. Every sprite, the world's placement maths and later PixelLab requests depend on them, and changing them after art exists means redrawing. M0-8 (#11) asked for these values to be confirmed and for an asset manifest with a documented schema (§34.5). ADR-0006 already decided that PixelLab is a development-time tool, so placeholders must work without an account.

## Options considered
| Question | Options | Chosen |
|---|---|---|
| Tile and footprints | 64×32 with 2×2/3×3/4×4 · 64×32 with 2×2 only for now · 32×16 with 2×2/3×3/4×4 | **64×32; 2×2, 3×3, 4×4** (matches the spec and the existing world grid; 32×16 would change the grid and fit PixelLab's isometric output worse) |
| Ground pivot | South corner of the footprint · footprint centre · bottom-centre of the image | **South corner** (tall sprites grow upward; the same point serves depth sorting; it doesn't break when padding is cropped, unlike bottom-centre of the image) |
| Palette direction | Warm storybook village · muted earthy · bright high-saturation | **Warm storybook village** (follows §34.1; keeps contrast for status colours) |
| Manifest schema form | A Zod schema in code (chosen as the project's validation standard) · a separate JSON Schema file | **Zod** in `src/common/assets/asset-manifest.ts`, documented in ART_BIBLE §34.3.1 |

## Decision
- Ground tile **64 × 32** logical pixels, 2:1 diamond, fixed camera.
- Building footprints **2×2, 3×3, 4×4** tiles. Markers and terrain tiles are 1×1.
- **Ground pivot = south corner of the footprint diamond**, stored per asset in image pixels from the top-left. A sprite is drawn with its pivot on grid point `(gx + columns, gy + rows)`.
- A bounded **16-swatch palette** ("warm storybook village"), listed in ART_BIBLE §34.3.1.
- `resources/assets/asset-manifest.json` (schema version 1): ID, version, kind, confined relative `.png` path, size, pivot, footprint, optional animation strip, SHA-256, placeholder flag and provenance reference. The footprint must fit inside the frame when hung from the pivot.
- Engineering placeholders are drawn by `scripts/generate-placeholder-art.ts` (reproducible bytes, no new dependency) and flagged `placeholder: true`.

## Consequences
- The world can place any sprite from manifest numbers alone. Tests check every manifest entry against its file (size, digest, pivot rule).
- PixelLab output must be cropped or padded so its ground contact lands on the documented pivot. §34.3 already warns that a generator's square canvas isn't the diamond footprint.
- 3×3 and 4×4 have no placeholder yet. M1 adds them when buildings get placed.
- Signals to revisit: real art looks wrong at 64×32 in a test scene (§34.7); depth sorting needs a different reference point; the palette can't meet contrast needs for status symbols.

## Learning note
A "technical contract" for art is like an API for pictures: once code and artists agree on sizes and anchor points, either side can change its work without breaking the other. Writing the numbers into a validated manifest makes the agreement checkable by tests instead of by eye.
