import { describe, expect, it } from 'vitest';

import type { TileRect } from '../../src/common/world/placement-rules';
import {
  buildingLabel,
  compareDepth,
  depthKey,
  hitsBuilding,
  isOnScreen,
  LABEL_MAX_CHARS,
  layoutBuildings,
  MISSING_ART_HEIGHT,
  pickBuilding,
  type BuildingArt,
  type PlacedBuilding,
} from '../../src/renderer/world/buildings';
import { DEFAULT_TILE, gridToWorld } from '../../src/renderer/world/projection';

// The bundled 2×2 placeholder (asset manifest): 128 × 128 with its pivot at (64, 128).
const ART_2X2: BuildingArt = { width: 128, height: 128, pivot: { x: 64, y: 128 } };
const artFor = (id: string) => (id === 'placeholder.building.2x2' ? ART_2X2 : null);

function placed(id: string, tileX: number, tileY: number, size = 2): PlacedBuilding {
  return {
    placementId: id,
    projectId: `project-${id}`,
    name: `Project ${id}`,
    archived: false,
    appearanceId: 'placeholder.building.2x2',
    tileX,
    tileY,
    rotation: 0,
    footprint: { columns: size, rows: size },
  };
}

/** Fails the test instead of using a non-null assertion. */
function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

const order = (buildings: readonly PlacedBuilding[]) =>
  layoutBuildings(buildings, artFor, DEFAULT_TILE).map((b) => b.placementId);

describe('layoutBuildings', () => {
  it('puts the art pivot on the south corner of the footprint (ADR-0013)', () => {
    const building = defined(layoutBuildings([placed('a', 10, 4)], artFor, DEFAULT_TILE)[0]);
    expect(building.pivot).toEqual(gridToWorld({ gx: 12, gy: 6 }));
    // 128 px wide around the pivot, 128 px tall above it.
    expect(building.bounds).toEqual({
      left: building.pivot.x - 64,
      right: building.pivot.x + 64,
      top: building.pivot.y - 128,
      bottom: building.pivot.y,
    });
  });

  it('keeps lost art: the stored footprint plus a block of MISSING_ART_HEIGHT', () => {
    const lost = { ...placed('a', 0, 0, 4), appearanceId: 'gone.v9' };
    const [building] = layoutBuildings([lost], artFor, DEFAULT_TILE);
    expect(building?.art).toBeNull();
    expect(building?.rect).toEqual({ x: 0, y: 0, columns: 4, rows: 4 });
    expect(building?.bounds).toEqual({
      left: -128,
      right: 128,
      top: -MISSING_ART_HEIGHT,
      bottom: 128,
    });
  });

  it('swaps a rectangular footprint at 90 and 270 degrees', () => {
    const wide = {
      ...placed('a', 0, 0),
      footprint: { columns: 3, rows: 1 },
      rotation: 90 as const,
    };
    expect(layoutBuildings([wide], artFor, DEFAULT_TILE)[0]?.rect).toEqual({
      x: 0,
      y: 0,
      columns: 1,
      rows: 3,
    });
  });
});

