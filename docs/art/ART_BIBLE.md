# Art Bible: Fantasy Art Direction & PixelLab Pipeline

> **Source:** Atlas Realm Build Plan rev 1.1, §34 — copied verbatim from [the archived original](../archive/Atlas_Realm_Build_Plan_v1.1.md). Section numbers are kept so cross-references like "see section 33" still work. Edit this file (not the archive) when the spec changes, and record why in an ADR.

## 34. Fantasy art direction and PixelLab asset pipeline

### 34.1 Approved art direction

Atlas Realm has a welcoming fantasy RPG identity: timber-and-stone villages, enchanted workshops, warm lanterns, parchment accents, readable stone/wood silhouettes, and restrained magical effects. Buildings express project identity while agents resemble guild members and artisans. This is an art direction, not a requirement to add combat, an economy, or progression gates.

Use plain functional labels alongside fantasy names. Maintain accessible typography and contrast in editors/forms. Graph diagrams can use parchment or arcane-blue accents while preserving clear edges, labels, and evidence states. Blueprint mode uses a simplified high-contrast structural treatment rather than decorative visual noise.

### 34.2 PixelLab is the preferred production route

The user prefers PixelLab MCP for generating the world's assets with Claude. Treat this as a **development-time production tool** first: the builder generates, downloads, reviews, edits, and commits selected assets. The shipped application displays those local files without contacting PixelLab.

