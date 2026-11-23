// Realm Atlas view preferences: parsing and merging (M2-12 #77, ADR-0031). Like the comfort
// preferences, stored JSON can come from any app version or a hand edit, so parsing falls back
// field by field and never throws.
import { describe, expect, it } from 'vitest';

import {
  applyAtlasViewChange,
  ATLAS_WIDTH_MAX,
  ATLAS_WIDTH_MIN,
  AtlasViewChange,
  AtlasViews,
  atlasViewOf,
  DEFAULT_ATLAS_VIEW,
  MAX_ATLAS_VIEWS,
  parseAtlasViews,
  withAtlasViews,
} from '../../src/common/preferences/atlas-view';
import {
  applyComfortPatch,
  DEFAULT_COMFORT,
  MAX_SAVED_CAMERAS,
  withComfort,
} from '../../src/common/preferences/comfort';
import { LIMITS } from '../../src/main/storage/repositories/repository-support';

const WORLD_A = '11111111-1111-4111-8111-111111111111';
const WORLD_B = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';

/** A distinct valid UUID for index `n`. */
function uuid(n: number): string {
  return `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
}

describe('parseAtlasViews', () => {
  it('gives no views for empty or non-object preferences', () => {
    for (const raw of [
      {},
      null,
      undefined,
      'x',
      42,
      [],
      { atlasViews: null },
      { atlasViews: [] },
    ]) {
      expect(parseAtlasViews(raw)).toEqual({});
    }
  });

  it('starts on the Map tab, open, normal width, unpinned, not following', () => {
    expect(DEFAULT_ATLAS_VIEW).toEqual({
      tab: 'map',
      collapsed: false,
      expanded: false,
      width: 320,
      pinnedProjectId: null,
      followSelection: false,
    });
    expect(atlasViewOf({}, WORLD_A)).toEqual(DEFAULT_ATLAS_VIEW);
  });

  it('reads valid stored values', () => {
    const view = {
      tab: 'connections',
      collapsed: true,
      expanded: true,
      width: 500,
      pinnedProjectId: PROJECT,
      followSelection: true,
    };
    expect(parseAtlasViews({ atlasViews: { [WORLD_A]: view } })).toEqual({ [WORLD_A]: view });
  });

  it('falls back field by field and drops entries with a bad world ID', () => {
    const stored = {
      atlasViews: {
        [WORLD_A]: {
          tab: 'graph',
          collapsed: 'yes',
          expanded: true,
          width: 9999,
          pinnedProjectId: '../etc',
          followSelection: true,
          extra: 1,
        },
        'not-a-world': { tab: 'map' },
        [WORLD_B]: 'broken',
      },
    };
    expect(parseAtlasViews(stored)).toEqual({
      [WORLD_A]: { ...DEFAULT_ATLAS_VIEW, expanded: true, followSelection: true },
    });
  });

  it('refuses a fractional width', () => {
    expect(parseAtlasViews({ atlasViews: { [WORLD_A]: { width: 300.5 } } })[WORLD_A]?.width).toBe(
      DEFAULT_ATLAS_VIEW.width,
    );
  });

  it('keeps only the most recent views when the stored list is over the cap', () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_ATLAS_VIEWS + 5 }, (_, i) => [uuid(i), DEFAULT_ATLAS_VIEW]),
    );
    const parsed = parseAtlasViews({ atlasViews: many });
    expect(Object.keys(parsed)).toHaveLength(MAX_ATLAS_VIEWS);
    expect(Object.keys(parsed)[0]).toBe(uuid(5));
  });
});

describe('applyAtlasViewChange', () => {
  it('changes only the given fields of one world', () => {
    const one = applyAtlasViewChange({}, WORLD_A, { collapsed: true });
    const two = applyAtlasViewChange(one, WORLD_B, { width: 400 });
    const three = applyAtlasViewChange(two, WORLD_A, { pinnedProjectId: PROJECT });
    expect(three).toEqual({
      [WORLD_B]: { ...DEFAULT_ATLAS_VIEW, width: 400 },
      [WORLD_A]: { ...DEFAULT_ATLAS_VIEW, collapsed: true, pinnedProjectId: PROJECT },
    });
    // The changed world moved to the end (most recent).
    expect(Object.keys(three)).toEqual([WORLD_B, WORLD_A]);
  });

  it('unpins with null', () => {
    const pinned = applyAtlasViewChange({}, WORLD_A, { pinnedProjectId: PROJECT });
    expect(applyAtlasViewChange(pinned, WORLD_A, { pinnedProjectId: null })[WORLD_A]).toEqual(
      DEFAULT_ATLAS_VIEW,
    );
  });

  it('drops the least recently changed world beyond the cap', () => {
    let views: AtlasViews = {};
    for (let i = 0; i <= MAX_ATLAS_VIEWS; i++) views = applyAtlasViewChange(views, uuid(i), {});
    expect(Object.keys(views)).toHaveLength(MAX_ATLAS_VIEWS);
    expect(views[uuid(0)]).toBeUndefined();
  });

  it('keeps the other preference keys when written back', () => {
    const views = applyAtlasViewChange({}, WORLD_A, { tab: 'connections' });
    expect(withAtlasViews({ comfort: { buildingLabels: false } }, views)).toEqual({
      comfort: { buildingLabels: false },
      atlasViews: views,
    });
  });

  it('fits beside a full set of saved cameras inside the preferences size limit', () => {
    let comfort = DEFAULT_COMFORT;
    for (let i = 0; i < MAX_SAVED_CAMERAS; i++) {
      comfort = applyComfortPatch(comfort, {
        camera: {
          worldId: uuid(i),
          camera: { centerX: -99999.99, centerY: -99999.99, zoom: 0.123456 },
        },
      });
    }
    let views: AtlasViews = {};
    for (let i = 0; i < MAX_ATLAS_VIEWS; i++) {
      views = applyAtlasViewChange(views, uuid(1000 + i), {
        tab: 'connections',
        collapsed: false,
        expanded: false,
        width: ATLAS_WIDTH_MAX,
        pinnedProjectId: uuid(5000 + i),
        followSelection: false,
      });
    }
    const all = withAtlasViews(withComfort({}, comfort), views);
    expect(JSON.stringify(all).length).toBeLessThan(LIMITS.preferencesMaxChars);
  });
});

describe('AtlasViewChange', () => {
  it('accepts a partial change and refuses empty, unknown or out-of-range ones', () => {
    expect(AtlasViewChange.safeParse({ followSelection: true }).success).toBe(true);
    expect(AtlasViewChange.safeParse({ pinnedProjectId: null }).success).toBe(true);
    for (const bad of [
      {},
      { tab: 'graph' },
      { width: ATLAS_WIDTH_MIN - 1 },
      { width: ATLAS_WIDTH_MAX + 1 },
      { width: 300.5 },
      { pinnedProjectId: 'nope' },
      { layout: { x: 1 } },
    ]) {
      expect(AtlasViewChange.safeParse(bad).success).toBe(false);
    }
  });
});