describe('depth sort', () => {
  it('draws a row back to front: larger x is nearer the viewer', () => {
    expect(order([placed('c', 8, 0), placed('a', 0, 0), placed('b', 4, 0)])).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('draws a column back to front: larger y is nearer the viewer', () => {
    expect(order([placed('c', 0, 8), placed('b', 0, 4), placed('a', 0, 0)])).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('draws a small building beside a big one in front when it sits further along a row', () => {
    // The 2×2 touches the 4×4's east side, so its sprite overlaps the big one's wall.
    expect(order([placed('small', 4, 0, 2), placed('big', 0, 0, 4)])).toEqual(['big', 'small']);
    expect(order([placed('small', 0, 4, 2), placed('big', 0, 0, 4)])).toEqual(['big', 'small']);
    // Overlapping the big one's column range from the south.
    expect(order([placed('small', 2, 4, 2), placed('big', 0, 0, 4)])).toEqual(['big', 'small']);
  });

  it('is stable: equal keys fall back to x, then y, then ID, whatever the input order', () => {
    // Diagonal neighbours on the same depth line can't overlap on screen; order is still fixed.
    const a = placed('a', 0, 4);
    const b = placed('b', 4, 0);
    const c = placed('c', 2, 2);
    expect(order([a, b, c])).toEqual(['a', 'c', 'b']);
    expect(order([b, c, a])).toEqual(['a', 'c', 'b']);
    const sameSpotA = placed('m', 1, 1);
    const sameSpotB = placed('n', 1, 1);
    expect(order([sameSpotB, sameSpotA])).toEqual(['m', 'n']);
    const [first, second] = layoutBuildings([sameSpotA, sameSpotB], artFor, DEFAULT_TILE);
    expect(compareDepth(defined(first), defined(second))).toBeLessThan(0);
  });

  it('for square footprints, whichever building is in front always has the larger key', () => {
    // Brute force over every pair of non-overlapping squares (sizes 2–4) on a small grid.
    const sizes = [2, 3, 4];
    const rects: TileRect[] = [];
    for (const size of sizes)
      for (let x = 0; x <= 6; x++)
        for (let y = 0; y <= 6; y++) rects.push({ x, y, columns: size, rows: size });
    const overlaps = (a: TileRect, b: TileRect) =>
      a.x < b.x + b.columns && b.x < a.x + a.columns && a.y < b.y + b.rows && b.y < a.y + a.rows;
    // b is in front of a when it lies past a along one axis and reaches past a's start on the
    // other (otherwise their sprites sit side by side on screen and never overlap).
    const inFront = (b: TileRect, a: TileRect) =>
      (b.x >= a.x + a.columns && b.y + b.rows > a.y) ||
      (b.y >= a.y + a.rows && b.x + b.columns > a.x);
    let checked = 0;
    for (const a of rects) {
      for (const b of rects) {
        if (overlaps(a, b) || !inFront(b, a)) continue;
        expect(
          depthKey(b),
          `${JSON.stringify(b)} in front of ${JSON.stringify(a)}`,
        ).toBeGreaterThan(depthKey(a));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

describe('culling', () => {
  const box = { left: 0, top: 0, right: 100, bottom: 50 };
  const camera = { panX: 0, panY: 0, zoom: 1 };

  it('keeps boxes that touch the view and drops ones fully outside', () => {
    expect(isOnScreen(box, camera, 800, 600)).toBe(true);
    expect(isOnScreen(box, { ...camera, panX: -101 }, 800, 600)).toBe(false);
    expect(isOnScreen(box, { ...camera, panX: 801 }, 800, 600)).toBe(false);
    expect(isOnScreen(box, { ...camera, panY: -51 }, 800, 600)).toBe(false);
    expect(isOnScreen(box, { ...camera, panY: 601 }, 800, 600)).toBe(false);
  });

  it('applies zoom and an optional margin in screen pixels', () => {
    // At 0.5× the box is 50 px wide, so panning it 60 px left puts it fully off screen.
    expect(isOnScreen(box, { panX: -60, panY: 0, zoom: 0.5 }, 800, 600)).toBe(false);
    expect(isOnScreen(box, { panX: -60, panY: 0, zoom: 0.5 }, 800, 600, 16)).toBe(true);
  });
});

describe('hit testing', () => {
  const buildings = layoutBuildings(
    [placed('back', 0, 0), placed('front', 2, 0)],
    artFor,
    DEFAULT_TILE,
  );
  const back = defined(buildings.find((b) => b.placementId === 'back'));
  const front = defined(buildings.find((b) => b.placementId === 'front'));

  it('picks a building by its walls, roof or footprint', () => {
    // The west half of back's footprint: front's walls hide the east half.
    const westOfFootprint = gridToWorld({ gx: 0.5, gy: 1.5 });
    expect(pickBuilding(buildings, westOfFootprint)?.placementId).toBe('back');
    const roof = { x: back.pivot.x, y: back.bounds.top + 10 };
    expect(hitsBuilding(back, roof)).toBe(true);
  });

  it('the front-most building wins where two overlap', () => {
    // Just above front's north corner, inside both drawn boxes.
    const shared = { x: front.corners.north.x - 4, y: front.corners.north.y - 20 };
    expect(hitsBuilding(back, shared)).toBe(true);
    expect(hitsBuilding(front, shared)).toBe(true);
    expect(pickBuilding(buildings, shared)?.placementId).toBe('front');
  });

  it('ground in front of the south corner is ground, not the building', () => {
    const beside = { x: back.pivot.x - 40, y: back.pivot.y - 2 };
    expect(hitsBuilding(back, beside)).toBe(false);
    expect(pickBuilding(buildings, { x: 5000, y: 5000 })).toBeNull();
  });
});

describe('buildingLabel (M2-14)', () => {
  it('shows a short name as it is', () => {
    expect(buildingLabel('Launch plan')).toBe('Launch plan');
    expect(buildingLabel('x'.repeat(LABEL_MAX_CHARS))).toBe('x'.repeat(LABEL_MAX_CHARS));
  });

  it('cuts a long name to the limit with an ellipsis', () => {
    const label = buildingLabel('y'.repeat(80));
    expect(Array.from(label)).toHaveLength(LABEL_MAX_CHARS);
    expect(label.endsWith('…')).toBe(true);
  });

  it('never splits a character made of two UTF-16 units', () => {
    const label = buildingLabel('🏰'.repeat(40));
    expect(label).toBe(`${'🏰'.repeat(LABEL_MAX_CHARS - 1)}…`);
  });
});
