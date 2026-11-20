// Placement rules: may a building stand on these tiles? (UI_SPEC §17.2)
//
// One pure module shared by the placement preview (renderer, M2-7) and the placement commands
// (main, M2-3). Because both run the same code, the green/red preview and the real check can
// never disagree. The command handler still runs it again on its own data: the preview is a
// hint, the handler decides (PRODUCT_RULES §3.1). Plain TypeScript only: no Electron, DOM, Pixi
// or database imports, so it runs in both processes and in fast unit tests.
//
// Anchor and rotation (ADR-0024, user decision 2026-11-20):
//   - A placement's (tileX, tileY) is the footprint's north corner tile: the lowest x and the
//     lowest y it covers. The footprint always grows toward +x (columns) and +y (rows).
//   - Rotation turns the art in place. A square footprint covers the same tiles at every
//     rotation; a rectangular one swaps columns and rows at 90 and 270. The anchor never moves.
//   - The art's south-corner pivot (ADR-0013) is grid point (tileX + columns, tileY + rows).
//
// "Nearby" in findNearbyPlot means ring distance on the grid (how many tiles out in any
// direction, diagonals included), not walking distance.

/** Quarter turns, in degrees (UI_SPEC §17.1). Must match the CHECK in migration 5. */
export const PLACEMENT_ROTATIONS = [0, 90, 180, 270] as const;
export type PlacementRotation = (typeof PLACEMENT_ROTATIONS)[number];

export function isPlacementRotation(value: unknown): value is PlacementRotation {
  return (PLACEMENT_ROTATIONS as readonly unknown[]).includes(value);
}

/** Building footprint sides in tiles (ADR-0013: 2×2, 3×3, 4×4). */
export const BUILDING_SIZES = [2, 3, 4] as const;
export type BuildingSize = (typeof BUILDING_SIZES)[number];

/** The asset manifest's largest footprint side (src/common/assets/asset-manifest.ts). */
const MAX_FOOTPRINT_SIDE = 16;

/** Ground tiles an appearance covers before rotation: columns along gx, rows along gy. */
export interface Footprint {
  readonly columns: number;
  readonly rows: number;
}

export function squareFootprint(size: BuildingSize): Footprint {
  return { columns: size, rows: size };
}

/** A rectangle of whole tiles, anchored on its north corner tile (x, y). */
export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly columns: number;
  readonly rows: number;
}

export interface Tile {
  readonly tileX: number;
  readonly tileY: number;
}

/** Where a building stands: its anchor tile and its rotation. */
export interface PlacementSpot extends Tile {
  readonly rotation: PlacementRotation;
}

export interface PlacementWorld {
  readonly gridWidth: number;
  readonly gridHeight: number;
  /**
   * Tiles no building may cover. Nothing defines reserved areas yet (no spec entry, no table),
   * so callers pass `[]` until something does; the rule is here so it is checked in one place.
   */
  readonly reserved: readonly TileRect[];
}

/** A building already in the world, as the rules need to see it. */
export interface OccupiedPlacement extends PlacementSpot {
  readonly id: string;
  readonly footprint: Footprint;
}

/**
 * The spot being checked. Its position and rotation may come from untrusted input (a drag in
 * the renderer, an IPC payload), so they are plain numbers here and checked by the rules. The
 * footprint comes from the trusted asset manifest. `placementId` is set when moving an existing
 * building, so it does not collide with its own old tiles.
 */
export interface PlacementCandidate {
  readonly tileX: number;
  readonly tileY: number;
  readonly rotation: number;
  readonly footprint: Footprint;
  readonly placementId?: string;
}

export type PlacementCheck =
  | { readonly kind: 'ok'; readonly rect: TileRect }
  | { readonly kind: 'invalid_rotation' }
  | { readonly kind: 'out_of_bounds' }
  | { readonly kind: 'reserved' }
  | { readonly kind: 'overlaps'; readonly blockingIds: readonly string[] };

export interface PlotRequest {
  /** Where to start looking, usually the tile under the pointer or the camera centre. */
  readonly start: Tile;
  readonly footprint: Footprint;
  readonly rotation: PlacementRotation;
  /** Set when re-placing an existing building, as in PlacementCandidate. */
  readonly placementId?: string;
}

