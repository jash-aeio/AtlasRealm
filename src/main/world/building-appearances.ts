// Building appearances as the main process sees them (M2-3 #68, ADR-0025).
//
// The placement commands need each building's footprint to check collisions. The footprint
// must come from the trusted, bundled asset manifest, never from an IPC payload: a forged
// `{ columns: 1, rows: 1 }` would let a big building squeeze into a gap (#66 security L2).
// The manifest is imported at build time, so this works offline and reads no files at run time.
import manifestJson from '../../../resources/assets/asset-manifest.json';
import { AssetManifest } from '../../common/assets/asset-manifest';
import {
  BUILDING_SIZES,
  type Footprint,
  squareFootprint,
} from '../../common/world/placement-rules';

/** The art every new building gets until users can choose one (no picker is planned in M2). */
export const DEFAULT_BUILDING_APPEARANCE = 'placeholder.building.2x2';

/**
 * What a stored building counts as when its appearance is no longer in the manifest (art
 * renamed or removed). Fail closed: the largest building size (ADR-0013), so nothing can be
 * placed on top of it, while the rest of the world keeps working (#66 security L3, user
 * decision 2026-11-21).
 */
export const UNKNOWN_APPEARANCE_FOOTPRINT: Footprint = squareFootprint(
  BUILDING_SIZES[BUILDING_SIZES.length - 1] ?? 4,
);

export class BuildingAppearances {
  private readonly footprints: ReadonlyMap<string, Footprint>;
  private readonly warned = new Set<string>();

  constructor(
    manifest: AssetManifest,
    private readonly warn: (message: string) => void = (message) => {
      console.warn(message);
    },
  ) {
    // Only `building` entries count: a terrain tile or a marker is not a building.
    this.footprints = new Map(
      manifest.assets
        .filter((asset) => asset.kind === 'building')
        .map((asset) => [asset.id, { ...asset.footprint }]),
    );
    // A missing default is a build bug: fail at startup, not on the first placement.
    if (!this.footprints.has(DEFAULT_BUILDING_APPEARANCE)) {
      throw new Error(`Default building appearance ${DEFAULT_BUILDING_APPEARANCE} is missing.`);
    }
  }

  /** The bundled manifest, parsed and checked once. */
  static bundled(): BuildingAppearances {
    return new BuildingAppearances(AssetManifest.parse(manifestJson));
  }

  get defaultId(): string {
    return DEFAULT_BUILDING_APPEARANCE;
  }

  /**
   * The footprint of a building appearance. An ID that doesn't resolve counts as
   * UNKNOWN_APPEARANCE_FOOTPRINT, with one warning per ID (so a damaged world doesn't flood
   * the log on every check).
   */
  footprintOf(appearanceId: string): Footprint {
    const footprint = this.footprints.get(appearanceId);
    if (footprint !== undefined) return footprint;
    if (!this.warned.has(appearanceId)) {
      this.warned.add(appearanceId);
      this.warn(
        // Quoted and cut short: the ID comes from the database, and a damaged row must not be
        // able to forge log lines.
        `[placement] Building appearance ${JSON.stringify(appearanceId.slice(0, 100))} is not in the asset manifest; ` +
          `treating it as ${String(UNKNOWN_APPEARANCE_FOOTPRINT.columns)}×` +
          `${String(UNKNOWN_APPEARANCE_FOOTPRINT.rows)} for collisions.`,
      );
    }
    return UNKNOWN_APPEARANCE_FOOTPRINT;
  }
}
