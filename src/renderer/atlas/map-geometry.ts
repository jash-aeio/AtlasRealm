// What the Realm Atlas Map draws (M2-12 #77, GRAPH_MODEL §30.1): the world's diamond, one shape
// per saved building and the camera viewport, all in world pixels.
//
// The Map is derived only from saved placements (`placement.list`) and the world's size, never
// from the Pixi scene, so it can't show a building that isn't saved. The SVG uses world pixels
// as its own coordinates (its `viewBox`), so nothing here scales to the panel: the browser fits
// the drawing to whatever size the panel has.
//
// Pure functions with no DOM or React imports, so they're unit-tested in plain Node.
import type { PlacementSummary } from '../../common/contracts/placement';
import { footprintRect, type TileRect } from '../../common/world/placement-rules';
import {
  DEFAULT_TILE,
  gridToWorld,
  type MapSize,
  type Point,
  type TileSize,
} from '../world/projection';
import type { WorldRect } from '../world/world-camera';

/** One building on the Map. */
export interface MapBuilding {
  readonly placementId: string;
  /** The project it stands for, or null for a service structure. */
  readonly projectId: string | null;
  readonly name: string | null;
  readonly archived: boolean;
  readonly rect: TileRect;
  /** The footprint's four corners (top, right, bottom, left), in world pixels. */
  readonly corners: readonly [Point, Point, Point, Point];
  /** The middle of the footprint on the ground, where "Go to" points the camera. */
  readonly centre: Point;
}

/** The four corners of a tile rectangle's diamond: top, right, bottom, left. */
export function rectCorners(
  rect: TileRect,
  tile: TileSize = DEFAULT_TILE,
): readonly [Point, Point, Point, Point] {
  return [
    gridToWorld({ gx: rect.x, gy: rect.y }, tile),
    gridToWorld({ gx: rect.x + rect.columns, gy: rect.y }, tile),
    gridToWorld({ gx: rect.x + rect.columns, gy: rect.y + rect.rows }, tile),
    gridToWorld({ gx: rect.x, gy: rect.y + rect.rows }, tile),
  ];
}

/** The whole map's diamond. */
export function mapCorners(map: MapSize, tile: TileSize = DEFAULT_TILE) {
  return rectCorners({ x: 0, y: 0, columns: map.columns, rows: map.rows }, tile);
}

/** The middle of a tile rectangle on the ground, in world pixels. */
export function rectCentre(rect: TileRect, tile: TileSize = DEFAULT_TILE): Point {
  return gridToWorld({ gx: rect.x + rect.columns / 2, gy: rect.y + rect.rows / 2 }, tile);
}

/** SVG `points` text for a polygon. */
export function polygonPoints(corners: readonly Point[]): string {
  return corners.map((p) => `${String(p.x)},${String(p.y)}`).join(' ');
}

/**
 * The SVG `viewBox` for a map: its bounding box plus a margin of `padding` (a fraction of the
 * map's width), so the edge strokes and the pin marker aren't cut off.
 */
export function mapViewBox(map: MapSize, padding = 0.04, tile: TileSize = DEFAULT_TILE): string {
  const [top, right, bottom, left] = mapCorners(map, tile);
  const width = right.x - left.x;
  const height = bottom.y - top.y;
  const pad = width * padding;
  return [left.x - pad, top.y - pad, width + 2 * pad, height + 2 * pad].map(String).join(' ');
}

/** The Map's buildings, from the saved placements. */
export function mapBuildings(
  placements: readonly PlacementSummary[],
  tile: TileSize = DEFAULT_TILE,
): MapBuilding[] {
  return placements.map((placement) => {
    const rect = footprintRect(placement, placement.footprint);
    return {
      placementId: placement.id,
      projectId: placement.target.type === 'project' ? placement.target.id : null,
      name: placement.projectName,
      archived: placement.projectStatus === 'archived',
      rect,
      corners: rectCorners(rect, tile),
      centre: rectCentre(rect, tile),
    };
  });
}

/**
 * The viewport clipped to the map's bounding box, or null when the camera shows none of the map.
 * Clipping keeps the rectangle inside the drawing when the user has zoomed far out.
 */
export function clippedViewport(
  viewport: WorldRect,
  map: MapSize,
  tile: TileSize = DEFAULT_TILE,
): WorldRect | null {
  const [top, right, bottom, left] = mapCorners(map, tile);
  const clipped = {
    left: Math.max(viewport.left, left.x),
    top: Math.max(viewport.top, top.y),
    right: Math.min(viewport.right, right.x),
    bottom: Math.min(viewport.bottom, bottom.y),
  };
  return clipped.left < clipped.right && clipped.top < clipped.bottom ? clipped : null;
}
