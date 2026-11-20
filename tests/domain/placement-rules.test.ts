import { describe, expect, it } from 'vitest';

import {
  BUILDING_SIZES,
  checkPlacement,
  findNearbyPlot,
  footprintRect,
  footprintTiles,
  isPlacementRotation,
  PLACEMENT_ROTATIONS,
  rectsOverlap,
  rotatedFootprint,
  squareFootprint,
  type Footprint,
  type OccupiedPlacement,
  type PlacementRotation,
  type PlacementWorld,
} from '../../src/common/world/placement-rules';

const world64: PlacementWorld = { gridWidth: 64, gridHeight: 64, reserved: [] };
const two = squareFootprint(2);
const three = squareFootprint(3);
const tall: Footprint = { columns: 2, rows: 3 };

function building(
  id: string,
  tileX: number,
  tileY: number,
  footprint: Footprint = two,
  rotation: PlacementRotation = 0,
): OccupiedPlacement {
  return { id, tileX, tileY, rotation, footprint };
}

/** Covers every tile of the world with 1×1 "buildings", except the given holes. */
function fillWorld(world: PlacementWorld, holes: readonly [number, number][] = []) {
  const occupied: OccupiedPlacement[] = [];
  for (let y = 0; y < world.gridHeight; y++) {
    for (let x = 0; x < world.gridWidth; x++) {
      if (holes.some(([hx, hy]) => hx === x && hy === y)) continue;
      occupied.push(building(`b-${String(x)}-${String(y)}`, x, y, { columns: 1, rows: 1 }));
    }
  }
  return occupied;
}

describe('rotations', () => {
  it('accepts only quarter turns', () => {
    for (const r of PLACEMENT_ROTATIONS) expect(isPlacementRotation(r)).toBe(true);
    for (const r of [45, -90, 360, 90.5, Number.NaN, '90', null, undefined]) {
      expect(isPlacementRotation(r)).toBe(false);
    }
  });
});

describe('footprints (ADR-0013 sizes, north-corner anchor, ADR-0024)', () => {
  it.each(BUILDING_SIZES)('a %i×%i building covers the same tiles at every rotation', (size) => {
    const footprint = squareFootprint(size);
    const atZero = footprintTiles({ tileX: 5, tileY: 7, rotation: 0 }, footprint);
    expect(atZero).toHaveLength(size * size);
    // The anchor is the north corner: the lowest x and the lowest y.
    expect(atZero[0]).toEqual({ tileX: 5, tileY: 7 });
    expect(atZero.at(-1)).toEqual({ tileX: 5 + size - 1, tileY: 7 + size - 1 });
    for (const rotation of PLACEMENT_ROTATIONS) {
      expect(footprintTiles({ tileX: 5, tileY: 7, rotation }, footprint)).toEqual(atZero);
    }
  });

  it('lists tiles row by row from the anchor', () => {
    expect(footprintTiles({ tileX: 1, tileY: 2, rotation: 0 }, two)).toEqual([
      { tileX: 1, tileY: 2 },
      { tileX: 2, tileY: 2 },
      { tileX: 1, tileY: 3 },
      { tileX: 2, tileY: 3 },
    ]);
  });

  it('swaps columns and rows of a rectangular footprint at 90 and 270, keeping the anchor', () => {
    expect(rotatedFootprint(tall, 0)).toEqual({ columns: 2, rows: 3 });
    expect(rotatedFootprint(tall, 90)).toEqual({ columns: 3, rows: 2 });
    expect(rotatedFootprint(tall, 180)).toEqual({ columns: 2, rows: 3 });
    expect(rotatedFootprint(tall, 270)).toEqual({ columns: 3, rows: 2 });
    expect(footprintRect({ tileX: 4, tileY: 4, rotation: 90 }, tall)).toEqual({
      x: 4,
      y: 4,
      columns: 3,
      rows: 2,
    });
  });

  it('throws for a footprint that cannot come from the manifest (a bug, not user input)', () => {
    for (const bad of [
      { columns: 0, rows: 2 },
      { columns: 2, rows: 17 },
      { columns: 1.5, rows: 2 },
      { columns: Number.NaN, rows: 2 },
    ]) {
      expect(() => rotatedFootprint(bad, 0)).toThrow(RangeError);
    }
  });
});

