// Comfort preferences (M2-14 #79, UI_SPEC §6.6, ADR-0028): reduced motion, building labels and
// the camera saved per world. They live in `profile_settings.preferences_json` under the
// `comfort` key, next to whatever later milestones add there.
//
// Shared by the main process (which reads and merges them) and the renderer (which uses the
// types and bounds). Pure: no DOM, no database.
import { z } from 'zod';

import { WorldId } from '../contracts/world';

/** UI_SPEC §6.2: zoom stays "within defined bounds". The renderer's projection uses these too. */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;

/** At most this many worlds keep a saved camera; the least recently saved is dropped first. */
export const MAX_SAVED_CAMERAS = 64;

/**
 * World pixels the saved centre may be from the origin. The largest map (256 × 256 tiles of
 * 64 × 32) reaches 8192, so this only rules out nonsense. The renderer clamps to the real map.
 */
const CENTRE_LIMIT = 100_000;

/** `system` follows the OS `prefers-reduced-motion` setting; `on`/`off` override it. */
export const ReducedMotionSetting = z.enum(['system', 'on', 'off']);
export type ReducedMotionSetting = z.infer<typeof ReducedMotionSetting>;

/**
 * Where the camera looked: the world point at the centre of the view, plus the zoom. Storing
 * the centre (not the raw pan) means a different window size still shows the same spot.
 */
export const SavedCamera = z.strictObject({
  centerX: z.number().min(-CENTRE_LIMIT).max(CENTRE_LIMIT),
  centerY: z.number().min(-CENTRE_LIMIT).max(CENTRE_LIMIT),
  zoom: z.number().min(ZOOM_MIN).max(ZOOM_MAX),
});
export type SavedCamera = z.infer<typeof SavedCamera>;

export const ComfortPreferences = z.strictObject({
  reducedMotion: ReducedMotionSetting,
  buildingLabels: z.boolean(),
  /** By world ID, least recently saved first. */
  cameras: z
    .record(WorldId, SavedCamera)
    .refine((cameras) => Object.keys(cameras).length <= MAX_SAVED_CAMERAS, 'too many cameras'),
});
export type ComfortPreferences = z.infer<typeof ComfortPreferences>;

export const DEFAULT_COMFORT: ComfortPreferences = {
  reducedMotion: 'system',
  buildingLabels: true,
  cameras: {},
};

/** One change. Omitted fields stay as they are; `camera` saves one world's camera. */
export const ComfortPatch = z
  .strictObject({
    reducedMotion: ReducedMotionSetting.optional(),
    buildingLabels: z.boolean().optional(),
    camera: z.strictObject({ worldId: WorldId, camera: SavedCamera }).optional(),
  })
  .refine(
    (patch) =>
      patch.reducedMotion !== undefined ||
      patch.buildingLabels !== undefined ||
      patch.camera !== undefined,
    'nothing to update',
  );
export type ComfortPatch = z.infer<typeof ComfortPatch>;

/** The key in `preferences_json` that holds the comfort preferences. */
export const COMFORT_KEY = 'comfort';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the comfort preferences out of a whole preferences object. Forgiving on purpose: the
 * stored JSON may be from an older or newer app, or hand-edited, so each field that doesn't
 * check out falls back to its default on its own, and a bad camera entry is dropped without
 * losing the others. It never throws.
 */
export function parseComfortPreferences(preferences: unknown): ComfortPreferences {
  const stored = isRecord(preferences) ? preferences[COMFORT_KEY] : undefined;
  if (!isRecord(stored)) return DEFAULT_COMFORT;

  const reducedMotion = ReducedMotionSetting.safeParse(stored['reducedMotion']);
  const buildingLabels = z.boolean().safeParse(stored['buildingLabels']);
  const entries: [string, SavedCamera][] = [];
  const rawCameras = stored['cameras'];
  if (isRecord(rawCameras)) {
    for (const [worldId, raw] of Object.entries(rawCameras)) {
      const camera = SavedCamera.safeParse(raw);
      if (WorldId.safeParse(worldId).success && camera.success)
        entries.push([worldId, camera.data]);
    }
  }
  return {
    reducedMotion: reducedMotion.success ? reducedMotion.data : DEFAULT_COMFORT.reducedMotion,
    buildingLabels: buildingLabels.success ? buildingLabels.data : DEFAULT_COMFORT.buildingLabels,
    // Keep the most recently saved ones when the stored list is over the cap.
    cameras: Object.fromEntries(entries.slice(-MAX_SAVED_CAMERAS)),
  };
}

/** Rounds to `places` decimals, so saved cameras stay short in the 16 KiB preferences. */
function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Applies one change. A saved camera moves its world to the end (most recent), and the
 * oldest entries beyond MAX_SAVED_CAMERAS are dropped.
 */
export function applyComfortPatch(
  current: ComfortPreferences,
  patch: ComfortPatch,
): ComfortPreferences {
  let cameras = current.cameras;
  if (patch.camera !== undefined) {
    const { worldId, camera } = patch.camera;
    const others = Object.entries(cameras).filter(([id]) => id !== worldId);
    const saved: SavedCamera = {
      centerX: round(camera.centerX, 2),
      centerY: round(camera.centerY, 2),
      zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, round(camera.zoom, 6))),
    };
    cameras = Object.fromEntries([...others, [worldId, saved] as const].slice(-MAX_SAVED_CAMERAS));
  }
  return {
    reducedMotion: patch.reducedMotion ?? current.reducedMotion,
    buildingLabels: patch.buildingLabels ?? current.buildingLabels,
    cameras,
  };
}

/** Writes comfort preferences back into a whole preferences object, keeping its other keys. */
export function withComfort(
  preferences: Readonly<Record<string, unknown>>,
  comfort: ComfortPreferences,
): Record<string, unknown> {
  return { ...preferences, [COMFORT_KEY]: comfort };
}
