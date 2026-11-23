import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Database, openDatabase } from '../../src/main/storage/database';
import { migrate, readSchemaVersion } from '../../src/main/storage/migrate';
import { MIGRATIONS } from '../../src/main/storage/migrations';

// Schema v6 (M2-11 #76, ADR-0029): `project_relations`. The upgrade must keep every row and
// start with no links, and the table must refuse cross-world, self, duplicate and malformed
// links on its own, even against raw SQL that skips the repository.
const FIXTURE_V4 = readFileSync(join(import.meta.dirname, '../fixtures/db/v4-app.sql'), 'utf8');
const NOW = new Date('2026-11-23T12:00:00.000Z');
const T = '2026-11-23T12:00:00.000Z';

// IDs from the fixture.
const HOME = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const OLD_WORLD = '9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LAUNCH = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const NEWSLETTER = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const GARDEN = 'd4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f80'; // in OLD_WORLD

const R1 = '11111111-1111-4111-8111-111111111111';
const R2 = '22222222-2222-4222-8222-222222222222';
const R3 = '33333333-3333-4333-8333-333333333333';

const OLD_TABLES = [
  'app_meta',
  'profile_settings',
  'worlds',
  'projects',
  'graph_entities',
  'building_placements',
  'hotbar_slots',
];

let dir: string;
let db: Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-migration-v6-'));
  db = openDatabase(join(dir, 'app.sqlite'));
  db.exec(FIXTURE_V4);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function migrateTo(version: number) {
  return migrate(db, MIGRATIONS.slice(0, version), {
    backupDir: join(dir, 'backups'),
    now: () => NOW,
  });
}

const snapshot = () =>
  Object.fromEntries(
    OLD_TABLES.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]),
  );

describe('migration v5 → v6', () => {
  it('keeps every row, starts with no links and creates a STRICT table', async () => {
    await migrateTo(5);
    db.prepare(
      `INSERT INTO hotbar_slots (world_id, slot, target_type, project_id, created_at, updated_at)
       VALUES (?, 0, 'project', ?, ?, ?)`,
    ).run(HOME, LAUNCH, T, T);
    const before = snapshot();

    const report = await migrateTo(6);

    expect(report).toMatchObject({ fromVersion: 5, toVersion: 6, applied: [6] });
    expect(readSchemaVersion(db)).toBe(6);
    expect(snapshot()).toEqual(before);
    expect(db.prepare('SELECT count(*) AS n FROM project_relations').get()).toEqual({ n: 0 });
    expect(
      db.prepare('SELECT strict FROM pragma_table_list WHERE name = ?').get('project_relations'),
    ).toEqual({ strict: 1 });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
  });
});

describe('schema v6 constraints (raw SQL, no repository)', () => {
  beforeEach(async () => {
    await migrateTo(6);
  });

  function link(values: {
    id?: string;
    world?: string;
    source?: string;
    target?: string;
    type?: string;
    origin?: string;
    state?: string;
  }): void {
    db.prepare(
      `INSERT INTO project_relations (id, world_id, source_project_id, target_project_id,
                                      relation_type, origin, confirmation_state,
                                      created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      values.id ?? R1,
      values.world ?? HOME,
      values.source ?? LAUNCH,
      values.target ?? NEWSLETTER,
      values.type ?? 'depends_on',
      values.origin ?? 'user',
      values.state ?? 'confirmed',
      T,
      T,
    );
  }

  it('accepts each type, both directions and several types for one pair', () => {
    link({});
    link({ id: R2, source: NEWSLETTER, target: LAUNCH });
    link({ id: R3, type: 'references' });
    expect(db.prepare('SELECT count(*) AS n FROM project_relations').get()).toEqual({ n: 3 });
    expect(
      db
        .prepare('SELECT origin, confirmation_state, revision FROM project_relations WHERE id = ?')
        .get(R1),
    ).toEqual({
      origin: 'user',
      confirmation_state: 'confirmed',
      revision: 1,
    });
  });

  it('refuses a duplicate of the same source, target and type', () => {
    link({});
    expect(() => {
      link({ id: R2 });
    }).toThrow(/UNIQUE constraint failed/);
  });

  it.each([
    ['a self-link', { target: LAUNCH }],
    ['an unknown type', { type: 'blocks' }],
    ['an unknown origin', { origin: 'ai_proposed' }],
    ['an unconfirmed user link', { state: 'proposed' }],
    ['an unknown confirmation state', { state: 'maybe' }],
    ['a non-UUID id', { id: 'link-1' }],
  ])('refuses %s', (_label, values) => {
    expect(() => {
      link(values);
    }).toThrow(/CHECK constraint failed/);
  });

  it('refuses an end in another world, an unknown project and an unknown world', () => {
    expect(() => {
      link({ target: GARDEN });
    }).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => {
      link({ source: GARDEN });
    }).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => {
      link({ target: R3 });
    }).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => {
      link({ world: OLD_WORLD });
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('keeps a linked project from being deleted (RESTRICT)', () => {
    link({});
    expect(() => {
      db.prepare('DELETE FROM graph_entities WHERE project_id = ?').run(NEWSLETTER);
      db.prepare('DELETE FROM projects WHERE id = ?').run(NEWSLETTER);
    }).toThrow(/FOREIGN KEY constraint failed/);
  });
});