describe('rectsOverlap', () => {
  const a = { x: 0, y: 0, columns: 2, rows: 2 };
  it('treats touching edges and corners as free', () => {
    expect(rectsOverlap(a, { x: 2, y: 0, columns: 2, rows: 2 })).toBe(false);
    expect(rectsOverlap(a, { x: 0, y: 2, columns: 2, rows: 2 })).toBe(false);
    expect(rectsOverlap(a, { x: 2, y: 2, columns: 2, rows: 2 })).toBe(false);
  });
  it('detects one shared tile and full containment', () => {
    expect(rectsOverlap(a, { x: 1, y: 1, columns: 2, rows: 2 })).toBe(true);
    expect(
      rectsOverlap({ x: 0, y: 0, columns: 4, rows: 4 }, { x: 1, y: 1, columns: 1, rows: 1 }),
    ).toBe(true);
  });
});

describe('checkPlacement', () => {
  const at = (tileX: number, tileY: number, rotation: number = 0, footprint = two) =>
    checkPlacement(world64, [], { tileX, tileY, rotation, footprint });

  it('accepts every map corner where the footprint just fits', () => {
    for (const size of BUILDING_SIZES) {
      const far = 64 - size;
      for (const [x, y] of [
        [0, 0],
        [far, 0],
        [0, far],
        [far, far],
      ] as const) {
        expect(at(x, y, 0, squareFootprint(size))).toEqual({
          kind: 'ok',
          rect: { x, y, columns: size, rows: size },
        });
      }
    }
  });

  it('refuses one tile past each edge', () => {
    expect(at(63, 10).kind).toBe('out_of_bounds');
    expect(at(10, 63).kind).toBe('out_of_bounds');
    expect(at(-1, 10).kind).toBe('out_of_bounds');
    expect(at(10, -1).kind).toBe('out_of_bounds');
    expect(at(61, 61, 0, three)).toEqual(expect.objectContaining({ kind: 'ok' }));
    expect(at(62, 61, 0, three).kind).toBe('out_of_bounds');
  });

  it('refuses negative, huge, fractional and non-number coordinates', () => {
    for (const [x, y] of [
      [-1000, 5],
      [5, -1],
      [1e9, 5],
      [Number.MAX_SAFE_INTEGER, 0],
      [1e300, 0],
      [Number.POSITIVE_INFINITY, 0],
      [0, Number.NEGATIVE_INFINITY],
      [Number.NaN, 0],
      [2.5, 3],
      [3, 0.0001],
    ]) {
      expect(at(x as number, y as number).kind, `${String(x)}, ${String(y)}`).toBe('out_of_bounds');
    }
  });

  it('respects a rectangular footprint’s turned size at the far edge', () => {
    // 2 wide × 3 deep at 0; 3 wide × 2 deep at 90.
    expect(at(62, 61, 0, tall).kind).toBe('ok');
    expect(at(62, 61, 90, tall).kind).toBe('out_of_bounds');
    expect(at(61, 62, 90, tall).kind).toBe('ok');
    expect(at(61, 62, 180, tall).kind).toBe('out_of_bounds');
    expect(at(61, 62, 270, tall).kind).toBe('ok');
  });

  it('refuses a rotation that is not a quarter turn, before anything else', () => {
    for (const rotation of [45, 360, -90, 89.9, Number.NaN]) {
      expect(at(-5, -5, rotation).kind).toBe('invalid_rotation');
    }
  });

  it('refuses reserved tiles, but not ones next to them', () => {
    const world = { ...world64, reserved: [{ x: 10, y: 10, columns: 3, rows: 3 }] };
    const check = (x: number, y: number) =>
      checkPlacement(world, [], { tileX: x, tileY: y, rotation: 0, footprint: two }).kind;
    expect(check(9, 9)).toBe('reserved'); // shares tile (10, 10)
    expect(check(12, 12)).toBe('reserved');
    expect(check(8, 8)).toBe('ok');
    expect(check(13, 10)).toBe('ok');
  });

  it('checks bounds before reserved areas and reserved areas before buildings', () => {
    const world = { ...world64, reserved: [{ x: 0, y: 0, columns: 4, rows: 4 }] };
    const occupied = [building('a', 0, 0)];
    expect(
      checkPlacement(world, occupied, { tileX: -1, tileY: 0, rotation: 0, footprint: two }).kind,
    ).toBe('out_of_bounds');
    expect(
      checkPlacement(world, occupied, { tileX: 0, tileY: 0, rotation: 0, footprint: two }).kind,
    ).toBe('reserved');
  });

  it('names every blocking building once, in the order given', () => {
    const occupied = [
      building('far', 40, 40),
      building('left', 8, 10),
      building('below', 10, 11, three),
      building('left', 8, 10), // duplicate entry: reported once
    ];
    expect(
      checkPlacement(world64, occupied, { tileX: 9, tileY: 9, rotation: 0, footprint: three }),
    ).toEqual({ kind: 'overlaps', blockingIds: ['left', 'below'] });
  });

  it('lets buildings stand edge to edge', () => {
    const occupied = [building('a', 10, 10), building('b', 14, 10)];
    expect(
      checkPlacement(world64, occupied, { tileX: 12, tileY: 10, rotation: 0, footprint: two }).kind,
    ).toBe('ok');
  });

  it('uses each building’s own rotation for its footprint', () => {
    // 'r' is 2×3 turned to 3×2: it covers x 10..12, y 10..11.
    const occupied = [building('r', 10, 10, tall, 90)];
    const check = (x: number, y: number) =>
      checkPlacement(world64, occupied, { tileX: x, tileY: y, rotation: 0, footprint: two }).kind;
    expect(check(12, 9)).toBe('overlaps');
    expect(check(10, 12)).toBe('ok'); // would overlap if 'r' were not turned
  });

  it('ignores the building being moved, but not the others', () => {
    const occupied = [building('me', 10, 10), building('other', 13, 10)];
    const move = (x: number) =>
      checkPlacement(world64, occupied, {
        tileX: x,
        tileY: 10,
        rotation: 0,
        footprint: two,
        placementId: 'me',
      });
    expect(move(11).kind).toBe('ok'); // overlaps only its own old tiles
    expect(move(12)).toEqual({ kind: 'overlaps', blockingIds: ['other'] });
  });

  it('accepts an exact-fit gap and refuses it for anything bigger', () => {
    const world: PlacementWorld = { gridWidth: 4, gridHeight: 4, reserved: [] };
    const occupied = fillWorld(world, [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ]);
    expect(
      checkPlacement(world, occupied, { tileX: 1, tileY: 1, rotation: 0, footprint: two }).kind,
    ).toBe('ok');
    expect(
      checkPlacement(world, occupied, { tileX: 1, tileY: 1, rotation: 0, footprint: three }).kind,
    ).toBe('overlaps');
  });
});

