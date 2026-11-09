// Isometric projection math for the world view (UI_SPEC §17.1).
//
// Three coordinate spaces, kept strictly apart:
// - grid:   logical tile coordinates (gx, gy). This is what gets stored; never pixels.
// - world:  pixels on the unzoomed, unpanned isometric plane. Tile (0, 0)'s top corner is (0, 0).
// - screen: CSS pixels inside the canvas element, after the camera's pan and zoom.
//
// Pure functions with no DOM or Pixi imports, so they're unit-tested in plain Node and
// the renderer can never drift from what the tests check.

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface GridPoint {
  readonly gx: number;
  readonly gy: number;
}

/** Size of one ground tile's diamond, in world pixels. */
export interface TileSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Camera transform from world to screen: `screen = world * zoom + pan`.
 * `panX`/`panY` may be negative (the world origin is then left of / above the canvas).
 */
export interface Camera {
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
}

/** Map size in tiles. Valid tiles are 0 ≤ gx < columns and 0 ≤ gy < rows. */
export interface MapSize {
  readonly columns: number;
  readonly rows: number;
}

/** ART_BIBLE §34: 64 × 32 logical-pixel ground tiles (2:1 diamond). */
export const DEFAULT_TILE: TileSize = { width: 64, height: 32 };

/** UI_SPEC §17.1: recommended starting map. */
export const DEFAULT_MAP: MapSize = { columns: 64, rows: 64 };

/** UI_SPEC §6.2: zoom stays "within defined bounds". */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;

// Floating-point division can turn an exact tile edge (1.0) into 0.9999999999. Nudging by
// a tiny amount before flooring keeps the edge convention exact: an edge belongs to the
// tile with the larger index (half-open tiles, like array slices).
const EDGE_EPSILON = 1e-9;

function assertTile(tile: TileSize): void {
  if (!(Number.isFinite(tile.width) && tile.width > 0)) {
    throw new RangeError(`Tile width must be a positive number, got ${String(tile.width)}`);
  }
  if (!(Number.isFinite(tile.height) && tile.height > 0)) {
    throw new RangeError(`Tile height must be a positive number, got ${String(tile.height)}`);
  }
}

function assertCamera(camera: Camera): void {
  if (!(Number.isFinite(camera.zoom) && camera.zoom > 0)) {
    throw new RangeError(`Camera zoom must be a positive number, got ${String(camera.zoom)}`);
  }
  if (!Number.isFinite(camera.panX) || !Number.isFinite(camera.panY)) {
    throw new RangeError('Camera pan must be finite');
  }
}

/** Grid → world (§17.1 forward projection). Integer input gives the tile's top corner. */
export function gridToWorld(grid: GridPoint, tile: TileSize = DEFAULT_TILE): Point {
  assertTile(tile);
  return {
    x: ((grid.gx - grid.gy) * tile.width) / 2,
    y: ((grid.gx + grid.gy) * tile.height) / 2,
  };
}

/** World → grid (§17.1 inverse projection). Returns fractional grid coordinates. */
export function worldToGrid(world: Point, tile: TileSize = DEFAULT_TILE): GridPoint {
  assertTile(tile);
  return {
    gx: world.x / tile.width + world.y / tile.height,
    gy: world.y / tile.height - world.x / tile.width,
  };
}

/** World → screen through the camera. */
export function worldToScreen(world: Point, camera: Camera): Point {
  assertCamera(camera);
  return { x: world.x * camera.zoom + camera.panX, y: world.y * camera.zoom + camera.panY };
}

/** Screen → world: undo pan, then zoom (§17.1: reverse the camera before inverse projection). */
export function screenToWorld(screen: Point, camera: Camera): Point {
  assertCamera(camera);
  return { x: (screen.x - camera.panX) / camera.zoom, y: (screen.y - camera.panY) / camera.zoom };
}

/**
 * The tile under a screen point, or `null` when the point is outside the map.
 * Tile edges belong to the tile with the larger index (see EDGE_EPSILON).
 */
export function pickTile(
  screen: Point,
  camera: Camera,
  map: MapSize = DEFAULT_MAP,
  tile: TileSize = DEFAULT_TILE,
): GridPoint | null {
  const grid = worldToGrid(screenToWorld(screen, camera), tile);
  const gx = Math.floor(grid.gx + EDGE_EPSILON);
  const gy = Math.floor(grid.gy + EDGE_EPSILON);
  if (gx < 0 || gy < 0 || gx >= map.columns || gy >= map.rows) return null;
  return { gx, gy };
}

/** Keeps zoom within [ZOOM_MIN, ZOOM_MAX]. */
export function clampZoom(zoom: number): number {
  if (Number.isNaN(zoom)) throw new RangeError('Zoom must be a number');
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/**
 * Zooms by `factor` around a screen point (the mouse), so the world point under it stays put.
 * The resulting zoom is clamped to the allowed bounds.
 */
export function zoomAt(camera: Camera, screen: Point, factor: number): Camera {
  const anchor = screenToWorld(screen, camera);
  const zoom = clampZoom(camera.zoom * factor);
  return { zoom, panX: screen.x - anchor.x * zoom, panY: screen.y - anchor.y * zoom };
}

/** A camera that puts the centre of the map at the centre of a `width` × `height` canvas. */
export function centeredCamera(
  width: number,
  height: number,
  zoom = 1,
  map: MapSize = DEFAULT_MAP,
  tile: TileSize = DEFAULT_TILE,
): Camera {
  const centre = gridToWorld({ gx: map.columns / 2, gy: map.rows / 2 }, tile);
  const z = clampZoom(zoom);
  return { zoom: z, panX: width / 2 - centre.x * z, panY: height / 2 - centre.y * z };
}