PixelLab documents a remote MCP service, account-token authorization, and tools for characters, animation, terrain, and isometric assets. Obtain the current client-specific setup from the official page rather than inventing an npm package or exposing a token in the plan. [PixelLab MCP documentation](https://www.pixellab.ai/docs/ways-to-use-pixellab), [official MCP setup](https://www.pixellab.ai/mcp).

**Access/cost check, November 6, 2026:** the official usage documentation lists an active subscription for MCP access, while the homepage advertises trying the service for free. These do not establish unlimited free generation. Check the actual account's trial/plan, permitted tools, quota, and costs before a batch. Keep a placeholder/local-asset route so account access cannot block the build. [PixelLab homepage](https://www.pixellab.ai/).

Do not install/connect PixelLab or generate assets solely because this plan includes it. The coding session performing production must have the user's configured account and a concrete approved asset batch/budget. Never commit generated client configuration containing a secret token.

### 34.3 Art bible and technical contract

Before bulk generation, create `docs/ART_BIBLE.md` and one approved reference sheet. Suggested starting values are project choices to validate, not claims about every PixelLab endpoint:

| Property | Proposed convention |
|---|---|
| Projection | Consistent 2:1 diamond ground-plane appearance; fixed isometric camera |
| World ground tile | 64 × 32 logical pixels; resize/crop source output deliberately if needed |
| Building footprints | Small starter set such as 2×2, 3×3, and 4×4 tiles |
| Character source frame | Start with a common 64×64 canvas and verified in-scene scale |
| Character directions | Four initially if suitable; add eight when movement/navigation needs them |
| Animation states | Idle, working, waiting/blocked; walking only where implemented |
| Lighting | Consistent upper-left light; shared shadow convention |
| Palette | One bounded cohesive palette, documented swatches and materials |
| Exports | Transparent PNG sprites/atlases plus validated JSON metadata where needed |
| Sampling | Nearest-neighbor for pixel sprites; consistent display scaling |
| Anchors | Ground-contact pivot, collision footprint, and render bounds documented per asset |

Validate supported dimensions and controls against the live MCP tool schema. A generator's square image canvas is not necessarily the desired diamond tile's rendered footprint. Do not silently mix top-down characters with an incompatible isometric camera.

### 34.3.1 Approved technical values (M0-8, 2026-11-10)

Changed by [ADR-0013](../adr/0013-art-technical-contract.md). The user confirmed these values. They replace the "proposed convention" column above wherever the two differ.

| Property | Approved value |
|---|---|
| World ground tile | **64 × 32** logical pixels, 2:1 diamond. Diamond edges use clean "two across, one down" pixel steps |
| Building footprints | **2×2, 3×3, 4×4** tiles. Terrain tiles and markers are 1×1 |
| Ground pivot | **South corner of the footprint diamond** (nearest the viewer), in image pixels from the top-left. The sprite is drawn with its pivot on grid point `(gx + columns, gy + rows)` |
| Lighting | Upper-left. The south-west wall is lit, the south-east wall is in shade |
| Sampling | Nearest-neighbour (no blending) |
| Exports | Transparent RGBA PNG, one file per sprite or a strip of equal frames |

**Footprint geometry.** With the pivot at the south corner, a footprint of `columns × rows` reaches `columns × 32` px left (west corner), `rows × 32` px right (east corner) and `(columns + rows) × 16` px up (north corner). The schema refuses a pivot that would hang the footprint outside the frame. An unpadded 2×2 building is 128 px wide with its pivot at `(64, height)`.

**Palette: "warm storybook village"** (16 swatches; also in `scripts/generate-placeholder-art.ts`):

| Swatch | Hex | Material / use |
|---|---|---|
| grass dark | `#2F4A32` | grass edges, grid lines |
| grass | `#4F7A3F` | ground |
| grass light | `#7FA55A` | tufts, highlights |
| timber dark | `#4A3220` | beams, marker outlines |
| timber | `#7A5230` | shaded wood walls |
| timber light | `#A87A4A` | lit wood walls, entity markers |
| stone dark | `#46505E` | shaded stone |
| stone | `#7D8794` | stone walls, paths |
| stone light | `#B4BCC4` | lit stone |
| clay | `#8E3B2E` | roofs |
| lantern | `#F2C14E` | windows, lanterns, hover |
| parchment | `#EFE2BF` | scrolls, labels, Atlas accents |
| ink | `#1D1F26` | outlines, world background |
| arcane | `#6BC6F2` | selection (same as the Atlas selection outline) |
| arcane light | `#E8F6FF` | selection edge, magic glints |
| warning | `#D9483B` | invalid placement, errors. Always paired with a pattern, never colour alone |

**Asset manifest** (`resources/assets/asset-manifest.json`, schema version 1, validated by `src/common/assets/asset-manifest.ts`):

| Field | Meaning |
|---|---|
| `schemaVersion` | `1`. Bumped when old readers couldn't understand the file |
| `tile` | The ground tile size the art was made for (`64 × 32`) |
| `assets[].id` | Stable ID, lowercase words joined by `.` or `-` (e.g. `placeholder.marker.selection`). Unique |
| `version` | Raised whenever the image changes |
| `kind` | `terrain`, `building` or `marker` (more kinds come with characters, status icons and interiors) |
| `path` | Relative to `resources/assets`: lowercase, forward slashes, `.png`, no `..`, drive letters or backslashes. Unique |
| `width`, `height` | Image size in pixels; must match the PNG header |
| `pivot` | Ground pivot `{x, y}` (see above). Per frame for animations |
| `footprint` | `{columns, rows}` tiles covered on the ground |
| `animation` | Optional: `frameWidth`, `frameHeight`, `frameCount`, `frameDurationMs`; frames left to right, top to bottom |
| `sha256` | Lowercase hex digest of the file; tests compare it with the real bytes |
| `placeholder` | `true` for engineering placeholders, which must be labelled as such |
| `provenance` | Where source and terms are recorded (`docs/art/ASSET_PROVENANCE.md`) |

**Placeholders (M0-8).** `pnpm art:placeholders` draws the ground tile, a 2×2 building, and the selection and invalid markers into `resources/assets/placeholders/`, and updates their manifest entries. Other entries are left alone. `--check` reports stale files. The world currently draws only the selection marker from its PNG. The ground, entity markers and hover outline are still drawn shapes in palette colours.

### 34.4 Minimal production batch

Prioritize a coherent useful slice rather than hundreds of decorative variants:

1. Terrain: grass, path/stone, water/edge transitions, selection and invalid-placement indicators.
2. Exteriors: three project-building silhouettes plus Guild, Library, and Tool Shop appearances.
3. Interior: one cutaway floor/wall kit and six functional station sprites.
4. Characters: one user avatar and three role variants sharing proportions and palette.
5. Status: working, blocked, approval-needed, and completed symbols readable without animation.
6. Atmosphere: a small optional set of trees, fences, lanterns, and banners.

Use the PixelLab tool appropriate to each asset family and verify its actual schema. The official MCP repository gives examples for character creation, animation, tilesets, and isometric tiles; examples are starting points, not a stable API contract. [PixelLab official MCP repository](https://github.com/pixellab-code/pixellab-mcp).

### 34.5 Production workflow

```text
Art bible and original/authorized reference sheet
  → Small approved generation request
  → Track returned request/job identifiers when available
  → Download outputs into a review/staging directory
  → Check dimensions, alpha, seams, scale, camera, pivots, and animation
  → Clean up/recolor in a pixel editor if necessary
  → Pack atlas and metadata
  → Record provenance and terms reference
  → Commit reviewed production files
  → Verify in the packaged offline build
```

Persist generation receipts where supported; do not blindly repeat a request after an uncertain timeout or spend more credits on an unbounded auto-fix loop. Keep rejected outputs out of the shipped bundle. Batch generation and retries have a visible request/credit cap.

Maintain `resources/assets/asset-manifest.json` with ID/version, local path, dimensions, ground pivot, footprint, animation frame metadata, digest, and provenance reference. Record source service/job, prompt/reference provenance where appropriate, generation date, modifications, terms checked, and any attribution in `docs/ASSET_PROVENANCE.md`. Credentials and private reference data are excluded.

Manual cleanup is expected when needed. Aseprite provides sprite-sheet import/export workflows suitable for preparing consistent local assets. [Aseprite sprite sheets](https://www.aseprite.org/docs/sprite-sheet/).

### 34.6 Terms and optional future runtime integration

Review the actual generation/output terms before distribution and confirm rights to reference artwork. PixelLab's current terms distinguish ordinary production/API use from building a service or reselling its capabilities; an in-app generative Asset Studio therefore needs its own service-use assessment. Generated output production and embedding a third-party generation business are different decisions. [PixelLab service terms](https://www.pixellab.ai/termsofservice).

Do not state that generated work has unrestricted legal protection or that a repository's accessibility licenses the service implementation. Store the relevant terms/date and honor restrictions, including model-training restrictions where applicable.

If an in-app Asset Studio is added after the MVP, use each user's supported account, brokered online requests, a preview/budget, constrained downloaded files, and an explicit Enable switch. It remains optional and cannot become a startup dependency. It does not grant arbitrary MCP or filesystem execution.

### 34.7 Alternative sources and consistency rules

| Source | Appropriate fallback/reference | Caveat |
|---|---|---|
| [Kenney Isometric Buildings](https://kenney.nl/assets/isometric-tiles-buildings) | CC0 prototype buildings and isometric layout references | Evaluate visual fit; do not assume every Kenney pack matches the final fantasy pixel style |
| [BoostyBear ISO Fantasy](https://boostybear.itch.io/iso-fantasy) | Licensed fantasy terrain/character pack | Review included terms; its page restricts raw sharing and AI training, so do not assume it is an authorized generator reference |
| [Gustavo Vituri Isometric TRPG](https://gvituri.itch.io/isometric-trpg) | Low-resolution fantasy prototype/reference | Check current license and pixel scale before mixing with other assets |
| [Recraft game assets](https://www.recraft.ai/generate/game-assets) | Optional concept/variant generation if desired | Separate service/account/terms; not required by the chosen PixelLab path |
| Original commissioned/manual art | Distinctive production assets and difficult consistency fixes | Record ownership, deliverables, and allowed distribution |

Do not mix packs solely because each looks attractive separately. Check perspective, material palette, pixel density, shadows, outline weight, and character/building scale together in one test scene. Never upload third-party raw art to a generator or use it as training/reference material without appropriate rights.

### 34.8 Asset acceptance and offline packaging

The minimum scene should render without internet, PixelLab credentials, or an account check. Test neighboring terrain seams, transparent edges, building collision versus appearance, pivot consistency, direction alignment, animation frame continuity, and reduced-motion status readability. Prove that a packaged build includes every referenced image/atlas and does not fetch missing core art at launch.

Fantasy upgrades remain cosmetic: a completed milestone may change a banner or building appearance, but completing projects never depends on grinding resources or buying stronger-looking agents.