// The footprint and rotation come from code and the manifest, not from the user, so a bad one
// is a bug: throw instead of returning a result the UI would have to explain.
function assertFootprint(footprint: Footprint): void {
  for (const side of [footprint.columns, footprint.rows]) {
    if (!Number.isInteger(side) || side < 1 || side > MAX_FOOTPRINT_SIDE) {
      throw new RangeError(
        `Footprint sides must be whole numbers from 1 to ${String(MAX_FOOTPRINT_SIDE)}.`,
      );
    }
  }
}

/** World sides allowed by the world contract (src/common/contracts/world.ts). */
const MIN_GRID_SIDE = 16;
const MAX_GRID_SIDE = 256;

// The world's size comes from the database, already checked by the world contract. Checked
// again here because findNearbyPlot allocates grids of that size: a bad value must fail loudly,
// not allocate something huge or quietly give wrong answers.
function assertWorld(world: PlacementWorld): void {
  for (const side of [world.gridWidth, world.gridHeight]) {
    if (!Number.isInteger(side) || side < MIN_GRID_SIDE || side > MAX_GRID_SIDE) {
      throw new RangeError(
        `World sides must be whole numbers from ${String(MIN_GRID_SIDE)} to ${String(MAX_GRID_SIDE)}.`,
      );
    }
  }
}

/** The footprint after turning: columns and rows swap at 90 and 270. */
export function rotatedFootprint(footprint: Footprint, rotation: PlacementRotation): Footprint {
  assertFootprint(footprint);
  return rotation === 90 || rotation === 270
    ? { columns: footprint.rows, rows: footprint.columns }
    : { columns: footprint.columns, rows: footprint.rows };
}

/** The rectangle of tiles a building covers. */
export function footprintRect(spot: PlacementSpot, footprint: Footprint): TileRect {
  const turned = rotatedFootprint(footprint, spot.rotation);
  return { x: spot.tileX, y: spot.tileY, columns: turned.columns, rows: turned.rows };
}

/** Every tile a building covers, row by row from the anchor. For preview highlights. */
export function footprintTiles(spot: PlacementSpot, footprint: Footprint): Tile[] {
  const rect = footprintRect(spot, footprint);
  const tiles: Tile[] = [];
  for (let dy = 0; dy < rect.rows; dy++) {
    for (let dx = 0; dx < rect.columns; dx++) {
      tiles.push({ tileX: rect.x + dx, tileY: rect.y + dy });
    }
  }
  return tiles;
}

/** True when the two rectangles share at least one tile (touching edges don't count). */
export function rectsOverlap(a: TileRect, b: TileRect): boolean {
  return a.x < b.x + b.columns && b.x < a.x + a.columns && a.y < b.y + b.rows && b.y < a.y + a.rows;
}

function insideWorld(world: PlacementWorld, rect: TileRect): boolean {
  // Number.isInteger rejects NaN, ±Infinity and fractions; the range checks reject negative
  // and huge values.
  return (
    Number.isInteger(rect.x) &&
    Number.isInteger(rect.y) &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.columns <= world.gridWidth &&
    rect.y + rect.rows <= world.gridHeight
  );
}

/**
 * Decides whether a building may stand at the candidate spot. Checks run in a fixed order and
 * the first failure wins: rotation, then bounds, then reserved areas, then other buildings.
 * `overlaps` lists every blocking building once, in the order of `occupied`.
 */
export function checkPlacement(
  world: PlacementWorld,
  occupied: readonly OccupiedPlacement[],
  candidate: PlacementCandidate,
): PlacementCheck {
  assertWorld(world);
  const { rotation } = candidate;
  if (!isPlacementRotation(rotation)) return { kind: 'invalid_rotation' };

  const rect = footprintRect(
    { tileX: candidate.tileX, tileY: candidate.tileY, rotation },
    candidate.footprint,
  );
  if (!insideWorld(world, rect)) return { kind: 'out_of_bounds' };
  if (world.reserved.some((area) => rectsOverlap(area, rect))) return { kind: 'reserved' };

  const blockingIds: string[] = [];
  for (const other of occupied) {
    if (other.id === candidate.placementId || blockingIds.includes(other.id)) continue;
    if (rectsOverlap(footprintRect(other, other.footprint), rect)) blockingIds.push(other.id);
  }
  return blockingIds.length > 0 ? { kind: 'overlaps', blockingIds } : { kind: 'ok', rect };
}

