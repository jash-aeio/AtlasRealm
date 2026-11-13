import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Database, openDatabase } from '../../src/main/storage/database';
import { migrate, readSchemaVersion } from '../../src/main/storage/migrate';
import { MIGRATIONS } from '../../src/main/storage/migrations';

// Schema v3 (M1-4, #31): graph_entities, the v2 → v3 backfill, and the constraints the table
// enforces on its own, even against raw SQL that skips the repositories.
const T = '2026-11-11T12:00:00.000Z';
const TRASHED_AT = '2026-11-12T08:00:00.000Z';
const WORLD = '11111111-1111-4111-8111-111111111111';
const OTHER_WORLD = '33333333-3333-4333-8333-333333333333';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const ENTITY = '44444444-4444-4444-8444-444444444444';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let dir: string;
let db: Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-migration-v3-'));
  db = openDatabase(join(dir, 'app.sqlite'));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function migrateTo(version: number): Promise<void> {
  await migrate(db, MIGRATIONS.slice(0, version), { backupDir: join(dir, 'backups') });
}

function insertWorld(id: string): void {
  db.prepare(
    `INSERT INTO worlds (id, name, theme_id, created_at, updated_at) VALUES (?, 'Home', 'meadow', ?, ?)`,
  ).run(id, T, T);
}

function insertProject(id: string, worldId: string, trashedAt: string | null = null): void {
  db.prepare(
    `INSERT INTO projects (id, world_id, name, template_id, template_version, status, trashed_at,
                           created_at, updated_at)
     VALUES (?, ?, 'Launch plan', 'generic', '1.0.0', ?, ?, ?, ?)`,
  ).run(id, worldId, trashedAt === null ? 'active' : 'trashed', trashedAt, T, T);
}

describe('migration v2 → v3', () => {
  it('gives every existing world and project its own entity; trashed ones start tombstoned', async () => {
    await migrateTo(2);
    insertWorld(WORLD);
    insertProject(PROJECT, WORLD);
    const trashed = '55555555-5555-4555-8555-555555555555';
    insertProject(trashed, WORLD, TRASHED_AT);

    await migrateTo(3);

    expect(readSchemaVersion(db)).toBe(3);
    const rows = db
      .prepare(
        `SELECT id, kind, world_id, project_id, ownership, source_locator, tombstoned_at, revision
         FROM graph_entities ORDER BY kind DESC, project_id`,
      )
      .all();
    expect(rows).toEqual([
      expect.objectContaining({ kind: 'world', world_id: WORLD, project_id: null }),
      expect.objectContaining({ kind: 'project', project_id: PROJECT, tombstoned_at: null }),
      expect.objectContaining({ kind: 'project', project_id: trashed, tombstoned_at: TRASHED_AT }),
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({ ownership: 'app_owned', source_locator: null, revision: 1 });
      // Its own UUID, never the ID of the record it represents.
      expect(String(row['id'])).toMatch(UUID_V4);
      expect([WORLD, PROJECT, trashed]).not.toContain(row['id']);
    }
    expect(new Set(rows.map((row) => row['id'])).size).toBe(3);
  });

  it('creates graph_entities as STRICT, with no name or layout columns', async () => {
    await migrateTo(3);
    expect(
      db.prepare('SELECT strict FROM pragma_table_list WHERE name = ?').get('graph_entities'),
    ).toEqual({ strict: 1 });
    const columns = db
      .prepare('SELECT name FROM pragma_table_info(?)')
      .all('graph_entities')
      .map((row) => String(row['name']));
    expect(columns).toEqual([
      'id',
      'kind',
      'world_id',
      'project_id',
      'ownership',
      'source_locator',
      'tombstoned_at',
      'created_at',
      'updated_at',
      'revision',
    ]);
  });
});

describe('schema v3 constraints (raw SQL, no repository)', () => {
  beforeEach(async () => {
    await migrateTo(3);
    insertWorld(WORLD);
    insertWorld(OTHER_WORLD);
    insertProject(PROJECT, WORLD);
  });

  function insertEntity(overrides: Record<string, string | null> = {}): void {
    const row = {
      id: ENTITY,
      kind: 'project',
      world_id: WORLD,
      project_id: PROJECT,
      ownership: 'app_owned',
      source_locator: null,
      ...overrides,
    };
    db.prepare(
      `INSERT INTO graph_entities (id, kind, world_id, project_id, ownership, source_locator,
                                   created_at, updated_at)
       VALUES (:id, :kind, :world_id, :project_id, :ownership, :source_locator, :t, :t)`,
    ).run({ ...row, t: T });
  }

  it('accepts a valid project entity and an external one with a locator', () => {
    insertEntity();
    insertEntity({
      id: '66666666-6666-4666-8666-666666666666',
      kind: 'world',
      project_id: null,
      ownership: 'external',
      source_locator: 'vault/Home.md',
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM graph_entities').get()).toEqual({ n: 2 });
  });

  it.each([
    ['an ID that is not a UUID', { id: 'launch-plan' }],
    ['an unknown kind', { kind: 'file' }],
    ['a world entity with a project', { kind: 'world' }],
    ['a project entity without a project', { project_id: null }],
    ['an unknown ownership', { ownership: 'shared' }],
    ['an external entity without a locator', { ownership: 'external' }],
    ['an empty locator', { source_locator: '' }],
    ['a locator hiding text after a NUL', { source_locator: `a${String.fromCodePoint(0)}b` }],
  ])('refuses %s', (_label, overrides) => {
    expect(() => {
      insertEntity(overrides);
    }).toThrow(/CHECK constraint failed/);
  });

  it('refuses a project entity whose world is not the project’s world', () => {
    expect(() => {
      insertEntity({ world_id: OTHER_WORLD });
    }).toThrow(/FOREIGN KEY/);
  });

  it('allows only one entity per project and per world', () => {
    insertEntity();
    expect(() => {
      insertEntity({ id: '77777777-7777-4777-8777-777777777777' });
    }).toThrow(/UNIQUE/);
    const worldEntity = { kind: 'world', project_id: null };
    insertEntity({ ...worldEntity, id: '88888888-8888-4888-8888-888888888888' });
    expect(() => {
      insertEntity({ ...worldEntity, id: '99999999-9999-4999-8999-999999999999' });
    }).toThrow(/UNIQUE/);
  });

  it('refuses to delete a project that has an entity', () => {
    insertEntity();
    expect(() => db.prepare('DELETE FROM projects WHERE id = ?').run(PROJECT)).toThrow(
      /FOREIGN KEY/,
    );
  });
});
