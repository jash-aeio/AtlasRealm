// Bundled world art: the asset manifest plus the built URL of each image (M0-8, #11).
//
// Vite copies every PNG under resources/assets into the build as a real file (inlining is off
// in electron.vite.config.ts) and gives us its URL, so the packaged app serves the art from
// app://atlas like the rest of the UI, offline, and the manifest paths match shipped files.
import manifestJson from '../../../resources/assets/asset-manifest.json';
import { AssetManifest, requireAsset, type AssetEntry } from '../../common/assets/asset-manifest';

const ASSET_URLS = import.meta.glob<string>('../../../resources/assets/**/*.png', {
  query: '?url',
  import: 'default',
  eager: true,
});

/** Parsed on first use, then reused. A broken manifest is a build bug, so it fails loudly. */
let manifest: AssetManifest | undefined;
function loadManifest(): AssetManifest {
  manifest ??= AssetManifest.parse(manifestJson);
  return manifest;
}

export interface WorldSprite {
  readonly id: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  /** Ground pivot in image pixels: the south corner of the footprint. */
  readonly pivot: AssetEntry['pivot'];
  readonly footprint: AssetEntry['footprint'];
}

/** Looks up a manifest entry and its built URL. Throws if either is missing. */
export function worldSprite(id: string): WorldSprite {
  const asset = requireAsset(loadManifest(), id);
  const url = ASSET_URLS[`../../../resources/assets/${asset.path}`];
  if (url === undefined) throw new Error(`Asset ${id}: ${asset.path} was not bundled`);
  return {
    id,
    url,
    width: asset.width,
    height: asset.height,
    pivot: asset.pivot,
    footprint: asset.footprint,
  };
}

/** The sprites the world draws besides building appearances. */
export const WORLD_SPRITES = {
  selection: 'placeholder.marker.selection',
  /** The placement preview's "can't stand here" tile marker (M2-7). */
  invalid: 'placeholder.marker.invalid',
} as const;

/**
 * Every bundled building appearance. The world loads these once at startup; a placement whose
 * appearance isn't here is drawn as "Missing art" (ADR-0025: lost art keeps its 4×4 footprint).
 */
export function buildingSprites(): WorldSprite[] {
  return loadManifest()
    .assets.filter((asset) => asset.kind === 'building')
    .map((asset) => worldSprite(asset.id));
}

/** A building appearance as the library lists it (M2-9): its sprite and whether it's placeholder art. */
export interface BuildingAppearance {
  readonly sprite: WorldSprite;
  /** True for engineering placeholders, which the UI must label as such. */
  readonly placeholder: boolean;
}

/** Every bundled building appearance, with its placeholder flag from the manifest. */
export function buildingAppearances(): BuildingAppearance[] {
  return loadManifest()
    .assets.filter((asset) => asset.kind === 'building')
    .map((asset) => ({ sprite: worldSprite(asset.id), placeholder: asset.placeholder }));
}

/** ART_BIBLE palette swatches the world's drawn shapes use (scripts/generate-placeholder-art.ts). */
export const WORLD_COLOURS = {
  background: 0x1d1f26, // ink
  ground: 0x4f7a3f, // grass
  gridLine: 0x2f4a32, // grass dark
  hover: 0xf2c14e, // lantern
  marker: 0xa87a4a, // timber light
  markerLine: 0x4a3220, // timber dark
  stone: 0x7d8794,
  stoneDark: 0x46505e,
  stoneLight: 0xb4bcc4,
  ink: 0x1d1f26,
  parchment: 0xefe2bf,
  selection: 0x6bc6f2, // arcane
  selectionEdge: 0xe8f6ff, // arcane light
} as const;
