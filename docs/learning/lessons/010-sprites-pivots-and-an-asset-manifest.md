# Lesson 010: Sprites, pivots and an asset manifest
**Milestone:** M0 · **Date:** 2026-11-10 · **Related:** `resources/assets/asset-manifest.json`, `src/common/assets/asset-manifest.ts`, `src/renderer/world/grid-scene.ts`, ADR-0012, ART_BIBLE §34.3.1

## The concept (plain words)
A **sprite** is a picture drawn at a position. To put it in the right spot, code must know which point of the image touches the ground: the **pivot**. A **footprint** says how many grid tiles the sprite covers. An **asset manifest** is one list of every image with these numbers, so code never guesses.

Think of it as an API for pictures. Artists (or PixelLab) promise "the south corner of the footprint is at this pixel", and the world code promises to put that pixel on the grid.

## Why Atlas Realm needs it
Buildings will come from different sources: placeholders now, generated art later. Without a contract, every new image would need hand-tuned offsets. With one, a 2×2 building from any source lands correctly. Tests can also check the numbers, which eyes can't do reliably.

## Where it lives in our code
- `asset-manifest.json` holds entries like `{ "id": "placeholder.marker.selection", "width": 64, "height": 32, "pivot": { "x": 32, "y": 32 }, "footprint": { "columns": 1, "rows": 1 }, "sha256": "…" }`.
- `asset-manifest.ts` (Zod) refuses unsafe paths and pivots that would hang the footprint outside the image.
- `grid-scene.ts` turns the pivot into Pixi's anchor:
  ```ts
  sprite.anchor.set(art.pivot.x / art.width, art.pivot.y / art.height);
  sprite.position = gridToWorld({ gx: gx + columns, gy: gy + rows }); // south corner
  ```
- The image is loaded with a plain `<img>` and `decode()`. Pixi's `Assets` loader would use `blob:` workers and `fetch`. Our CSP blocks the first, and the renderer can't `fetch` `app://` URLs at all.

## Common mistakes
- **Using the image's bottom-centre as the pivot.** It breaks as soon as the image has padding.
- **Letting the bundler inline small images as `data:` URIs.** Then the shipped files no longer match the manifest (we set `assetsInlineLimit: 0`).
- **Generating art with `Math.random()`.** The bytes change every run, so digests can't be checked. Our generator uses a fixed hash instead.
- **Assuming "the error was caught" means "no CSP report".** Zod's caught `new Function` probe still fired a violation, so the renderer sets Zod `jitless`.

## Try it (5–15 min exercise)
1. In `scripts/generate-placeholder-art.ts`, change the selection marker's pivot to `{ x: 32, y: 31 }` and run `pnpm art:placeholders`.
2. Run `pnpm test`. Which test fails, and why? (Hint: the south-corner rule.)
3. Revert. Now change one palette colour, run `pnpm art:placeholders --check` before and after regenerating, and look at how the `sha256` in the manifest changed.

## Learn more
- PixiJS sprite anchors: https://pixijs.com/8.x/guides/components/scene-objects/sprite
- Vite static assets and `assetsInlineLimit`: https://vite.dev/guide/assets
- PNG format (chunks, CRC): https://www.w3.org/TR/png-3/
