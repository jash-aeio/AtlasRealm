// Comfort preference parsing and merging (M2-14 #79, ADR-0028). The stored JSON can come from
// any app version or a hand edit, so parsing must fall back field by field and never throw.
import { describe, expect, it } from 'vitest';

import {
  applyComfortPatch,
  ComfortPatch,
  ComfortPreferences,
  DEFAULT_COMFORT,
  MAX_SAVED_CAMERAS,
  parseComfortPreferences,
  withComfort,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../../src/common/preferences/comfort';

const WORLD_A = '11111111-1111-4111-8111-111111111111';
const WORLD_B = '22222222-2222-4222-8222-222222222222';
const camera = { centerX: 10, centerY: 20, zoom: 1 };

/** A distinct valid world ID for index `n`. */
function worldId(n: number): string {
  return `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
}

describe('parseComfortPreferences', () => {
  it('gives the defaults for empty or non-object preferences', () => {
    for (const raw of [{}, null, undefined, 'x', 42, [], { comfort: null }, { comfort: [] }]) {
      expect(parseComfortPreferences(raw)).toEqual(DEFAULT_COMFORT);
    }
  });

  it('defaults to following the OS for motion and showing labels', () => {
    expect(DEFAULT_COMFORT).toEqual({ reducedMotion: 'system', buildingLabels: true, cameras: {} });
  });

  it('reads valid stored values', () => {
    const stored = {
      comfort: { reducedMotion: 'on', buildingLabels: false, cameras: { [WORLD_A]: camera } },
    };
    expect(parseComfortPreferences(stored)).toEqual({
      reducedMotion: 'on',
      buildingLabels: false,
      cameras: { [WORLD_A]: camera },
    });
  });

  it('falls back field by field, keeping the fields that are fine', () => {
    const stored = { comfort: { reducedMotion: 'sometimes', buildingLabels: false } };
    expect(parseComfortPreferences(stored)).toEqual({
      reducedMotion: 'system',
      buildingLabels: false,
      cameras: {},
    });
    expect(parseComfortPreferences({ comfort: { buildingLabels: 'no' } }).buildingLabels).toBe(
      true,
    );
  });

  it('drops bad camera entries without losing the good ones', () => {
    const stored = {
      comfort: {
        cameras: {
          [WORLD_A]: camera,
          'not-a-world': camera,
          [WORLD_B]: { centerX: 1, centerY: 2, zoom: 99 },
          [worldId(3)]: { centerX: 'left', centerY: 0, zoom: 1 },
          [worldId(4)]: { ...camera, extra: true },
          [worldId(5)]: { centerX: 1e9, centerY: 0, zoom: 1 },
        },
      },
    };
    expect(parseComfortPreferences(stored).cameras).toEqual({ [WORLD_A]: camera });
  });

  it('keeps only the most recent cameras when the stored list is over the cap', () => {
    const cameras = Object.fromEntries(
      Array.from({ length: MAX_SAVED_CAMERAS + 3 }, (_, n) => [worldId(n), camera]),
    );
    const parsed = parseComfortPreferences({ comfort: { cameras } }).cameras;
    expect(Object.keys(parsed)).toHaveLength(MAX_SAVED_CAMERAS);
    expect(parsed[worldId(0)]).toBeUndefined();
    expect(parsed[worldId(MAX_SAVED_CAMERAS + 2)]).toEqual(camera);
  });

  it('always returns something the output schema accepts', () => {
    const odd = { comfort: { reducedMotion: 1, buildingLabels: null, cameras: 'x', more: 1 } };
    expect(ComfortPreferences.safeParse(parseComfortPreferences(odd)).success).toBe(true);
  });
});

describe('ComfortPatch', () => {
  it('needs at least one change', () => {
    expect(ComfortPatch.safeParse({}).success).toBe(false);
    expect(ComfortPatch.safeParse({ buildingLabels: false }).success).toBe(true);
  });

  it('refuses unknown fields, bad values and out-of-range cameras', () => {
    for (const bad of [
      { theme: 'dark' },
      { reducedMotion: 'maybe' },
      { camera: { worldId: 'nope', camera } },
      { camera: { worldId: WORLD_A, camera: { ...camera, zoom: ZOOM_MAX * 2 } } },
      { camera: { worldId: WORLD_A, camera: { ...camera, centerX: Number.POSITIVE_INFINITY } } },
    ]) {
      expect(ComfortPatch.safeParse(bad).success).toBe(false);
    }
  });
});

describe('applyComfortPatch', () => {
  it('changes only the fields given', () => {
    const next = applyComfortPatch(DEFAULT_COMFORT, { reducedMotion: 'off' });
    expect(next).toEqual({ ...DEFAULT_COMFORT, reducedMotion: 'off' });
  });

  it('saves a camera, moving its world to the most recent end', () => {
    let prefs = applyComfortPatch(DEFAULT_COMFORT, { camera: { worldId: WORLD_A, camera } });
    prefs = applyComfortPatch(prefs, { camera: { worldId: WORLD_B, camera } });
    prefs = applyComfortPatch(prefs, {
      camera: { worldId: WORLD_A, camera: { ...camera, zoom: 2 } },
    });
    expect(Object.keys(prefs.cameras)).toEqual([WORLD_B, WORLD_A]);
    expect(prefs.cameras[WORLD_A]?.zoom).toBe(2);
  });

  it('drops the least recently saved camera beyond the cap', () => {
    let prefs = DEFAULT_COMFORT;
    for (let n = 0; n <= MAX_SAVED_CAMERAS; n++) {
      prefs = applyComfortPatch(prefs, { camera: { worldId: worldId(n), camera } });
    }
    expect(Object.keys(prefs.cameras)).toHaveLength(MAX_SAVED_CAMERAS);
    expect(prefs.cameras[worldId(0)]).toBeUndefined();
    expect(prefs.cameras[worldId(MAX_SAVED_CAMERAS)]).toEqual(camera);
  });

  it('rounds saved cameras so they stay short, keeping zoom in bounds', () => {
    const prefs = applyComfortPatch(DEFAULT_COMFORT, {
      camera: {
        worldId: WORLD_A,
        camera: { centerX: 1.23456789, centerY: -9.87654321, zoom: ZOOM_MIN + 0.00001 },
      },
    });
    expect(prefs.cameras[WORLD_A]).toEqual({ centerX: 1.23, centerY: -9.88, zoom: ZOOM_MIN });
  });

  it('round-trips through the stored form, keeping other preference keys', () => {
    const comfort = applyComfortPatch(DEFAULT_COMFORT, {
      buildingLabels: false,
      camera: { worldId: WORLD_A, camera },
    });
    const stored = withComfort({ futureThing: { a: 1 } }, comfort);
    expect(stored['futureThing']).toEqual({ a: 1 });
    expect(parseComfortPreferences(JSON.parse(JSON.stringify(stored)))).toEqual(comfort);
  });
});
