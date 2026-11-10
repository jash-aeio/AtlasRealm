// Draws the engineering placeholder sprites and their manifest entries (M0-8, #11).
//
//   pnpm art:placeholders           write resources/assets/placeholders/** and update the manifest
//   pnpm art:placeholders --check   exit 1 if the committed files differ from what this draws
//
// Why code instead of an image editor: the output is the same bytes on every machine, so the
// SHA-256 digests in the manifest stay stable and a test can prove the files are current. No
// PixelLab account or image library is needed; PNG encoding uses only node:zlib.
//
// The art follows the ART_BIBLE contract: 64 × 32 tiles, 2:1 pixel stepping on diamond edges,
// light from the upper left, the bounded palette below, and the ground pivot on the south
// corner of the footprint. Node runs this file directly (type stripping), so it imports nothing
// from src/; tests validate its output against the Zod schema instead.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

/** ART_BIBLE palette "warm storybook village" (approved 2026-11-10). RGB hex. */
export const PALETTE = {
  grassDark: 0x2f4a32,
  grass: 0x4f7a3f,
  grassLight: 0x7fa55a,
  timberDark: 0x4a3220,
  timber: 0x7a5230,
  timberLight: 0xa87a4a,
  stoneDark: 0x46505e,
  stone: 0x7d8794,
  stoneLight: 0xb4bcc4,
  clay: 0x8e3b2e,
  lantern: 0xf2c14e,
  parchment: 0xefe2bf,
  ink: 0x1d1f26,
  arcane: 0x6bc6f2,
  arcaneLight: 0xe8f6ff,
  warning: 0xd9483b,
} as const;

export const TILE = { width: 64, height: 32 } as const;
export const MANIFEST_PATH = 'resources/assets/asset-manifest.json';
const ASSETS_DIR = 'resources/assets';
const PROVENANCE = 'docs/art/ASSET_PROVENANCE.md#generated-placeholders';

/** An RGBA image, 4 bytes per pixel, rows top to bottom. */
// Plain fields, not constructor parameter properties: Node's type stripping can't run those.
class Image {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 4);
  }

  set(x: number, y: number, rgb: number, alpha = 255): void {
    const at = (y * this.width + x) * 4;
    this.pixels[at] = (rgb >> 16) & 0xff;
    this.pixels[at + 1] = (rgb >> 8) & 0xff;
    this.pixels[at + 2] = rgb & 0xff;
    this.pixels[at + 3] = alpha;
  }
}

/** A function telling which region a pixel belongs to (null = transparent). */
type Regions = (x: number, y: number) => string | null;

/**
 * Inside test for a diamond, using the pixel centre. With a 2:1 diamond this gives the clean
 * "two across, one down" stair steps pixel art uses for isometric edges.
 */
function inDiamond(x: number, y: number, cx: number, cy: number, halfW: number, halfH: number) {
  return Math.abs(x + 0.5 - cx) / halfW + Math.abs(y + 0.5 - cy) / halfH <= 1;
}

/** True when a pixel's region differs from one of its four neighbours: an outline pixel. */
function isEdge(regions: Regions, x: number, y: number, width: number, height: number): boolean {
  const own = regions(x, y);
  const neighbour = (nx: number, ny: number) =>
    nx < 0 || ny < 0 || nx >= width || ny >= height ? null : regions(nx, ny);
  return [neighbour(x - 1, y), neighbour(x + 1, y), neighbour(x, y - 1), neighbour(x, y + 1)].some(
    (other) => other !== own,
  );
}

/** Small deterministic hash for scattering grass tufts (no Math.random: output must be stable). */
function hash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

const tileRegions: Regions = (x, y) =>
  inDiamond(x, y, TILE.width / 2, TILE.height / 2, TILE.width / 2, TILE.height / 2) ? 'tile' : null;

function groundTile(): Image {
  const image = new Image(TILE.width, TILE.height);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (tileRegions(x, y) === null) continue;
      if (isEdge(tileRegions, x, y, image.width, image.height)) image.set(x, y, PALETTE.grassDark);
      else if (hash(x, y) % 23 === 0) image.set(x, y, PALETTE.grassLight);
      else image.set(x, y, PALETTE.grass);
    }
  }
  return image;
}

function selectionMarker(): Image {
  const image = new Image(TILE.width, TILE.height);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (tileRegions(x, y) === null) continue;
      const edge = isEdge(tileRegions, x, y, image.width, image.height);
      image.set(x, y, edge ? PALETTE.arcaneLight : PALETTE.arcane);
    }
  }
  return image;
}

/** Red outline with diagonal hatching: readable without relying on colour alone. */
function invalidMarker(): Image {
  const image = new Image(TILE.width, TILE.height);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (tileRegions(x, y) === null) continue;
      if (isEdge(tileRegions, x, y, image.width, image.height)) image.set(x, y, PALETTE.warning);
      else if ((x + 2 * y) % 8 < 2) image.set(x, y, PALETTE.warning);
      else image.set(x, y, PALETTE.warning, 96);
    }
  }
  return image;
}

/**
 * A 2×2-tile block: a 128 × 64 footprint diamond with 64 px walls, so the image is 128 × 128
 * and the south corner (pivot) is at (64, 128). Light from the upper left: the left (south-west)
 * wall is lit, the right (south-east) wall is in shade, and the roof is the top face.
 */
const BUILDING = { width: 128, height: 128, wall: 64 } as const;

