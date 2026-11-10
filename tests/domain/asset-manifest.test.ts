import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  generatePlaceholders,
  MANIFEST_PATH,
  manifestWithPlaceholders,
} from '../../scripts/generate-placeholder-art';
import {
  AssetManifest,
  footprintProblems,
  requireAsset,
  type AssetEntry,
} from '../../src/common/assets/asset-manifest';

const ROOT = join(import.meta.dirname, '..', '..');
const manifestText = readFileSync(join(ROOT, MANIFEST_PATH), 'utf8');
const manifest = AssetManifest.parse(JSON.parse(manifestText));

interface PngInfo {
  width: number;
  height: number;
  /** Decompressed scanlines (filter byte + RGBA per row). */
  raw: Buffer;
}

/** Minimal PNG reader for tests: checks the signature and every chunk CRC. */
function readPng(bytes: Buffer): PngInfo {
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const typeAndData = bytes.subarray(offset + 4, offset + 8 + length);
    const type = typeAndData.subarray(0, 4).toString('ascii');
    const data = typeAndData.subarray(4);
    expect(bytes.readUInt32BE(offset + 8 + length), `${type} CRC`).toBe(crc32(typeAndData));
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect([data[8], data[9]], 'RGBA, 8 bits per channel').toEqual([8, 6]);
    }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  return { width, height, raw: inflateSync(Buffer.concat(idat)) };
}

function entry(overrides: Partial<AssetEntry> = {}): AssetEntry {
  return {
    id: 'test.marker',
    version: 1,
    kind: 'marker',
    path: 'test/marker.png',
    width: 64,
    height: 32,
    pivot: { x: 32, y: 32 },
    footprint: { columns: 1, rows: 1 },
    sha256: 'a'.repeat(64),
    placeholder: true,
    provenance: 'test',
    ...overrides,
  };
}

function parseWith(...assets: AssetEntry[]) {
  return AssetManifest.safeParse({ schemaVersion: 1, tile: { width: 64, height: 32 }, assets });
}

describe('committed asset manifest', () => {
  it('uses the approved ART_BIBLE tile and lists the four M0-8 placeholders', () => {
    expect(manifest.tile).toEqual({ width: 64, height: 32 });
    expect(manifest.assets.map((asset) => asset.id)).toEqual([
      'placeholder.terrain.ground',
      'placeholder.building.2x2',
      'placeholder.marker.selection',
      'placeholder.marker.invalid',
    ]);
    expect(manifest.assets.every((asset) => asset.placeholder)).toBe(true);
  });

  it.each(manifest.assets.map((asset) => [asset.id, asset] as const))(
    '%s: the file exists and matches its size and digest',
    (_id, asset) => {
      const bytes = readFileSync(join(ROOT, 'resources', 'assets', asset.path));
      const png = readPng(bytes);
      expect({ width: png.width, height: png.height }).toEqual({
        width: asset.width,
        height: asset.height,
      });
      expect(png.raw.length).toBe((asset.width * 4 + 1) * asset.height);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
    },
  );

  it('places every placeholder pivot on the south corner of its footprint', () => {
    for (const asset of manifest.assets) {
      // Unpadded placeholders: the footprint's south corner is the bottom of the image, and
      // it sits columns × half a tile in from the left edge.
      expect(asset.pivot, asset.id).toEqual({
        x: (asset.footprint.columns * manifest.tile.width) / 2,
        y: asset.height,
      });
    }
  });

  it('is exactly what the generator draws (run `pnpm art:placeholders` if this fails)', () => {
    expect(manifestWithPlaceholders(manifestText)).toBe(manifestText);
    for (const { entry: generated, png } of generatePlaceholders()) {
      const committed = readFileSync(join(ROOT, 'resources', 'assets', generated.path));
      expect(committed.equals(png), generated.path).toBe(true);
    }
  });

  it('draws transparent corners and an opaque centre on the ground tile', () => {
    const asset = requireAsset(manifest, 'placeholder.terrain.ground');
    const { raw } = readPng(readFileSync(join(ROOT, 'resources', 'assets', asset.path)));
    const alphaAt = (x: number, y: number) => raw[y * (asset.width * 4 + 1) + 1 + x * 4 + 3];
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(asset.width - 1, asset.height - 1)).toBe(0);
    expect(alphaAt(asset.width / 2, asset.height / 2)).toBe(255);
  });
});

