# 2026-11-10: M0-8 art bible values, placeholder sprites and asset manifest (#11)

**Branch:** `feat/11-placeholder-art` (worktree `D:MyProjectsJCBAtlasRealm-m0-8`) · **Issue:** [#11](https://github.com/jash-aeio/AtlasRealm/issues/11)

## Task
Lock the art technical contract (ART_BIBLE §34.3) so engineering placeholders and later PixelLab assets match. Make geometric placeholder sprites and `resources/assets/asset-manifest.json` with a documented schema. No PixelLab account.

## Decisions (asked with AskUserQuestion; the user chose the recommended option each time)
- **Tile and footprints:** 64 × 32 logical-pixel ground tile (what the world grid already uses). Building footprints 2×2, 3×3 and 4×4. M0 only draws a 2×2 placeholder.
- **Ground pivot:** the **south corner** of the footprint diamond (the point nearest the viewer), in image pixels from the top-left. Taller sprites grow upward, and depth sorting can use the same point later.
- **Palette:** "warm storybook village": grass greens, timber browns, grey-blue stone, lantern gold, parchment cream, and one arcane-blue accent (the existing selection blue).
- **Scope:** files, manifest, Zod schema and tests, **plus** one texture in the world. The selection highlight is drawn from its PNG, and an E2E test proves textures load under the production CSP. This goes outside the issue's "files owned" (`src/renderer/world`, `src/common`, `scripts`, tests) with the user's approval.
- Branch type is `feat` (not `docs` like the label) because the work adds code and assets.
- Recorded as [ADR-0012](../adr/0012-art-technical-contract.md).
- **Shared checkout (process):** the M0-6 session (#9) was editing the same folder, and its files ended up on my branch. The user chose to move this lane into its own git worktree on a fresh branch `feat/11-placeholder-art`. Only my files moved; the empty `feat/11-art-placeholders` was deleted after the M0-6 session switched to `spike/9-worker-messaging`. Lesson: parallel lanes need their own worktree from the start (MULTI_AGENT_GUIDE).

## Plan
1. **Contract + generator.** `src/common/assets/asset-manifest.ts`: Zod schema (schema version, tile size, assets with ID/version/kind/path/size/pivot/footprint/optional animation/sha256/placeholder flag/provenance). Paths must be relative, forward-slash, `.png`, with no `..`. `scripts/generate-placeholder-art.ts` draws the sprites with plain code and writes PNGs with `node:zlib` (no new dependency), so the output is reproducible and the digests are stable. Sprites go in `resources/assets/placeholders/`: ground tile 64×32, 2×2 building 128×128, selection marker and invalid marker 64×32.
2. **Tests.** The manifest parses. Every file exists, and its PNG header size and sha256 match. Pivots sit on the footprint's south corner. The generator reproduces the committed bytes. The schema rejects bad paths, pivots and footprints.
3. **World uses a texture.** A renderer catalog (`world-assets.ts`) maps manifest IDs to Vite-built URLs (`import.meta.glob`, inlining off so art ships as real files). `grid-scene.ts` loads the selection PNG through a plain `<img>` element instead of Pixi's `Assets` loader. `Assets` defaults to `fetch` + `crossOrigin` + `blob:` workers, and those don't fit our CSP or the `app://` scheme. It uses nearest-neighbour sampling and positions the sprite from the manifest pivot. The drawn selection diamond is removed. Ground, grid, marker and hover colours come from the palette.
4. **E2E.** The existing selection-pixel tests now pass only if the PNG really loaded and drew. Add a check for no CSP violations or failed image loads. The packaged smoke test checks the PNG comes from `app://atlas`.
5. **Docs.** ART_BIBLE: an approved-values section, palette swatches, the manifest schema doc. ASSET_PROVENANCE rows for the placeholders. Glossary terms (pivot, footprint, sprite, nearest-neighbour, digest).

## What was done
- `src/common/assets/asset-manifest.ts`: the Zod schema plus `footprintProblems` and `requireAsset`.
- `scripts/generate-placeholder-art.ts` (`pnpm art:placeholders [--check]`) writes four PNGs and their manifest entries. It uses a hand-written PNG encoder (`node:zlib` deflate + CRC32) and no new dependency.
- World: `world-assets.ts` (manifest → built URLs through `import.meta.glob`). `grid-scene.ts` loads the selection PNG with an `<img>`, uses nearest-neighbour sampling and places it by its pivot. Palette colours. `assetsInlineLimit: 0`.
- **Found:** Zod 4 probes `new Function` the first time it parses an object. Even caught, Chromium reports a `script-src eval` CSP violation. The renderer now sets `z.config({ jitless: true })` first thing (`src/renderer/app/zod-config.ts`). The main process keeps the default.
- **Found:** the packaged app records **no** resource-timing entries for `app://` loads (not even scripts and CSS). The M0-7 test "every resource is from app://atlas" therefore loops over an empty list. Its script and stylesheet checks (from the DOM) are still real. The new packaged art test decodes the PNG by name instead.
- Docs: ART_BIBLE §34.3.1 (values, palette, manifest fields), ASSET_PROVENANCE rows, 8 glossary terms, ADR-0012.

## Verification (local Windows 11)
- typecheck, lint, format:check pass. Unit/integration 168/168 (30 new in `tests/domain/asset-manifest.test.ts`). E2E 30/30 (1 new). Packaged E2E 8/8 (1 new). `pnpm art:placeholders --check` is clean.
- Mutation checks, each of which made a test fail: sprite hidden (`alpha = 0`) → 2 atlas selection-pixel tests fail. Inlining back on (4096) → the new world art test fails.
- Sprites checked by eye. Not checked: `pnpm dev` by hand.

## Reviews
- security-auditor: approve. Fixed: Windows device names (`nul`, `aux`, `com1`…) are refused in paths, and size bounds were added (path 200, provenance 500, 2000 entries, 4096 px, 256 frames, footprint 16). Not acted on: removing `data:` from CSP `img-src` (the user's call).
- invariant-reviewer: no violations.
- Lesson 010 written (sprites, pivots, asset manifest).

## Open questions
- Remove `data:` from the CSP `img-src`? It seems unused now. It's a security decision, so ask the user.
- The app icon (still Electron's default) isn't in the acceptance criteria. Left for a follow-up.
- The vacuous `resources` loop in the packaged "works offline" test: fix it, or find out why there is no resource timing for `app://` in the packaged build (it works in the unpackaged E2E build).
- 3×3 and 4×4 placeholders, and drawing buildings and ground tiles from art, belong to M1 placement work.
