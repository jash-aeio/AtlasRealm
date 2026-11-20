import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Database, openDatabase, openDatabaseReadOnly } from '../../src/main/storage/database';
import { migrate, readSchemaVersion } from '../../src/main/storage/migrate';
import { MIGRATIONS } from '../../src/main/storage/migrations';

// Schema v5 (M2-2, #67, ADR-0023): `building_placements` and `hotbar_slots`. The upgrade from a
// frozen v4 file must keep every row and leave every project unplaced, and the new tables must
// enforce identity and uniqueness on their own, even against raw SQL that skips the repositories.
const FIXTURE_V4 = readFileSync(join(import.meta.dirname, '../fixtures/db/v4-app.sql'), 'utf8');
const NOW = new Date('2026-11-20T12:00:00.000Z');
const T = '2026-11-20T12:00:00.000Z';

// IDs from the fixture.
const HOME = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const OLD_WORLD = '9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LAUNCH = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const NEWSLETTER = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const GARDEN = 'd4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f80'; // in OLD_WORLD

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';

const V4_TABLES = ['app_meta', 'profile_settings', 'worlds', 'projects', 'graph_entities'];

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-migration-v5-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function openFixtureV4(): Database {
  const db = openDatabase(join(dir, 'app.sqlite'));
  db.exec(FIXTURE_V4);
  return db;
}

async function migrateTo(db: Database, version: number) {
  return migrate(db, MIGRATIONS.slice(0, version), {
    backupDir: join(dir, 'backups'),
    now: () => NOW,
  });
}

const snapshot = (db: Database) =>
  Object.fromEntries(
    V4_TABLES.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]),
  );

/** Every table and index as SQLite stored it, so two databases can be compared exactly. */
const schemaOf = (db: Database, tables: readonly string[]) =>
  db
    .prepare(
      `SELECT type, name, tbl_name, sql FROM sqlite_schema
       WHERE sql IS NOT NULL AND tbl_name IN (SELECT value FROM json_each(?))
       ORDER BY type, name`,
    )
    .all(JSON.stringify(tables));

