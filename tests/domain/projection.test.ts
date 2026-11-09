import { describe, expect, it } from 'vitest';

import {
  centeredCamera,
  clampZoom,
  DEFAULT_MAP,
  DEFAULT_TILE,
  gridToWorld,
  pickTile,
  screenToWorld,
  worldToGrid,
  worldToScreen,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomAt,
  type Camera,
} from '../../src/renderer/world/projection';

const identity: Camera = { panX: 0, panY: 0, zoom: 1 };
const W = DEFAULT_TILE.width; // 64
const H = DEFAULT_TILE.height; // 32

describe('gridToWorld / worldToGrid (UI_SPEC §17.1)', () => {
  it('matches the spec formula for known tiles', () => {
    expect(gridToWorld({ gx: 0, gy: 0 })).toEqual({ x: 0, y: 0 });
    expect(gridToWorld({ gx: 1, gy: 0 })).toEqual({ x: W / 2, y: H / 2 });
    expect(gridToWorld({ gx: 0, gy: 1 })).toEqual({ x: -W / 2, y: H / 2 });
    expect(gridToWorld({ gx: 3, gy: 5 })).toEqual({ x: -64, y: 128 });
  });

  it('inverse undoes forward, including fractional and negative grid points', () => {
    for (const grid of [
      { gx: 0, gy: 0 },
      { gx: 63, gy: 63 },
      { gx: 12.25, gy: 40.5 },
      { gx: -7, gy: 3.75 },
    ]) {
      const back = worldToGrid(gridToWorld(grid));
      expect(back.gx).toBeCloseTo(grid.gx, 12);
      expect(back.gy).toBeCloseTo(grid.gy, 12);
    }
  });

  it('works with non-default tile sizes', () => {
    const tile = { width: 100, height: 40 };
    const back = worldToGrid(gridToWorld({ gx: 4, gy: 9 }, tile), tile);
    expect(back.gx).toBeCloseTo(4, 12);
    expect(back.gy).toBeCloseTo(9, 12);
  });

  it('rejects zero, negative and non-finite tile sizes', () => {
    expect(() => gridToWorld({ gx: 0, gy: 0 }, { width: 0, height: 32 })).toThrow(RangeError);
    expect(() => worldToGrid({ x: 0, y: 0 }, { width: 64, height: -1 })).toThrow(RangeError);
    expect(() => worldToGrid({ x: 0, y: 0 }, { width: Number.NaN, height: 32 })).toThrow(
      RangeError,
    );
  });
});

describe('camera transform', () => {
  it('screenToWorld undoes worldToScreen with negative pan and several zooms', () => {
    for (const zoom of [ZOOM_MIN, 0.75, 1, 1.5, ZOOM_MAX]) {
      const camera: Camera = { panX: -1234.5, panY: -987.25, zoom };
      const world = { x: 321.5, y: -45 };
      const back = screenToWorld(worldToScreen(world, camera), camera);
      expect(back.x).toBeCloseTo(world.x, 9);
      expect(back.y).toBeCloseTo(world.y, 9);
    }
  });

  it('applies zoom before pan (screen = world * zoom + pan)', () => {
    expect(worldToScreen({ x: 10, y: 20 }, { panX: -5, panY: 7, zoom: 2 })).toEqual({
      x: 15,
      y: 47,
    });
  });

  it('rejects zero, negative and non-finite zoom or pan', () => {
    expect(() => screenToWorld({ x: 0, y: 0 }, { panX: 0, panY: 0, zoom: 0 })).toThrow(RangeError);
    expect(() => screenToWorld({ x: 0, y: 0 }, { panX: 0, panY: 0, zoom: -1 })).toThrow(RangeError);
    expect(() =>
      worldToScreen({ x: 0, y: 0 }, { panX: Number.POSITIVE_INFINITY, panY: 0, zoom: 1 }),
    ).toThrow(RangeError);
  });
});

