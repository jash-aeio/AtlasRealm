// Where the world draws each saved building, in which order, and what is under the pointer
// (M2-6 #71, UI_SPEC §17.2).
//
// Pure functions with no DOM, Pixi or manifest imports: the caller passes in the art sizes, so
// the depth sort, culling and hit tests run in plain Node tests and the scene can't drift from
// them. Everything here is cosmetic: it never moves a building or changes a project.
//
// Depth (the order sprites are drawn, back to front): buildings are sorted by the centre of
// their footprint on the ground, `x + y + (columns + rows) / 2`. A larger sum is nearer the
// viewer. For square footprints (every ADR-0013 size) this is exact: two buildings whose sprites
// can overlap on screen never get the same key, and the nearer one always gets the larger key.
// Ties (only between buildings that cannot overlap) are broken by x, y and then ID, so the
// order never changes between redraws.

import {
  footprintRect,
  type Footprint,
  type PlacementRotation,
  type TileRect,
} from '../../common/world/placement-rules';
import { gridToWorld, worldToScreen, type Camera, type Point, type TileSize } from './projection';

/** An axis-aligned box in world or screen pixels. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The size and ground pivot of a building's image, from the asset manifest. */
export interface BuildingArt {
  readonly width: number;
  readonly height: number;
  readonly pivot: { readonly x: number; readonly y: number };
}

/** The parts of a saved placement the world needs (a subset of PlacementSummary). */
export interface PlacedBuilding {
  readonly placementId: string;
  /** The project it represents, or null for a service structure. */
  readonly projectId: string | null;
  /** The project's name for its label (M2-14), or null for a service structure. */
  readonly name: string | null;
  readonly archived: boolean;
  readonly appearanceId: string;
  readonly tileX: number;
  readonly tileY: number;
  readonly rotation: PlacementRotation;
  readonly footprint: Footprint;
}

export interface WorldBuilding extends PlacedBuilding {
  /** The tiles it covers after rotation. */
  readonly rect: TileRect;
  /** World position of the art's pivot: the footprint's south corner (ADR-0013). */
  readonly pivot: Point;
  /** The bundled art, or null when the appearance no longer resolves (drawn as "Missing art"). */
  readonly art: BuildingArt | null;
  /** The footprint diamond's corners, in world pixels. */
  readonly corners: FootprintCorners;
  /** Everything it draws, in world pixels. Used for culling and hit tests. */
  readonly bounds: Box;
  readonly depth: number;
}

/** Longer names are cut short on the label, so neighbouring labels overlap less. */
export const LABEL_MAX_CHARS = 32;

/**
 * The text on a building's name label: the name, cut to LABEL_MAX_CHARS with an ellipsis.
 * Cuts by code point (Array.from), so an emoji or other astral character is never split.
 */
export function buildingLabel(name: string): string {
  const chars = Array.from(name);
  return chars.length <= LABEL_MAX_CHARS
    ? name
    : `${chars.slice(0, LABEL_MAX_CHARS - 1).join('')}…`;
}

/** How tall the "Missing art" block stands above its footprint, in world pixels. */
export const MISSING_ART_HEIGHT = 48;

export interface FootprintCorners {
  readonly north: Point;
  readonly east: Point;
  readonly south: Point;
  readonly west: Point;
}

/** The four corners of a tile rectangle's diamond, in world pixels. */
export function footprintCorners(rect: TileRect, tile: TileSize): FootprintCorners {
  return {
    north: gridToWorld({ gx: rect.x, gy: rect.y }, tile),
    east: gridToWorld({ gx: rect.x + rect.columns, gy: rect.y }, tile),
    south: gridToWorld({ gx: rect.x + rect.columns, gy: rect.y + rect.rows }, tile),
    west: gridToWorld({ gx: rect.x, gy: rect.y + rect.rows }, tile),
  };
}

export function depthKey(rect: TileRect): number {
  return rect.x + rect.y + (rect.columns + rect.rows) / 2;
}

