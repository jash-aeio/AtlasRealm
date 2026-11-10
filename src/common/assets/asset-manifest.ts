// Schema for resources/assets/asset-manifest.json (ART_BIBLE §34.3 and §34.5, M0-8 #11).
//
// The manifest is the single list of bundled art: where each file lives, how big it is,
// where its ground pivot is and which footprint it covers. The world places sprites from these
// numbers, so a wrong entry is a wrong picture. Tests check every entry against its file.
//
// Coordinates are image pixels measured from the top-left corner. The ground pivot is the
// south corner of the footprint diamond (the corner nearest the viewer), decided with the user
// on 2026-11-10. A sprite is drawn so that its pivot lands on that corner of its grid footprint.
import { z } from 'zod';

/** Bump when the manifest shape changes in a way old readers can't handle. */
export const ASSET_MANIFEST_SCHEMA_VERSION = 1;

/** Lowercase words joined by dots or dashes, e.g. `placeholder.marker.selection`. */
const AssetId = z
  .string()
  .max(100)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, 'lowercase words joined by "." or "-"');

/**
 * A path relative to resources/assets, with forward slashes, ending in `.png`. Absolute paths,
 * drive letters, backslashes and `..` are refused, so an entry can never point outside the
 * assets folder (bundled files today, imported packs later). Windows device names such as
 * `nul` or `aux` are refused too: Windows opens a device for them, even with an extension.
 * Lowercase-only also stops two entries differing just by case on a case-insensitive drive.
 */
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/;
const AssetPath = z
  .string()
  .max(200)
  .regex(/^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*\.png$/, 'relative lowercase .png path')
  .refine(
    (path) =>
      path.split('/').every((segment) => !WINDOWS_DEVICE_NAME.test(segment.split('.')[0] ?? '')),
    'reserved Windows device name',
  );

// Upper bounds keep a hostile (imported) manifest from demanding huge memory or textures
// (SECURITY.md: untrusted input is size-bounded). 4096 px is a common GPU texture limit.
const Pixels = z.int().positive().max(4096);
const Size = z.strictObject({ width: Pixels, height: Pixels });
const Point = z.strictObject({ x: z.int().nonnegative(), y: z.int().nonnegative() });

export const AssetKind = z.enum(['terrain', 'building', 'marker']);
export type AssetKind = z.infer<typeof AssetKind>;

/** Equal-sized frames laid out left to right, top to bottom. The pivot is per frame. */
const Animation = z.strictObject({
  frameWidth: Pixels,
  frameHeight: Pixels,
  frameCount: z.int().positive().max(256),
  frameDurationMs: z.int().positive().max(60_000),
});

const AssetEntry = z.strictObject({
  id: AssetId,
  /** Raised whenever the image changes, so caches and saved references can tell. */
  version: z.int().positive().max(1_000_000),
  kind: AssetKind,
  path: AssetPath,
  width: Pixels,
  height: Pixels,
  pivot: Point,
  /** Grid tiles covered on the ground: columns along gx, rows along gy. */
  footprint: z.strictObject({
    columns: z.int().positive().max(16),
    rows: z.int().positive().max(16),
  }),
  animation: Animation.optional(),
  /** Lowercase hex SHA-256 of the file: detects a changed or corrupted file. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** True for engineering placeholders; the UI and docs must label them as such. */
  placeholder: z.boolean(),
  /** Where the source and terms are recorded, e.g. a section of docs/art/ASSET_PROVENANCE.md. */
  provenance: z.string().min(1).max(500),
});
export type AssetEntry = z.infer<typeof AssetEntry>;

export const AssetManifest = z
  .strictObject({
    schemaVersion: z.literal(ASSET_MANIFEST_SCHEMA_VERSION),
    /** The world's ground tile in logical pixels (ART_BIBLE: 64 × 32). */
    tile: Size,
    assets: z.array(AssetEntry).max(2000),
  })
  .superRefine((manifest, ctx) => {
    const ids = new Set<string>();
    const paths = new Set<string>();
    manifest.assets.forEach((asset, index) => {
      const at = (key: string) => ['assets', index, key];
      if (ids.has(asset.id))
        ctx.addIssue({ code: 'custom', path: at('id'), message: 'duplicate id' });
      if (paths.has(asset.path)) {
        ctx.addIssue({ code: 'custom', path: at('path'), message: 'duplicate path' });
      }
      ids.add(asset.id);
      paths.add(asset.path);
      for (const problem of footprintProblems(asset, manifest.tile)) {
        ctx.addIssue({ code: 'custom', path: at('pivot'), message: problem });
      }
    });
  });
export type AssetManifest = z.infer<typeof AssetManifest>;

/** The size of one drawn image: the whole file, or one animation frame. */
export function frameSize(asset: Pick<AssetEntry, 'width' | 'height' | 'animation'>): {
  width: number;
  height: number;
} {
  return asset.animation === undefined
    ? { width: asset.width, height: asset.height }
    : { width: asset.animation.frameWidth, height: asset.animation.frameHeight };
}

/**
 * Checks that the footprint diamond, hung from the pivot, fits inside the frame, and that the
 * animation frames fit inside the image. Returns plain-language problems (empty = fine).
 *
 * With the south corner at the pivot, a footprint of `columns × rows` tiles reaches
 * `columns × tile.width / 2` to the left (west corner), `rows × tile.width / 2` to the right
 * (east corner) and `(columns + rows) × tile.height / 2` up (north corner).
 */
export function footprintProblems(
  asset: Pick<AssetEntry, 'width' | 'height' | 'pivot' | 'footprint' | 'animation'>,
  tile: { width: number; height: number },
): string[] {
  const problems: string[] = [];
  const frame = frameSize(asset);
  const { columns, rows } = asset.footprint;
  const { x, y } = asset.pivot;
  if (x - (columns * tile.width) / 2 < 0)
    problems.push('footprint west corner is left of the frame');
  if (x + (rows * tile.width) / 2 > frame.width) {
    problems.push('footprint east corner is right of the frame');
  }
  if (y - ((columns + rows) * tile.height) / 2 < 0)
    problems.push('footprint north corner is above the frame');
  if (y > frame.height) problems.push('pivot is below the frame');
  if (asset.animation !== undefined) {
    const { frameWidth, frameHeight, frameCount } = asset.animation;
    const slots = Math.floor(asset.width / frameWidth) * Math.floor(asset.height / frameHeight);
    if (asset.width % frameWidth !== 0 || asset.height % frameHeight !== 0) {
      problems.push('image size is not a whole number of frames');
    }
    if (frameCount > slots) problems.push('more frames than fit in the image');
  }
  return problems;
}

/** Finds an asset by ID, or throws: bundled art referenced by code must exist. */
export function requireAsset(manifest: AssetManifest, id: string): AssetEntry {
  const asset = manifest.assets.find((entry) => entry.id === id);
  if (asset === undefined) throw new Error(`Asset ${id} is not in the asset manifest`);
  return asset;
}