describe('findNearbyPlot (auto-place)', () => {
  const request = (
    tileX: number,
    tileY: number,
    footprint = two,
    rotation: PlacementRotation = 0,
  ) => ({ start: { tileX, tileY }, footprint, rotation }) as const;

  it('returns the start itself when it is free', () => {
    expect(findNearbyPlot(world64, [], request(20, 30))).toEqual({
      tileX: 20,
      tileY: 30,
      rotation: 0,
    });
  });

  it('searches the nearest ring first, top row first, left to right', () => {
    // A 2×2 at the start blocks anchors (x 9..11, y 9..11) for another 2×2; ring 1 is all
    // blocked, so the first ring-2 spot (top row, leftmost) wins.
    const occupied = [building('a', 10, 10)];
    expect(findNearbyPlot(world64, occupied, request(10, 10))).toEqual({
      tileX: 8,
      tileY: 8,
      rotation: 0,
    });
  });

  it('visits a ring in a fixed order', () => {
    // Leave exactly one ring-1 anchor free at a time and check each is found; then check the
    // order by leaving two free and expecting the earlier one.
    const world: PlacementWorld = { gridWidth: 3, gridHeight: 3, reserved: [] };
    const one: Footprint = { columns: 1, rows: 1 };
    const ringOrder: [number, number][] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [2, 1],
      [0, 2],
      [1, 2],
      [2, 2],
    ];
    for (let i = 0; i < ringOrder.length - 1; i++) {
      const [ax, ay] = ringOrder[i] as [number, number];
      const [bx, by] = ringOrder[i + 1] as [number, number];
      const occupied = fillWorld(world, [
        [bx, by],
        [ax, ay],
      ]);
      expect(findNearbyPlot(world, occupied, request(1, 1, one))).toEqual({
        tileX: ax,
        tileY: ay,
        rotation: 0,
      });
    }
  });

  it('finds an exact-fit gap far from the start', () => {
    const world: PlacementWorld = { gridWidth: 16, gridHeight: 16, reserved: [] };
    const occupied = fillWorld(world, [
      [13, 2],
      [14, 2],
      [13, 3],
      [14, 3],
    ]);
    expect(findNearbyPlot(world, occupied, request(0, 15))).toEqual({
      tileX: 13,
      tileY: 2,
      rotation: 0,
    });
    expect(findNearbyPlot(world, occupied, request(0, 15, three))).toBeNull();
  });

  it('returns null when the world is full', () => {
    const world: PlacementWorld = { gridWidth: 16, gridHeight: 16, reserved: [] };
    expect(findNearbyPlot(world, fillWorld(world), request(8, 8))).toBeNull();
  });

  it('returns null when the footprint is bigger than the world', () => {
    const tiny: PlacementWorld = { gridWidth: 3, gridHeight: 3, reserved: [] };
    expect(findNearbyPlot(tiny, [], request(0, 0, squareFootprint(4)))).toBeNull();
    // 2×3 fits a 2-wide, 3-deep world at 0 but not turned.
    const narrow: PlacementWorld = { gridWidth: 2, gridHeight: 3, reserved: [] };
    expect(findNearbyPlot(narrow, [], request(0, 0, tall, 0))).not.toBeNull();
    expect(findNearbyPlot(narrow, [], request(0, 0, tall, 90))).toBeNull();
  });

  it('starts from the nearest valid anchor when the start is off the map or not a number', () => {
    expect(findNearbyPlot(world64, [], request(-50, -50))).toEqual({
      tileX: 0,
      tileY: 0,
      rotation: 0,
    });
    expect(findNearbyPlot(world64, [], request(1e12, 1e12, three))).toEqual({
      tileX: 61,
      tileY: 61,
      rotation: 0,
    });
    expect(findNearbyPlot(world64, [], request(Number.NaN, 5))).toEqual({
      tileX: 0,
      tileY: 5,
      rotation: 0,
    });
  });

  it('avoids reserved areas', () => {
    const world = { ...world64, reserved: [{ x: 0, y: 0, columns: 5, rows: 5 }] };
    const spot = findNearbyPlot(world, [], request(0, 0));
    expect(spot).not.toBeNull();
    if (spot === null) return;
    expect(checkPlacement(world, [], { ...spot, footprint: two }).kind).toBe('ok');
  });

  it('can re-place a building over its own old tiles', () => {
    const occupied = [building('me', 10, 10)];
    expect(findNearbyPlot(world64, occupied, { ...request(10, 10), placementId: 'me' })).toEqual({
      tileX: 10,
      tileY: 10,
      rotation: 0,
    });
  });

  it('every returned spot passes checkPlacement, for every rotation', () => {
    // A crowded, irregular world: a deterministic scatter of 3×3 and 2×3 buildings.
    const world: PlacementWorld = {
      gridWidth: 32,
      gridHeight: 24,
      reserved: [{ x: 14, y: 10, columns: 4, rows: 4 }],
    };
    const occupied: OccupiedPlacement[] = [];
    for (let i = 0; i < 40; i++) {
      const x = (i * 7) % 30;
      const y = (i * 11) % 22;
      const candidate = building(`s${String(i)}`, x, y, i % 2 === 0 ? three : tall, 90);
      if (checkPlacement(world, occupied, candidate).kind === 'ok') occupied.push(candidate);
    }
    for (const rotation of PLACEMENT_ROTATIONS) {
      for (const [sx, sy] of [
        [0, 0],
        [16, 12],
        [31, 23],
      ] as const) {
        const spot = findNearbyPlot(world, occupied, request(sx, sy, tall, rotation));
        expect(spot).not.toBeNull();
        if (spot === null) continue;
        expect(checkPlacement(world, occupied, { ...spot, footprint: tall }).kind).toBe('ok');
      }
    }
  });

  it('gives the same answer every time (deterministic)', () => {
    const occupied = [building('a', 10, 10), building('b', 7, 12, three)];
    const first = findNearbyPlot(world64, occupied, request(10, 11));
    for (let i = 0; i < 5; i++) {
      expect(findNearbyPlot(world64, occupied, request(10, 11))).toEqual(first);
    }
  });

  it('stays fast in the largest world (256 × 256, nearly full)', () => {
    const world: PlacementWorld = { gridWidth: 256, gridHeight: 256, reserved: [] };
    // One 4×4 hole in a world of 4×4 buildings: auto-place must scan almost every anchor.
    const occupied: OccupiedPlacement[] = [];
    for (let y = 0; y < 256; y += 4) {
      for (let x = 0; x < 256; x += 4) {
        if (x === 252 && y === 252) continue;
        occupied.push(building(`b${String(x)}-${String(y)}`, x, y, squareFootprint(4)));
      }
    }
    const started = performance.now();
    const spot = findNearbyPlot(world, occupied, request(0, 0, squareFootprint(4)));
    const elapsed = performance.now() - started;
    expect(spot).toEqual({ tileX: 252, tileY: 252, rotation: 0 });
    // Generous bound for slow CI machines; the summed-area table makes this a few ms.
    expect(elapsed).toBeLessThan(1000);
  });

  it('throws for a rotation that is not a quarter turn (a bug, not user input)', () => {
    expect(() =>
      findNearbyPlot(world64, [], {
        start: { tileX: 0, tileY: 0 },
        footprint: two,
        rotation: 45 as PlacementRotation,
      }),
    ).toThrow(RangeError);
  });
});