describe('the v4 fixture', () => {
  it('still matches what migrations 1–4 produce', async () => {
    const fixture = openFixtureV4();
    const fromCode = openDatabase(join(dir, 'from-code.sqlite'));
    try {
      await migrateTo(fromCode, 4);
      expect(readSchemaVersion(fixture)).toBe(4);
      expect(schemaOf(fixture, [...V4_TABLES, 'schema_migrations'])).toEqual(
        schemaOf(fromCode, [...V4_TABLES, 'schema_migrations']),
      );
      expect(fixture.prepare('SELECT version, name FROM schema_migrations').all()).toEqual(
        fromCode.prepare('SELECT version, name FROM schema_migrations').all(),
      );
      expect(fixture.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      fixture.close();
      fromCode.close();
    }
  });
});

describe('migration v4 → v5', () => {
  it('upgrades the fixture, keeps its data, takes a backup and leaves every project unplaced', async () => {
    const db = openFixtureV4();
    try {
      const before = snapshot(db);
      const indexesBefore = schemaOf(db, V4_TABLES);

      const report = await migrateTo(db, 5);

      expect(report).toMatchObject({ fromVersion: 4, toVersion: 5, applied: [5] });
      expect(readSchemaVersion(db)).toBe(5);
      expect(snapshot(db)).toEqual(before);
      // Nothing about the old tables changed, not even an index.
      expect(schemaOf(db, V4_TABLES)).toEqual(indexesBefore);
      // Unplaced means "no placement row"; nothing is pinned yet either.
      expect(db.prepare('SELECT count(*) AS n FROM building_placements').get()).toEqual({ n: 0 });
      expect(db.prepare('SELECT count(*) AS n FROM hotbar_slots').get()).toEqual({ n: 0 });
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(db.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);

      // The backup is the untouched v4 file.
      expect(readdirSync(join(dir, 'backups'))).toHaveLength(1);
      const backup = openDatabaseReadOnly(report.backupPath ?? '');
      try {
        expect(readSchemaVersion(backup)).toBe(4);
        expect(snapshot(backup)).toEqual(before);
        expect(
          backup.prepare("SELECT name FROM sqlite_schema WHERE name = 'building_placements'").all(),
        ).toEqual([]);
      } finally {
        backup.close();
      }
    } finally {
      db.close();
    }
  });

  it('creates both tables as STRICT', async () => {
    const db = openFixtureV4();
    try {
      await migrateTo(db, 5);
      for (const table of ['building_placements', 'hotbar_slots']) {
        expect(
          db.prepare('SELECT strict FROM pragma_table_list WHERE name = ?').get(table),
        ).toEqual({ strict: 1 });
      }
    } finally {
      db.close();
    }
  });
});

describe('schema v5 constraints (raw SQL, no repository)', () => {
  let db: Database;

  beforeEach(async () => {
    db = openFixtureV4();
    await migrateTo(db, 5);
  });

  afterEach(() => {
    db.close();
  });

  function place(values: {
    id?: string;
    world?: string;
    project?: string | null;
    service?: string | null;
    appearance?: string;
    x?: number;
    y?: number;
    rotation?: number;
  }): void {
    db.prepare(
      `INSERT INTO building_placements (id, world_id, project_id, service_kind, appearance_id,
                                        tile_x, tile_y, rotation, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      values.id ?? P1,
      values.world ?? HOME,
      values.project === undefined ? LAUNCH : values.project,
      values.service ?? null,
      values.appearance ?? 'placeholder.building.2x2',
      values.x ?? 10,
      values.y ?? 12,
      values.rotation ?? 0,
      T,
      T,
    );
  }

  function pin(values: {
    world?: string;
    slot?: number;
    type?: string;
    project?: string | null;
    service?: string | null;
  }): void {
    db.prepare(
      `INSERT INTO hotbar_slots (world_id, slot, target_type, project_id, service_kind,
                                 created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      values.world ?? HOME,
      values.slot ?? 0,
      values.type ?? 'project',
      values.project === undefined ? LAUNCH : values.project,
      values.service ?? null,
      T,
      T,
    );
  }

  describe('building_placements', () => {
    it('accepts a project building and a service structure', () => {
      place({});
      place({ id: P2, project: null, service: 'agents-guild', x: 30, y: 30, rotation: 270 });
      expect(db.prepare('SELECT count(*) AS n FROM building_placements').get()).toEqual({ n: 2 });
    });

    it('refuses a second building for the same project', () => {
      place({});
      expect(() => {
        place({ id: P2, x: 40 });
      }).toThrow(/UNIQUE constraint failed/);
    });

    it.each([
      ['both targets', { service: 'agents-guild' }],
      ['no target', { project: null }],
    ])('refuses %s', (_label, values) => {
      expect(() => {
        place(values);
      }).toThrow(/CHECK constraint failed/);
    });

    it('refuses a project from another world, and an unknown project', () => {
      expect(() => {
        place({ project: GARDEN });
      }).toThrow(/FOREIGN KEY constraint failed/);
      expect(() => {
        place({ project: P2 });
      }).toThrow(/FOREIGN KEY constraint failed/);
    });

    it('refuses an unknown world', () => {
      expect(() => {
        place({ world: P2, project: null, service: 'activity' });
      }).toThrow(/FOREIGN KEY constraint failed/);
    });

    it.each([
      ['rotation 45', { rotation: 45 }],
      ['rotation 360', { rotation: 360 }],
      ['negative x', { x: -1 }],
      ['y past the largest grid', { y: 256 }],
      ['an uppercase appearance', { appearance: 'Placeholder.Building' }],
      ['a path as appearance', { appearance: '../building.png' }],
      ['an empty appearance', { appearance: '' }],
      ['a too-long appearance', { appearance: 'x'.repeat(101) }],
      ['a service kind with a space', { project: null, service: 'agents guild' }],
      ['an empty service kind', { project: null, service: '' }],
      ['a non-UUID id', { id: 'building-1' }],
    ])('refuses %s', (_label, values) => {
      expect(() => {
        place(values);
      }).toThrow(/CHECK constraint failed/);
    });

    it('refuses a fractional tile (STRICT typing)', () => {
      expect(() => {
        place({ x: 1.5 });
      }).toThrow(/cannot store REAL value in INTEGER column/);
    });

    it('never lets a placed project be deleted, and deleting the placement leaves it alone', () => {
      place({});
      expect(() => db.prepare('DELETE FROM projects WHERE id = ?').run(LAUNCH)).toThrow(
        /FOREIGN KEY constraint failed/,
      );
      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(LAUNCH);
      db.prepare('DELETE FROM building_placements WHERE id = ?').run(P1);
      expect(db.prepare('SELECT * FROM projects WHERE id = ?').get(LAUNCH)).toEqual(project);
    });
  });

  describe('hotbar_slots', () => {
    it('accepts a project pin and a service pin in different slots', () => {
      pin({});
      pin({ slot: 9, type: 'service', project: null, service: 'settings' });
      expect(db.prepare('SELECT count(*) AS n FROM hotbar_slots').get()).toEqual({ n: 2 });
    });

    it('refuses a second pin in the same slot', () => {
      pin({});
      expect(() => {
        pin({ project: NEWSLETTER });
      }).toThrow(/UNIQUE constraint failed/);
    });

    it('refuses the same target in two slots of a world', () => {
      pin({});
      expect(() => {
        pin({ slot: 1 });
      }).toThrow(/UNIQUE constraint failed/);
      pin({ slot: 2, type: 'service', project: null, service: 'activity' });
      expect(() => {
        pin({ slot: 3, type: 'service', project: null, service: 'activity' });
      }).toThrow(/UNIQUE constraint failed/);
    });

    it('allows the same service in two different worlds', () => {
      pin({ type: 'service', project: null, service: 'activity' });
      pin({ world: OLD_WORLD, type: 'service', project: null, service: 'activity' });
      expect(db.prepare('SELECT count(*) AS n FROM hotbar_slots').get()).toEqual({ n: 2 });
    });

    it.each([
      ['slot 10', { slot: 10 }],
      ['slot -1', { slot: -1 }],
      ['an unknown target type', { type: 'file' }],
      ['a project pin with no project', { project: null }],
      ['a project pin that also names a service', { service: 'activity' }],
      ['a service pin with no service', { type: 'service', project: null }],
      ['a service pin that also names a project', { type: 'service', service: 'activity' }],
    ])('refuses %s', (_label, values) => {
      expect(() => {
        pin(values);
      }).toThrow(/CHECK constraint failed/);
    });

    it('refuses a project from another world, and an unknown project', () => {
      expect(() => {
        pin({ project: GARDEN });
      }).toThrow(/FOREIGN KEY constraint failed/);
      expect(() => {
        pin({ project: P2 });
      }).toThrow(/FOREIGN KEY constraint failed/);
    });

    it('clearing a slot leaves its project alone', () => {
      pin({});
      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(LAUNCH);
      db.prepare('DELETE FROM hotbar_slots WHERE world_id = ? AND slot = 0').run(HOME);
      expect(db.prepare('SELECT * FROM projects WHERE id = ?').get(LAUNCH)).toEqual(project);
    });
  });
});
