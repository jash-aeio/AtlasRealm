// Building appearances in the main process (M2-3 #68): footprints come from the trusted
// bundled manifest, and an appearance that no longer resolves fails closed as 4×4.
import { describe, expect, it, vi } from 'vitest';

import type { AssetManifest } from '../../src/common/assets/asset-manifest';
import {
  BuildingAppearances,
  DEFAULT_BUILDING_APPEARANCE,
  UNKNOWN_APPEARANCE_FOOTPRINT,
} from '../../src/main/world/building-appearances';

function entry(id: string, kind: 'building' | 'terrain', columns: number, rows: number) {
  return {
    id,
    version: 1,
    kind,
    path: `${id.replaceAll('.', '-')}.png`,
    width: 256,
    height: 256,
    pivot: { x: 128, y: 255 },
    footprint: { columns, rows },
    sha256: '0'.repeat(64),
    placeholder: true,
    provenance: 'test',
  };
}

function manifest(...assets: ReturnType<typeof entry>[]): AssetManifest {
  return { schemaVersion: 1, tile: { width: 64, height: 32 }, assets };
}

describe('BuildingAppearances', () => {
  it('reads the bundled manifest, whose default building is 2×2', () => {
    const appearances = BuildingAppearances.bundled();
    expect(appearances.defaultId).toBe(DEFAULT_BUILDING_APPEARANCE);
    expect(appearances.footprintOf(DEFAULT_BUILDING_APPEARANCE)).toEqual({ columns: 2, rows: 2 });
  });

  it('refuses to start without the default building appearance', () => {
    expect(
      () => new BuildingAppearances(manifest(entry('other.building', 'building', 3, 3))),
    ).toThrow(/Default building appearance/);
  });

  it('treats an unknown appearance as 4×4 and warns once per ID', () => {
    const warn = vi.fn();
    const appearances = new BuildingAppearances(
      manifest(entry(DEFAULT_BUILDING_APPEARANCE, 'building', 2, 2)),
      warn,
    );
    expect(UNKNOWN_APPEARANCE_FOOTPRINT).toEqual({ columns: 4, rows: 4 });
    expect(appearances.footprintOf('renamed.art')).toEqual(UNKNOWN_APPEARANCE_FOOTPRINT);
    expect(appearances.footprintOf('renamed.art')).toEqual(UNKNOWN_APPEARANCE_FOOTPRINT);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not count a non-building entry as a building', () => {
    const appearances = new BuildingAppearances(
      manifest(
        entry(DEFAULT_BUILDING_APPEARANCE, 'building', 2, 2),
        entry('ground.tile', 'terrain', 1, 1),
      ),
      () => undefined,
    );
    expect(appearances.footprintOf('ground.tile')).toEqual(UNKNOWN_APPEARANCE_FOOTPRINT);
  });

  it('quotes a damaged ID in the log so it cannot forge log lines', () => {
    const warn = vi.fn();
    const appearances = new BuildingAppearances(
      manifest(entry(DEFAULT_BUILDING_APPEARANCE, 'building', 2, 2)),
      warn,
    );
    appearances.footprintOf('bad\n[ipc] fake line');
    expect(warn.mock.calls[0]?.[0]).not.toContain('\n');
    expect(warn.mock.calls[0]?.[0]).toContain('"bad\\n[ipc] fake line"');
  });
});