describe('manifestWithPlaceholders', () => {
  it('keeps non-placeholder assets that were added by hand', () => {
    const real = { ...entry({ id: 'fantasy.building.library' }), placeholder: false };
    const text = JSON.stringify({
      schemaVersion: 1,
      tile: { width: 64, height: 32 },
      assets: [real],
    });
    const result = AssetManifest.parse(JSON.parse(manifestWithPlaceholders(text)));
    expect(result.assets.map((asset) => asset.id)).toContain('fantasy.building.library');
    expect(result.assets).toHaveLength(5);
  });
});

describe('AssetManifest schema', () => {
  it('accepts a valid entry, including an animation strip', () => {
    expect(parseWith(entry()).success).toBe(true);
    const strip = entry({
      width: 256,
      animation: { frameWidth: 64, frameHeight: 32, frameCount: 4, frameDurationMs: 150 },
    });
    expect(parseWith(strip).success).toBe(true);
  });

  it.each([
    ['parent directory', '../outside.png'],
    ['nested parent directory', 'a/../../outside.png'],
    ['absolute path', '/assets/x.png'],
    ['drive letter', 'C:/assets/x.png'],
    ['backslashes', 'placeholders\\x.png'],
    ['not a PNG', 'placeholders/x.jpg'],
    ['upper case', 'Placeholders/X.png'],
    ['empty segment', 'placeholders//x.png'],
  ])('rejects a path with %s', (_label, path) => {
    expect(parseWith(entry({ path })).success).toBe(false);
  });

  it('rejects duplicate IDs and duplicate paths', () => {
    expect(parseWith(entry(), entry({ path: 'other.png' })).success).toBe(false);
    expect(parseWith(entry(), entry({ id: 'other' })).success).toBe(false);
  });

  it('rejects unknown fields, a bad digest and a wrong schema version', () => {
    expect(parseWith({ ...entry(), extra: 1 } as AssetEntry).success).toBe(false);
    expect(parseWith(entry({ sha256: 'ABC' })).success).toBe(false);
    expect(
      AssetManifest.safeParse({ schemaVersion: 2, tile: { width: 64, height: 32 }, assets: [] })
        .success,
    ).toBe(false);
  });

  it('rejects a pivot that hangs the footprint outside the image', () => {
    // A 2×2 footprint needs 64 px each side of the pivot and 64 px above it.
    expect(parseWith(entry({ footprint: { columns: 2, rows: 2 } })).success).toBe(false);
    expect(parseWith(entry({ pivot: { x: 32, y: 33 } })).success).toBe(false);
    expect(parseWith(entry({ pivot: { x: 31, y: 32 } })).success).toBe(false);
  });

  it('rejects animation frames that do not fit the image', () => {
    const animation = { frameWidth: 64, frameHeight: 32, frameCount: 5, frameDurationMs: 100 };
    expect(parseWith(entry({ width: 256, animation })).success).toBe(false);
    expect(
      parseWith(entry({ width: 250, animation: { ...animation, frameCount: 3 } })).success,
    ).toBe(false);
  });
});

describe('footprintProblems', () => {
  const tile = { width: 64, height: 32 };

  it('accepts a 3×2 footprint hung from its south corner', () => {
    // West reach 3 × 32 = 96, east reach 2 × 32 = 64, height (3 + 2) × 16 = 80.
    const asset = {
      width: 160,
      height: 120,
      pivot: { x: 96, y: 120 },
      footprint: { columns: 3, rows: 2 },
    };
    expect(footprintProblems(asset, tile)).toEqual([]);
    expect(footprintProblems({ ...asset, pivot: { x: 95, y: 120 } }, tile)).toEqual([
      'footprint west corner is left of the frame',
    ]);
    expect(footprintProblems({ ...asset, pivot: { x: 97, y: 120 } }, tile)).toEqual([
      'footprint east corner is right of the frame',
    ]);
  });

  it('reports a missing asset by ID', () => {
    expect(() => requireAsset(manifest, 'nope')).toThrow('nope');
  });
});
