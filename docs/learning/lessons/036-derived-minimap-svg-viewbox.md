# Lesson 036: A minimap derived from saved data (SVG viewBox, viewports and layout guarantees)
**Milestone:** M2 · **Date:** 2026-11-23 · **Related:** `src/renderer/atlas/{MapTab.tsx,map-geometry.ts}`, `src/renderer/world/world-camera.ts`, `tests/e2e/realm-atlas.spec.ts`, GRAPH_MODEL §30.1, ADR-0031

## The concept (plain words)
A **minimap** is a small overview of a big map. It answers "where is this?" and "where am I looking?". Three ideas make ours simple and trustworthy:

1. **Derived, not copied.** The Map draws only what `placement.list` returned and the world's size. It never asks the Pixi scene what it drew. If a building isn't saved, it can't appear on the Map, and the two views can't drift apart.
2. **SVG `viewBox` = world pixels.** An SVG's `viewBox="x y width height"` says which part of its own coordinate space to show. We set it to the world's bounding box in world pixels, the same units the isometric projection already uses. The browser then scales the drawing to fit the panel, so the Map needs no zoom math of its own, and Expand (a taller panel) just works.
3. **Viewport = the camera run backwards.** The camera maps world to screen as `screen = world × zoom + pan`. Running that backwards on the canvas corners (`screenToWorld`) gives the rectangle of the world you can see. We draw it as a dashed box.

## Why Atlas Realm needs it
§30.1 asks for a Map that shows buildings, the selection and the camera viewport, and says the camera must never jump unasked. Keeping the Map derived from saved data follows the product rule "show real status". Keeping camera moves behind an explicit request (`centerOn`, used by "Go to" and the follow toggle you switch on) follows the "no camera jump while editing" rule.

## Where it lives in our code
```ts
// map-geometry.ts: a building's footprint diamond, straight from the saved placement
const rect = footprintRect(placement, placement.footprint);   // rotation included
corners: rectCorners(rect)                                      // gridToWorld on 4 corners
// world-camera.ts: what the world view shows, in world pixels
const topLeft = screenToWorld({ x: 0, y: 0 }, camera);
const bottomRight = screenToWorld({ x: width, y: height }, camera);
```
```tsx
// MapTab.tsx
<svg viewBox={mapViewBox(map)} preserveAspectRatio="xMidYMid meet">
  <polygon points={polygonPoints(building.corners)} onClick={() => onSelect(id)} />
```
CSS `vector-effect: non-scaling-stroke` keeps outlines one screen pixel wide even though the drawing is scaled down about 20×. A thick stroke in the building's own colour also makes a tiny building big enough to click, because strokes count as part of the click target.

The narrow drawer uses a **layout guarantee**: it is a grid column next to the world, not an overlay, so it *cannot* cover the world's controls. The E2E test checks this with bounding boxes, and a negative control (putting the old `position: fixed` back) makes the test fail.

## Common mistakes
- Reading positions out of the renderer (Pixi) to draw the minimap. Then the minimap shows what was drawn, not what's saved, and it breaks when the world view is hidden.
- Doing the scaling by hand instead of with `viewBox`, and then redoing it for every panel size.
- Forgetting `non-scaling-stroke`: outlines become invisible (scaled to 0.05 px) or huge.
- Making the SVG shapes the only way to select. They aren't keyboard-focusable; the Map has a list of buildings as its keyboard equivalent (UI_SPEC §6.6).

## Try it (5–15 min exercise)
In `map-geometry.ts`, `mapViewBox` adds a 4% margin. Write a test in `tests/domain/atlas-map.test.ts` for a 16 × 32 map with no margin (work out the corners with `gridToWorld` first), then change the margin to 0 in `MapTab.tsx` and look at the Map: the edge strokes get cut off. Put it back.

## Learn more
- MDN, `viewBox`: https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/viewBox
- MDN, `vector-effect`: https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/vector-effect
- WAI-ARIA window splitter (the resize handle): https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/