/**
 * Auto-place (UI_SPEC §17.2): finds the free spot nearest `start` where the building fits, or
 * returns `null` when it fits nowhere.
 *
 * The search is deterministic: the same world and request always give the same answer. It
 * looks at the start first, then at square rings one tile further out each time. Inside a ring
 * it goes row by row from the top (lowest y), and left to right (lowest x) within a row. A
 * start outside the map is first moved to the nearest anchor where the footprint fits on the
 * map, so every possible spot is still reached. Every returned spot passes checkPlacement.
 */
export function findNearbyPlot(
  world: PlacementWorld,
  occupied: readonly OccupiedPlacement[],
  request: PlotRequest,
): PlacementSpot | null {
  assertWorld(world);
  if (!isPlacementRotation(request.rotation)) {
    throw new RangeError('Rotation must be 0, 90, 180 or 270.');
  }
  const size = rotatedFootprint(request.footprint, request.rotation);
  const { gridWidth: width, gridHeight: height } = world;
  // Anchors where the footprint stays on the map: x in [0, maxX], y in [0, maxY].
  const maxX = width - size.columns;
  const maxY = height - size.rows;
  if (maxX < 0 || maxY < 0) return null;

  const free = freeTileCounter(world, occupied, request.placementId);
  const fits = (x: number, y: number): boolean => free(x, y, size.columns, size.rows);

  const startX = clamp(Math.round(request.start.tileX), 0, maxX);
  const startY = clamp(Math.round(request.start.tileY), 0, maxY);
  const lastRing = Math.max(startX, maxX - startX, startY, maxY - startY);

  for (let ring = 0; ring <= lastRing; ring++) {
    for (let y = startY - ring; y <= startY + ring; y++) {
      if (y < 0 || y > maxY) continue;
      const edgeRow = y === startY - ring || y === startY + ring;
      // On the ring's top and bottom rows every x is on the ring; in between, only the two ends.
      const step = edgeRow || ring === 0 ? 1 : 2 * ring;
      for (let x = startX - ring; x <= startX + ring; x += step) {
        if (x < 0 || x > maxX) continue;
        if (fits(x, y)) return { tileX: x, tileY: y, rotation: request.rotation };
      }
    }
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  // NaN (a missing start) falls back to the top-left anchor.
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Marks every blocked tile once, then answers "is this whole rectangle free?" in constant time
 * with a summed-area table (each cell holds the number of blocked tiles above and to its left).
 * Even a 256 × 256 world with every anchor tried stays fast.
 */
function freeTileCounter(
  world: PlacementWorld,
  occupied: readonly OccupiedPlacement[],
  ignoreId: string | undefined,
): (x: number, y: number, columns: number, rows: number) => boolean {
  const { gridWidth: width, gridHeight: height } = world;
  const blocked = new Uint8Array(width * height);
  const block = (rect: TileRect): void => {
    // Parts of a rectangle outside the map are skipped.
    for (let y = Math.max(0, rect.y); y < Math.min(height, rect.y + rect.rows); y++) {
      for (let x = Math.max(0, rect.x); x < Math.min(width, rect.x + rect.columns); x++) {
        blocked[y * width + x] = 1;
      }
    }
  };
  world.reserved.forEach(block);
  for (const other of occupied) {
    if (other.id !== ignoreId) block(footprintRect(other, other.footprint));
  }

  // sums[(y) * (width + 1) + x] = blocked tiles in rows < y and columns < x.
  const stride = width + 1;
  const sums = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      sums[(y + 1) * stride + x + 1] =
        (blocked[y * width + x] ?? 0) +
        (sums[y * stride + x + 1] ?? 0) +
        (sums[(y + 1) * stride + x] ?? 0) -
        (sums[y * stride + x] ?? 0);
    }
  }
  const at = (x: number, y: number): number => sums[y * stride + x] ?? 0;
  return (x, y, columns, rows) =>
    at(x + columns, y + rows) - at(x, y + rows) - at(x + columns, y) + at(x, y) === 0;
}
