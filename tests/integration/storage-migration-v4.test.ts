import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Database, openDatabase } from '../../src/main/storage/database';
import { migrate, readSchemaVersion } from '../../src/main/storage/migrate';
import { MIGRATIONS } from '../../src/main/storage/migrations';

// Schema v4 (M1-7, #34, ADR-0020): `projects` is rebuilt so template_id accepts namespaced IDs
// such as `builtin.generic`. The rebuild must keep every project and graph entity as it was,
// and every constraint and index must still be in force afterwards.
const T = '2026-11-11T12:00:00.000Z';
const LATER = '2026-11-12T08:00:00.000Z';
const WORLD = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const ARCHIVED_TRASHED = '55555555-5555-4555-8555-555555555555';

let dir: string;
let db: Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-migration-v4-'));
  db = openDatabase(join(dir, 'app.sqlite'));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function migrateTo(version: number): Promise<void> {
  await migrate(db, MIGRATIONS.slice(0, version), { backupDir: join(dir, 'backups') });
}

function insertProject(id: string, templateId: string): void {
  db.prepare(
    `INSERT INTO projects (id, world_id, name, template_id, template_version, created_at,
                           updated_at)
     VALUES (?, ?, 'Launch plan', ?, '1.0.0', ?, ?)`,
  ).run(id, WORLD, templateId, T, T);
}

/** v3 data: one active project and one that was archived, then trashed, edited twice. */
async function seedV3(): Promise<void> {
  await migrateTo(3);
  db.prepare(
    `INSERT INTO worlds (id, name, theme_id, created_at, updated_at)
     VALUES (?, 'Home', 'meadow', ?, ?)`,
  ).run(WORLD, T, T);
  insertProject(PROJECT, 'generic');
  db.prepare(
    `INSERT INTO projects (id, world_id, name, goal, template_id, template_version, status,
                           archived_at, trashed_at, created_at, updated_at, revision)
     VALUES (?, ?, 'Old plan', 'A goal', 'content-campaign', '1.0.0', 'trashed', ?, ?, ?, ?, 3)`,
  ).run(ARCHIVED_TRASHED, WORLD, T, LATER, T, LATER);
  db.prepare(
    `INSERT INTO graph_entities (id, kind, world_id, project_id, ownership, created_at,
                                 updated_at)
     VALUES ('66666666-6666-4666-8666-666666666666', 'world', ?, NULL, 'app_owned', ?, ?),
            ('77777777-7777-4777-8777-777777777777', 'project', ?, ?, 'app_owned', ?, ?),
            ('88888888-8888-4888-8888-888888888888', 'project', ?, ?, 'app_owned', ?, ?)`,
  ).run(WORLD, T, T, WORLD, PROJECT, T, T, WORLD, ARCHIVED_TRASHED, T, T);
  db.prepare('UPDATE graph_entities SET tombstoned_at = ? WHERE project_id = ?').run(
    LATER,
    ARCHIVED_TRASHED,
  );
}

const snapshot = () => ({
  projects: db.prepare('SELECT * FROM projects ORDER BY id').all(),
  entities: db.prepare('SELECT * FROM graph_entities ORDER BY id').all(),
});

const indexes = () =>
  db
    .prepare(
      `SELECT name FROM sqlite_schema WHERE type = 'index' AND sql IS NOT NULL
       AND tbl_name IN ('projects', 'graph_entities') ORDER BY name`,
    )
    .all()
    .map((row) => row['name']);

describe('migration v3 → v4', () => {
  it('keeps every project, graph entity and index exactly as it was', async () => {
    await seedV3();
    const before = snapshot();
    const indexesBefore = indexes();

    await migrateTo(4);

    expect(readSchemaVersion(db)).toBe(4);
    expect(snapshot()).toEqual(before);
    expect(indexes()).toEqual(indexesBefore);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
    // The temporary copy is gone.
    expect(
      db.prepare("SELECT name FROM temp.sqlite_schema WHERE name = 'graph_entities_v3'").all(),
    ).toEqual([]);
  });
});

describe('schema v4 template_id rule (raw SQL, no repository)', () => {
  beforeEach(async () => {
    await seedV3();
    await migrateTo(4);
  });

  it.each(['builtin.generic', 'builtin.content-campaign', 'generic', 'a', 'x'.repeat(100)])(
    'accepts %s',
    (templateId) => {
      expect(() => {
        insertProject('99999999-9999-4999-8999-999999999999', templateId);
      }).not.toThrow();
    },
  );

  it.each([
    ['uppercase', 'Builtin.Generic'],
    ['path', '../generic'],
    ['slash', 'builtin/generic'],
    ['leading dot', '.generic'],
    ['trailing dash', 'generic-'],
    ['double dot', 'builtin..generic'],
    ['dot dash', 'builtin.-generic'],
    ['space', 'builtin generic'],
    ['empty', ''],
    ['too long', 'x'.repeat(101)],
  ])('refuses a %s template ID', (_label, templateId) => {
    expect(() => {
      insertProject('99999999-9999-4999-8999-999999999999', templateId);
    }).toThrow(/CHECK constraint failed/);
  });

  it('still enforces the graph entity → project reference', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO graph_entities (id, kind, world_id, project_id, ownership, created_at,
                                       updated_at)
           VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'project', ?,
                   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'app_owned', ?, ?)`,
        )
        .run(WORLD, T, T),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => db.prepare('DELETE FROM projects WHERE id = ?').run(PROJECT)).toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });

  it('still refuses a status that disagrees with its timestamps', () => {
    expect(() =>
      db.prepare("UPDATE projects SET status = 'archived' WHERE id = ?").run(PROJECT),
    ).toThrow(/CHECK constraint failed/);
  });
});
