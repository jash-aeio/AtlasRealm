import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Database, openDatabase } from '../../src/main/storage/database';
import { migrate, readSchemaVersion } from '../../src/main/storage/migrate';
import { MIGRATIONS } from '../../src/main/storage/migrations';

// Schema v7 (M3-3 #113, ADR-0036): resource packages, installed packages, agent instances and
// bindings. The upgrade must keep every row and start empty, and the tables must refuse
// cross-world references, wrong kinds, uninstalling while used and malformed values on their
// own, even against raw SQL that skips the repositories.
const FIXTURE_V4 = readFileSync(join(import.meta.dirname, '../fixtures/db/v4-app.sql'), 'utf8');
const NOW = new Date('2026-11-28T12:00:00.000Z');
const T = '2026-11-28T12:00:00.000Z';

// IDs from the fixture.
const HOME = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const OLD_WORLD = '9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LAUNCH = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'; // in HOME
const GARDEN = 'd4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f80'; // in OLD_WORLD

const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '22222222-2222-4222-8222-222222222222';
const DIGEST = 'a'.repeat(64);

const NEW_TABLES = [
  'resource_packages',
  'resource_dependencies',
  'world_resources',
  'agent_instances',
  'agent_skill_bindings',
  'project_tool_bindings',
];
const OLD_TABLES = [
  'app_meta',
  'profile_settings',
  'worlds',
  'projects',
  'graph_entities',
  'building_placements',
  'hotbar_slots',
  'project_relations',
];

let dir: string;
let db: Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-migration-v7-'));
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

describe('migration v6 → v7', () => {
  it('keeps every row, starts empty and creates STRICT tables', async () => {
    await migrateTo(6);
    const before = snapshot();

    const report = await migrateTo(7);

    expect(report).toMatchObject({ fromVersion: 6, toVersion: 7, applied: [7] });
    expect(report.backupPath).toBeTruthy();
    expect(readSchemaVersion(db)).toBe(7);
    expect(snapshot()).toEqual(before);
    for (const table of NEW_TABLES) {
      expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
      expect(db.prepare('SELECT strict FROM pragma_table_list WHERE name = ?').get(table)).toEqual({
        strict: 1,
      });
    }
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
  });

  it('has no secret or credential column in any resource table (M3 Check)', async () => {
    await migrateTo(7);
    const suspicious = /secret|credential|password|passphrase|token|api_?key|vault|auth|cookie/i;
    for (const table of NEW_TABLES) {
      const columns = db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as {
        name: string;
      }[];
      expect(columns.length).toBeGreaterThan(0);
      expect(columns.filter((column) => suspicious.test(column.name))).toEqual([]);
    }
  });
});