describe('pickTile', () => {
  // The centre of tile (gx, gy)'s diamond, in world pixels.
  const centreOf = (gx: number, gy: number) => gridToWorld({ gx: gx + 0.5, gy: gy + 0.5 });

  it('picks the tile whose diamond contains the point', () => {
    for (const [gx, gy] of [
      [0, 0],
      [5, 9],
      [63, 0],
      [0, 63],
      [63, 63],
    ] as const) {
      expect(pickTile(centreOf(gx, gy), identity)).toEqual({ gx, gy });
    }
  });

  it('assigns exact edges and corners to the tile with the larger index', () => {
    // Tile (0,0)'s top corner is world (0,0).
    expect(pickTile({ x: 0, y: 0 }, identity)).toEqual({ gx: 0, gy: 0 });
    // Shared corner of (0,0), (1,0), (0,1), (1,1): its bottom corner.
    expect(pickTile({ x: 0, y: H }, identity)).toEqual({ gx: 1, gy: 1 });
    // Right corner of (0,0) lies on the gx = 1 edge.
    expect(pickTile({ x: W / 2, y: H / 2 }, identity)).toEqual({ gx: 1, gy: 0 });
    // Just inside that corner stays in (0,0).
    expect(pickTile({ x: W / 2 - 0.01, y: H / 2 }, identity)).toEqual({ gx: 0, gy: 0 });
  });

  it('keeps exact edges stable when zoom introduces floating-point error', () => {
    // 0.1 and 0.3 aren't exact in binary, so for thousands of these top corners a naive
    // floor() lands on the wrong side (checked: removing EDGE_EPSILON fails this test).
    const wrong: string[] = [];
    for (const zoom of [0.3, 0.7, 1.1, 3.3]) {
      const camera: Camera = { panX: -0.1, panY: -0.3, zoom };
      for (let gx = 0; gx < DEFAULT_MAP.columns; gx++) {
        for (let gy = 0; gy < DEFAULT_MAP.rows; gy++) {
          const picked = pickTile(worldToScreen(gridToWorld({ gx, gy }), camera), camera);
          if (picked?.gx !== gx || picked.gy !== gy)
            wrong.push(`${String(gx)},${String(gy)}@${String(zoom)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('returns null outside the map, at every edge', () => {
    const outside = [
      gridToWorld({ gx: -0.5, gy: 10 }), // beyond gx = 0
      gridToWorld({ gx: 10, gy: -0.5 }), // beyond gy = 0
      gridToWorld({ gx: 64, gy: 10 }), // the far gx edge belongs to tile 64, which doesn't exist
      gridToWorld({ gx: 10, gy: 64.2 }),
      { x: 0, y: -1 }, // just above the map's top corner
    ];
    for (const point of outside) expect(pickTile(point, identity)).toBeNull();
  });

  it('picks the same tile through a negative camera at different zoom levels', () => {
    for (const zoom of [ZOOM_MIN, 0.5, 1, 2, ZOOM_MAX]) {
      const camera: Camera = { panX: -500, panY: -2000, zoom };
      const screen = worldToScreen(centreOf(40, 22), camera);
      expect(pickTile(screen, camera)).toEqual({ gx: 40, gy: 22 });
    }
  });

  it('respects a custom map size', () => {
    const small = { columns: 4, rows: 2 };
    expect(pickTile(centreOf(3, 1), identity, small)).toEqual({ gx: 3, gy: 1 });
    expect(pickTile(centreOf(3, 2), identity, small)).toBeNull();
  });
});

describe('zoom helpers', () => {
  it('clamps zoom to the defined bounds', () => {
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
    expect(clampZoom(100)).toBe(ZOOM_MAX);
    expect(clampZoom(1.25)).toBe(1.25);
    expect(() => clampZoom(Number.NaN)).toThrow(RangeError);
  });

  it('zoomAt keeps the world point under the cursor fixed', () => {
    const camera: Camera = { panX: -300, panY: 120, zoom: 1 };
    const cursor = { x: 412, y: 233 };
    const before = screenToWorld(cursor, camera);
    const zoomed = zoomAt(camera, cursor, 1.5);
    expect(zoomed.zoom).toBe(1.5);
    const after = screenToWorld(cursor, zoomed);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('zoomAt stops at the bounds', () => {
    expect(zoomAt(identity, { x: 0, y: 0 }, 1000).zoom).toBe(ZOOM_MAX);
    expect(zoomAt(identity, { x: 0, y: 0 }, 0.0001).zoom).toBe(ZOOM_MIN);
  });

  it('centeredCamera puts the map centre in the middle of the canvas', () => {
    const camera = centeredCamera(800, 600, 1);
    const centre = pickTile({ x: 400, y: 600 / 2 + 1 }, camera);
    expect(centre).toEqual({ gx: DEFAULT_MAP.columns / 2, gy: DEFAULT_MAP.rows / 2 });
  });
});