/** Back-to-front order. Total and stable: equal keys fall back to x, y and then the ID. */
export function compareDepth(a: WorldBuilding, b: WorldBuilding): number {
  return (
    a.depth - b.depth ||
    a.rect.x - b.rect.x ||
    a.rect.y - b.rect.y ||
    (a.placementId < b.placementId ? -1 : a.placementId > b.placementId ? 1 : 0)
  );
}

/**
 * Turns saved placements into drawable buildings, sorted back to front. `artFor` returns the
 * manifest art for an appearance ID, or null when it is missing.
 */
export function layoutBuildings(
  placements: readonly PlacedBuilding[],
  artFor: (appearanceId: string) => BuildingArt | null,
  tile: TileSize,
): WorldBuilding[] {
  return placements
    .map((placement): WorldBuilding => {
      const rect = footprintRect(
        { tileX: placement.tileX, tileY: placement.tileY, rotation: placement.rotation },
        placement.footprint,
      );
      const corners = footprintCorners(rect, tile);
      const art = artFor(placement.appearanceId);
      const ground: Box = {
        left: corners.west.x,
        top: corners.north.y,
        right: corners.east.x,
        bottom: corners.south.y,
      };
      const drawn: Box =
        art === null
          ? { ...ground, top: ground.top - MISSING_ART_HEIGHT }
          : {
              left: corners.south.x - art.pivot.x,
              top: corners.south.y - art.pivot.y,
              right: corners.south.x - art.pivot.x + art.width,
              bottom: corners.south.y - art.pivot.y + art.height,
            };
      return {
        ...placement,
        rect,
        pivot: corners.south,
        art,
        corners,
        bounds: unionBox(ground, drawn),
        depth: depthKey(rect),
      };
    })
    .sort(compareDepth);
}

function unionBox(a: Box, b: Box): Box {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

/**
 * True when any part of a world box shows in a `width` × `height` view. `margin` (screen
 * pixels) keeps buildings just outside the edge drawn, so panning never shows a gap.
 */
export function isOnScreen(
  bounds: Box,
  camera: Camera,
  width: number,
  height: number,
  margin = 0,
): boolean {
  const topLeft = worldToScreen({ x: bounds.left, y: bounds.top }, camera);
  const bottomRight = worldToScreen({ x: bounds.right, y: bounds.bottom }, camera);
  return (
    bottomRight.x >= -margin &&
    topLeft.x <= width + margin &&
    bottomRight.y >= -margin &&
    topLeft.y <= height + margin
  );
}

function inBox(point: Point, box: Box): boolean {
  return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
}

/** The y of the footprint's lower edge (west → south → east) at world x. */
function groundEdgeY(corners: FootprintCorners, x: number): number {
  const { west, south, east } = corners;
  if (x <= south.x) return west.y + ((x - west.x) * (south.y - west.y)) / (south.x - west.x);
  return south.y + ((x - south.x) * (east.y - south.y)) / (east.x - south.x);
}

/**
 * True when a world point is on the building's silhouette: inside its drawn box and not below
 * the front edges of its footprint. So the ground in front of a building's south corner stays
 * ground. The box still includes the image's transparent top corners: an accepted
 * approximation for the placeholder art.
 */
export function hitsBuilding(building: WorldBuilding, point: Point): boolean {
  return inBox(point, building.bounds) && point.y <= groundEdgeY(building.corners, point.x);
}

/**
 * The building under a world point, or null. `buildings` must be back to front (as
 * layoutBuildings returns them); the front-most hit wins, like what the eye sees.
 */
export function pickBuilding(
  buildings: readonly WorldBuilding[],
  point: Point,
): WorldBuilding | null {
  for (let index = buildings.length - 1; index >= 0; index--) {
    const building = buildings[index];
    if (building !== undefined && hitsBuilding(building, point)) return building;
  }
  return null;
}