describe('schema v7 constraints (raw SQL, no repository)', () => {
  beforeEach(async () => {
    await migrateTo(7);
  });

  function pkg(values: {
    id?: string;
    version?: string;
    kind?: string;
    source?: string;
    review?: string;
    digest?: string;
    license?: string;
    name?: string;
  }): void {
    db.prepare(
      `INSERT INTO resource_packages (package_id, version, kind, name, publisher, source,
                                      digest_sha256, license, review_state, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Atlas Realm', ?, ?, ?, ?, ?, ?)`,
    ).run(
      values.id ?? 'builtin.writer',
      values.version ?? '1.0.0',
      values.kind ?? 'agent',
      values.name ?? 'Writer',
      values.source ?? 'bundled',
      values.digest ?? DIGEST,
      values.license ?? 'UNLICENSED',
      values.review ?? 'trusted',
      T,
      T,
    );
  }

  function install(world: string, id: string, version: string, kind: string): void {
    db.prepare(
      `INSERT INTO world_resources (world_id, package_id, package_version, kind, enabled,
                                    created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    ).run(world, id, version, kind, T, T);
  }

  function agent(values: {
    id?: string;
    world?: string;
    project?: string;
    template?: string;
    version?: string;
    nickname?: string | null;
  }): void {
    db.prepare(
      `INSERT INTO agent_instances (id, world_id, project_id, template_id, template_version,
                                    nickname, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      values.id ?? A1,
      values.world ?? HOME,
      values.project ?? LAUNCH,
      values.template ?? 'builtin.writer',
      values.version ?? '1.0.0',
      values.nickname === undefined ? null : values.nickname,
      T,
      T,
    );
  }

  function skillBinding(agentId: string, world: string, skill: string, version = '1.0.0'): void {
    db.prepare(
      `INSERT INTO agent_skill_bindings (agent_instance_id, world_id, skill_id, skill_version,
                                         enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    ).run(agentId, world, skill, version, T, T);
  }

  function toolBinding(project: string, world: string, tool: string, caps = '[]'): void {
    db.prepare(
      `INSERT INTO project_tool_bindings (project_id, world_id, tool_id, tool_version,
                                          enabled_capabilities, created_at, updated_at)
       VALUES (?, ?, ?, '1.0.0', ?, ?, ?)`,
    ).run(project, world, tool, caps, T, T);
  }

  /** The agent, skill and tool packages, all installed in HOME. */
  function team(): void {
    pkg({});
    pkg({ id: 'builtin.brief', kind: 'skill', name: 'Brief' });
    pkg({ id: 'builtin.files', kind: 'tool', name: 'Files' });
    install(HOME, 'builtin.writer', '1.0.0', 'agent');
    install(HOME, 'builtin.brief', '1.0.0', 'skill');
    install(HOME, 'builtin.files', '1.0.0', 'tool');
  }

  it('accepts a full team and its dependencies', () => {
    team();
    db.prepare(
      `INSERT INTO resource_dependencies (package_id, package_version, requirement_kind,
                                          dependency_id, version_range, created_at)
       VALUES ('builtin.writer', '1.0.0', 'default_skill', 'builtin.brief', '^1.0.0', ?)`,
    ).run(T);
    agent({ nickname: 'Quill' });
    skillBinding(A1, HOME, 'builtin.brief');
    toolBinding(LAUNCH, HOME, 'builtin.files', '["project.files.read"]');
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('refuses malformed package records', () => {
    expect(() => {
      pkg({ id: 'Writer' });
    }).toThrow(/CHECK/);
    expect(() => {
      pkg({ id: 'nodot' });
    }).toThrow(/CHECK/);
    expect(() => {
      pkg({ version: '1.0' });
    }).toThrow(/CHECK/);
    expect(() => {
      pkg({ version: '1.0.0-beta' });
    }).toThrow(/CHECK/);
    expect(() => {
      pkg({ kind: 'workflow' });
    }).toThrow(/CHECK/);
    expect(() => {
      pkg({ digest: 'A'.repeat(64) });
    }).toThrow(/CHECK/);
    expect(() => {
      pkg({ digest: 'a'.repeat(63) });
    }).toThrow(/CHECK/);
    expect(() => {
      pkg({ license: 'MIT License' });
    }).toThrow(/CHECK/);
    expect(() => {
      pkg({ name: ' Writer' });
    }).toThrow(/CHECK/);
    expect(() => {
      pkg({ source: 'web' });
    }).toThrow(/CHECK/);
  });

  it('keeps "trusted" for bundled packages only', () => {
    expect(() => {
      pkg({ review: 'approved' });
    }).toThrow(/CHECK/);
    expect(() => {
      pkg({ id: 'acme.writer', source: 'local', review: 'trusted' });
    }).toThrow(/CHECK/);
    pkg({ id: 'acme.writer', source: 'local', review: 'unreviewed' });
  });

  it('allows one record per id@version, and several versions of one package', () => {
    pkg({});
    expect(() => {
      pkg({ digest: 'b'.repeat(64) });
    }).toThrow(/UNIQUE|PRIMARY/);
    pkg({ version: '1.1.0' });
  });

  it('refuses a dependency on itself, an unknown package or a bad range; cascades on delete', () => {
    pkg({});
    const dep = db.prepare(
      `INSERT INTO resource_dependencies (package_id, package_version, requirement_kind,
                                          dependency_id, version_range, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    expect(() =>
      dep.run('builtin.writer', '1.0.0', 'requires', 'builtin.writer', '1.0.0', T),
    ).toThrow(/CHECK/);
    expect(() =>
      dep.run('builtin.writer', '9.9.9', 'requires', 'builtin.brief', '1.0.0', T),
    ).toThrow(/FOREIGN KEY/);
    expect(() =>
      dep.run('builtin.writer', '1.0.0', 'requires', 'builtin.brief', '>=1.0.0', T),
    ).toThrow(/CHECK/);
    expect(() =>
      dep.run('builtin.writer', '1.0.0', 'optional', 'builtin.brief', '1.0.0', T),
    ).toThrow(/CHECK/);
    dep.run('builtin.writer', '1.0.0', 'requires', 'builtin.brief', '^1.0.0', T);

    db.prepare(`DELETE FROM resource_packages WHERE package_id = 'builtin.writer'`).run();
    expect(db.prepare('SELECT count(*) AS n FROM resource_dependencies').get()).toEqual({ n: 0 });
  });

  it('installs one version per world, of a recorded package with the right kind', () => {
    pkg({});
    pkg({ version: '1.1.0' });
    install(HOME, 'builtin.writer', '1.0.0', 'agent');
    expect(() => {
      install(HOME, 'builtin.writer', '1.1.0', 'agent');
    }).toThrow(/UNIQUE|PRIMARY/);
    install(OLD_WORLD, 'builtin.writer', '1.1.0', 'agent');
    expect(() => {
      install(HOME, 'builtin.unknown', '1.0.0', 'agent');
    }).toThrow(/FOREIGN KEY/);
    pkg({ id: 'builtin.brief', kind: 'skill', name: 'Brief' });
    expect(() => {
      install(HOME, 'builtin.brief', '1.0.0', 'agent');
    }).toThrow(/FOREIGN KEY/);
    expect(() => {
      install('00000000-0000-4000-8000-000000000000', 'builtin.brief', '1.0.0', 'skill');
    }).toThrow(/FOREIGN KEY/);
  });

  it('refuses deleting a package record while a world has it installed', () => {
    pkg({});
    install(HOME, 'builtin.writer', '1.0.0', 'agent');
    expect(() => db.prepare(`DELETE FROM resource_packages`).run()).toThrow(/FOREIGN KEY/);
  });

  it('only makes agents from an agent package installed in the project world', () => {
    team();
    install(OLD_WORLD, 'builtin.writer', '1.0.0', 'agent');
    // A project from another world.
    expect(() => {
      agent({ project: GARDEN });
    }).toThrow(/FOREIGN KEY/);
    // A skill is not an agent template.
    expect(() => {
      agent({ template: 'builtin.brief' });
    }).toThrow(/FOREIGN KEY/);
    // A version that is not the one installed in this world.
    expect(() => {
      agent({ version: '2.0.0' });
    }).toThrow(/FOREIGN KEY/);
    // The kind column can't be overridden.
    expect(() =>
      db
        .prepare(
          `INSERT INTO agent_instances (id, world_id, project_id, template_id, template_version,
                                        template_kind, created_at, updated_at)
           VALUES (?, ?, ?, 'builtin.brief', '1.0.0', 'skill', ?, ?)`,
        )
        .run(A1, HOME, LAUNCH, T, T),
    ).toThrow(/CHECK/);
    agent({ world: OLD_WORLD, project: GARDEN });
  });

  it('applies the display-name shape to nicknames', () => {
    team();
    expect(() => {
      agent({ nickname: '' });
    }).toThrow(/CHECK/);
    expect(() => {
      agent({ nickname: ' Quill' });
    }).toThrow(/CHECK/);
    expect(() => {
      agent({ nickname: 'Q'.repeat(81) });
    }).toThrow(/CHECK/);
    expect(() => {
      agent({ nickname: 'Qu\u0000ill' });
    }).toThrow(/CHECK/);
    agent({ nickname: null });
    agent({ id: A2, nickname: 'Quill' });
  });

  it('keeps skill bindings in the agent world and of kind skill; one per skill', () => {
    team();
    install(OLD_WORLD, 'builtin.brief', '1.0.0', 'skill');
    agent({});
    expect(() => {
      skillBinding(A1, OLD_WORLD, 'builtin.brief');
    }).toThrow(/FOREIGN KEY/);
    expect(() => {
      skillBinding(A1, HOME, 'builtin.files');
    }).toThrow(/FOREIGN KEY/);
    expect(() => {
      skillBinding(A1, HOME, 'builtin.brief', '2.0.0');
    }).toThrow(/FOREIGN KEY/);
    skillBinding(A1, HOME, 'builtin.brief');
    expect(() => {
      skillBinding(A1, HOME, 'builtin.brief');
    }).toThrow(/UNIQUE|PRIMARY/);
  });

  it('keeps tool bindings in the project world, of kind tool, with a JSON array', () => {
    team();
    expect(() => {
      toolBinding(GARDEN, OLD_WORLD, 'builtin.files');
    }).toThrow(/FOREIGN KEY/);
    expect(() => {
      toolBinding(LAUNCH, HOME, 'builtin.brief');
    }).toThrow(/FOREIGN KEY/);
    expect(() => {
      toolBinding(LAUNCH, HOME, 'builtin.files', '{"a":1}');
    }).toThrow(/CHECK/);
    expect(() => {
      toolBinding(LAUNCH, HOME, 'builtin.files', 'not json');
    }).toThrow(/CHECK/);
    expect(() => {
      toolBinding(LAUNCH, HOME, 'builtin.files', JSON.stringify(['x'.repeat(4100)]));
    }).toThrow(/CHECK/);
    toolBinding(LAUNCH, HOME, 'builtin.files');
    expect(() => {
      toolBinding(LAUNCH, HOME, 'builtin.files');
    }).toThrow(/UNIQUE|PRIMARY/);
  });

  it('refuses uninstalling a package while an agent or binding uses it', () => {
    team();
    agent({});
    skillBinding(A1, HOME, 'builtin.brief');
    toolBinding(LAUNCH, HOME, 'builtin.files');
    const uninstall = db.prepare(
      `DELETE FROM world_resources WHERE world_id = ? AND package_id = ?`,
    );
    expect(() => uninstall.run(HOME, 'builtin.writer')).toThrow(/FOREIGN KEY/);
    expect(() => uninstall.run(HOME, 'builtin.brief')).toThrow(/FOREIGN KEY/);
    expect(() => uninstall.run(HOME, 'builtin.files')).toThrow(/FOREIGN KEY/);
    // Changing the installed version under a user is refused too (upgrade = explicit step).
    pkg({ version: '1.1.0' });
    expect(() =>
      db
        .prepare(
          `UPDATE world_resources SET package_version = '1.1.0'
           WHERE world_id = ? AND package_id = 'builtin.writer'`,
        )
        .run(HOME),
    ).toThrow(/FOREIGN KEY/);
  });

  it('dismissing an agent deletes its skill bindings and nothing else', () => {
    team();
    agent({});
    skillBinding(A1, HOME, 'builtin.brief');
    toolBinding(LAUNCH, HOME, 'builtin.files');

    db.prepare('DELETE FROM agent_instances WHERE id = ?').run(A1);

    expect(db.prepare('SELECT count(*) AS n FROM agent_skill_bindings').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM project_tool_bindings').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT count(*) AS n FROM world_resources').get()).toEqual({ n: 3 });
    expect(db.prepare('SELECT count(*) AS n FROM resource_packages').get()).toEqual({ n: 3 });
    expect(db.prepare('SELECT count(*) AS n FROM projects WHERE id = ?').get(LAUNCH)).toEqual({
      n: 1,
    });
  });

  it('never lets a project with agents or bindings be deleted', () => {
    team();
    agent({});
    expect(() => db.prepare('DELETE FROM projects WHERE id = ?').run(LAUNCH)).toThrow(
      /FOREIGN KEY/,
    );
  });
});