const buildingRegions: Regions = (x, y) => {
  const px = x + 0.5;
  const py = y + 0.5;
  const half = BUILDING.width / 2; // 64
  if (inDiamond(x, y, half, half / 2, half, half / 2)) return 'roof';
  // Wall top edges run from the west/east corners down to the south corner of the roof.
  if (px < half && py >= half / 2 + px / 2 && py <= half / 2 + BUILDING.wall + px / 2) {
    return 'left';
  }
  if (px >= half && py >= half - (px - half) / 2 && py <= half + BUILDING.wall - (px - half) / 2) {
    return 'right';
  }
  return null;
};

function building2x2(): Image {
  const image = new Image(BUILDING.width, BUILDING.height);
  const fill: Record<string, number> = {
    roof: PALETTE.clay,
    left: PALETTE.timberLight,
    right: PALETTE.timber,
  };
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const region = buildingRegions(x, y);
      if (region === null) continue;
      if (isEdge(buildingRegions, x, y, image.width, image.height)) {
        image.set(x, y, PALETTE.ink);
        continue;
      }
      // One lantern-lit window per wall, slanted with the wall (a parallelogram).
      const wallX = region === 'left' ? x : BUILDING.width - 1 - x;
      const wallTop = BUILDING.width / 4 + wallX / 2;
      const inWindow = wallX >= 20 && wallX < 36 && y >= wallTop + 20 && y < wallTop + 36;
      const colour = fill[region];
      if (colour === undefined) throw new Error(`no colour for region ${region}`);
      image.set(x, y, region !== 'roof' && inWindow ? PALETTE.lantern : colour);
    }
  }
  return image;
}

/** Encodes RGBA pixels as a PNG: signature, IHDR, one IDAT, IEND (PNG spec §5, §11). */
export function encodePng(image: Image): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([length, typeAndData, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // Bytes 10–12 stay 0: deflate compression, adaptive filtering, no interlace.
  const rowBytes = image.width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * image.height);
  for (let y = 0; y < image.height; y++) {
    // Each row starts with its filter type; 0 = none keeps the encoder simple.
    raw[y * (rowBytes + 1)] = 0;
    raw.set(image.pixels.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

interface PlaceholderSpec {
  id: string;
  kind: 'terrain' | 'building' | 'marker';
  path: string;
  pivot: { x: number; y: number };
  footprint: { columns: number; rows: number };
  draw: () => Image;
}

const SPECS: readonly PlaceholderSpec[] = [
  {
    id: 'placeholder.terrain.ground',
    kind: 'terrain',
    path: 'placeholders/terrain/ground.png',
    pivot: { x: 32, y: 32 },
    footprint: { columns: 1, rows: 1 },
    draw: groundTile,
  },
  {
    id: 'placeholder.building.2x2',
    kind: 'building',
    path: 'placeholders/buildings/building-2x2.png',
    pivot: { x: 64, y: 128 },
    footprint: { columns: 2, rows: 2 },
    draw: building2x2,
  },
  {
    id: 'placeholder.marker.selection',
    kind: 'marker',
    path: 'placeholders/markers/selection.png',
    pivot: { x: 32, y: 32 },
    footprint: { columns: 1, rows: 1 },
    draw: selectionMarker,
  },
  {
    id: 'placeholder.marker.invalid',
    kind: 'marker',
    path: 'placeholders/markers/invalid.png',
    pivot: { x: 32, y: 32 },
    footprint: { columns: 1, rows: 1 },
    draw: invalidMarker,
  },
];

export interface GeneratedPlaceholder {
  /** The manifest entry, in the field order the manifest uses. */
  entry: Record<string, unknown> & { id: string; path: string };
  png: Buffer;
}

/** Draws every placeholder in memory. Pure: same output every run. */
export function generatePlaceholders(): GeneratedPlaceholder[] {
  return SPECS.map((spec) => {
    const image = spec.draw();
    const png = encodePng(image);
    return {
      png,
      entry: {
        id: spec.id,
        version: 1,
        kind: spec.kind,
        path: spec.path,
        width: image.width,
        height: image.height,
        pivot: spec.pivot,
        footprint: spec.footprint,
        sha256: createHash('sha256').update(png).digest('hex'),
        placeholder: true,
        provenance: PROVENANCE,
      },
    };
  });
}

/**
 * The manifest text with the placeholder entries replaced and every other entry kept, so this
 * script never removes real (e.g. PixelLab) assets added later.
 */
export function manifestWithPlaceholders(currentText: string | null): string {
  const current = currentText === null ? null : (JSON.parse(currentText) as unknown);
  const others =
    current !== null && typeof current === 'object' && 'assets' in current
      ? (current.assets as { id: string }[]).filter((asset) => !asset.id.startsWith('placeholder.'))
      : [];
  const manifest = {
    schemaVersion: 1,
    tile: TILE,
    assets: [...generatePlaceholders().map((generated) => generated.entry), ...others],
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function readOrNull(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

function main(check: boolean): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const manifestPath = join(root, MANIFEST_PATH);
  const currentManifest = readOrNull(manifestPath)?.toString('utf8') ?? null;
  const outputs = [
    ...generatePlaceholders().map(({ entry, png }) => ({
      path: join(root, ASSETS_DIR, entry.path),
      bytes: png,
    })),
    { path: manifestPath, bytes: Buffer.from(manifestWithPlaceholders(currentManifest), 'utf8') },
  ];
  const stale = outputs.filter(({ path, bytes }) => !readOrNull(path)?.equals(bytes));
  if (check) {
    for (const { path } of stale) console.error(`out of date: ${path}`);
    if (stale.length > 0) {
      console.error('Run `pnpm art:placeholders` and commit the result.');
      process.exit(1);
    }
    console.log('Placeholder art is up to date.');
    return;
  }
  for (const { path, bytes } of stale) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    console.log(`wrote ${path}`);
  }
  if (stale.length === 0) console.log('Placeholder art is already up to date.');
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  main(process.argv.includes('--check'));
}
