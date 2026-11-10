import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Database, openDatabase, openDatabaseReadOnly } from '../../src/main/storage/database';
import { migrate, readSchemaVersion } from '../../src/main/storage/migrate';
import { MIGRATIONS } from '../../src/main/storage/migrations';

// Schema v2 (M1-3, #30): the upgrade from a frozen v1 file, and the constraints the new
// tables enforce on their own, even against raw SQL that skips the repositories.
const FIXTURE_V1 = readFileSync(join(import.meta.dirname, '../fixtures/db/v1-app.sql'), 'utf8');
const NOW = new Date('2026-11-11T12:00:00.000Z');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-migration-v2-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function openFixtureV1(): Database {
  const db = openDatabase(join(dir, 'app.sqlite'));
  db.exec(FIXTURE_V1);
  return db;
}

async function openFreshV2(): Promise<Database> {
  const db = openDatabase(join(dir, 'app.sqlite'));
  await migrate(db, MIGRATIONS, { backupDir: join(dir, 'backups'), now: () => NOW });
  return db;
}

/** Table shape as SQLite reports it: columns (name, type, not null, default, pk) and STRICT. */
function tableShape(db: Database, table: string): unknown {
  const columns = db
    .prepare(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_xinfo(?)`)
    .all(table);
  const info = db.prepare('SELECT strict FROM pragma_table_list WHERE name = ?').get(table);
  return { columns, strict: info?.['strict'] };
}

describe('the v1 fixture', () => {
  it('still matches what migration 1 produces', async () => {
    const fixture = openFixtureV1();
    const fromCode = openDatabase(join(dir, 'from-code.sqlite'));
    try {
      await migrate(fromCode, MIGRATIONS.slice(0, 1), { backupDir: join(dir, 'backups') });
      expect(readSchemaVersion(fixture)).toBe(1);
      for (const table of ['app_meta', 'schema_migrations']) {
        expect(tableShape(fixture, table)).toEqual(tableShape(fromCode, table));
      }
    } finally {
      fixture.close();
      fromCode.close();
    }
  });
});

describe('migration v1 → v2', () => {
  it('upgrades the fixture, keeps its data and takes a backup first', async () => {
    const db = openFixtureV1();
    try {
      const appMetaBefore = db.prepare('SELECT * FROM app_meta ORDER BY key').all();

      const report = await migrate(db, MIGRATIONS, {
        backupDir: join(dir, 'backups'),
        now: () => NOW,
      });

      expect(report).toMatchObject({ fromVersion: 1, toVersion: 2, applied: [2] });
      expect(readSchemaVersion(db)).toBe(2);
      expect(db.prepare('SELECT * FROM app_meta ORDER BY key').all()).toEqual(appMetaBefore);
      expect(db.prepare('SELECT version, name FROM schema_migrations').all()).toEqual([
        { version: 1, name: 'create_app_meta' },
        { version: 2, name: 'create_profile_settings_worlds_projects' },
      ]);

      // The backup is the untouched v1 file.
      expect(readdirSync(join(dir, 'backups'))).toHaveLength(1);
      const backup = openDatabaseReadOnly(report.backupPath ?? '');
      try {
        expect(readSchemaVersion(backup)).toBe(1);
        expect(backup.prepare('SELECT * FROM app_meta ORDER BY key').all()).toEqual(appMetaBefore);
      } finally {
        backup.close();
      }
    } finally {
      db.close();
    }
  });

  it('creates the three tables as STRICT, with the project query index', async () => {
    const db = await openFreshV2();
    try {
      for (const table of ['profile_settings', 'worlds', 'projects']) {
        expect(
          db.prepare('SELECT strict FROM pragma_table_list WHERE name = ?').get(table),
        ).toEqual({ strict: 1 });
      }
      expect(
        db.prepare('SELECT name FROM pragma_index_info(?)').all('projects_by_world_status'),
      ).toEqual([{ name: 'world_id' }, { name: 'status' }]);
      // The planner really uses it for "projects of a world with a status".
      const plan = db
        .prepare('EXPLAIN QUERY PLAN SELECT id FROM projects WHERE world_id = ? AND status = ?')
        .all('w', 'active')
        .map((row) => String(row['detail']));
      expect(plan.join('\n')).toContain('projects_by_world_status');
    } finally {
      db.close();
    }
  });
});

describe('schema v2 constraints (raw SQL, no repository)', () => {
  const WORLD = '11111111-1111-4111-8111-111111111111';
  const PROJECT = '22222222-2222-4222-8222-222222222222';
  const T = '2026-11-11T12:00:00.000Z';

  let db: Database;

  beforeEach(async () => {
    db = await openFreshV2();
    db.prepare(
      `INSERT INTO worlds (id, name, theme_id, created_at, updated_at) VALUES (?, 'Home', 'meadow', ?, ?)`,
    ).run(WORLD, T, T);
  });

  afterEach(() => {
    db.close();
  });

  function insertProject(overrides: Record<string, string | null> = {}): void {
    const row = {
      id: PROJECT,
      world_id: WORLD,
      name: 'Launch plan',
      goal: '',
      template_id: 'generic',
      template_version: '1.0.0',
      status: 'active',
      archived_at: null,
      trashed_at: null,
      ...overrides,
    };
    db.prepare(
      `INSERT INTO projects (id, world_id, name, goal, template_id, template_version, status,
                             archived_at, trashed_at, created_at, updated_at)
       VALUES (:id, :world_id, :name, :goal, :template_id, :template_version, :status,
               :archived_at, :trashed_at, :t, :t)`,
    ).run({ ...row, t: T });
  }

  it('accepts a valid project', () => {
    insertProject();
    expect(db.prepare('SELECT revision, status FROM projects').get()).toEqual({
      revision: 1,
      status: 'active',
    });
  });

  it('refuses a project in a world that does not exist (foreign keys are on)', () => {
    expect(() => {
      insertProject({ world_id: '99999999-9999-4999-8999-999999999999' });
    }).toThrow(/FOREIGN KEY/);
  });

  it('refuses to delete a world that still has projects', () => {
    insertProject();
    expect(() => db.prepare('DELETE FROM worlds WHERE id = ?').run(WORLD)).toThrow(/FOREIGN KEY/);
  });

  it.each([
    ['an untrimmed name', { name: ' Launch plan' }],
    ['a name ending in a newline', { name: 'Launch plan\n' }],
    ['an empty name', { name: '' }],
    ['an 81-character name', { name: 'x'.repeat(81) }],
    ['a 2001-character goal', { goal: 'x'.repeat(2001) }],
    ['an unknown status', { status: 'deleted' }],
    ['archived without archived_at', { status: 'archived' }],
    ['active with archived_at', { archived_at: T }],
    ['trashed without trashed_at', { status: 'trashed' }],
    ['an upper-case template ID', { template_id: 'Generic' }],
    ['a template ID with a path', { template_id: '../generic' }],
    ['a project ID that is not a UUID', { id: 'my-project' }],
  ])('refuses %s', (_label, overrides) => {
    expect(() => {
      insertProject(overrides);
    }).toThrow(/CHECK constraint failed/);
  });

  it('counts characters, not bytes: an 80-character non-ASCII name fits', () => {
    insertProject({ name: 'é'.repeat(80) });
    expect(db.prepare('SELECT length(name) AS n FROM projects').get()).toEqual({ n: 80 });
  });

  it('refuses invalid profile settings', () => {
    const insert = (profileId: string, preferences: string, colour: string | null): void => {
      db.prepare(
        `INSERT INTO profile_settings (profile_id, display_name, avatar_colour, timezone,
                                       preferences_json, created_at, updated_at)
         VALUES (?, 'Ada', ?, 'Europe/Amsterdam', ?, ?, ?)`,
      ).run(profileId, colour, preferences, T, T);
    };
    expect(() => {
      insert('../evil', '{}', null);
    }).toThrow(/CHECK/);
    expect(() => {
      insert('default', '[1, 2]', null);
    }).toThrow(/CHECK/);
    expect(() => {
      insert('default', '{not json', null);
    }).toThrow(/CHECK|malformed JSON/);
    expect(() => {
      insert('default', JSON.stringify({ blob: 'x'.repeat(16_400) }), null);
    }).toThrow(/CHECK/);
    expect(() => {
      insert('default', '{}', 'red');
    }).toThrow(/CHECK/);
    insert('default', '{"reducedMotion":true}', '#a1b2c3');
    expect(db.prepare('SELECT COUNT(*) AS n FROM profile_settings').get()).toEqual({ n: 1 });
  });
});
