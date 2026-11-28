import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Database, openDatabase } from '../../src/main/storage/database';
import { migrate } from '../../src/main/storage/migrate';
import { MIGRATIONS } from '../../src/main/storage/migrations';
import { AgentInstanceRepository } from '../../src/main/storage/repositories/agent-instance-repository';
import { BindingRepository } from '../../src/main/storage/repositories/binding-repository';
import {
  type Project,
  ProjectRepository,
} from '../../src/main/storage/repositories/project-repository';
import { RepositoryError } from '../../src/main/storage/repositories/repository-support';
import {
  type NewResourcePackage,
  ResourcePackageRepository,
} from '../../src/main/storage/repositories/resource-package-repository';
import { WorldResourceRepository } from '../../src/main/storage/repositories/resource-world-repository';
import { type World, WorldRepository } from '../../src/main/storage/repositories/world-repository';
import type { CapabilityId } from '../../src/common/security/capabilities';

// The schema v7 repositories (M3-3 #113, ADR-0036): package records, installed packages,
// agent instances and bindings. Refusals write nothing; trashing a project, dismissing an agent
// or uninstalling a package never deletes a package record, project or another world's data.
let dir: string;
let db: Database;
let clock: Date;
let idCounter: number;
let worlds: WorldRepository;
let projects: ProjectRepository;
let packages: ResourcePackageRepository;
let installed: WorldResourceRepository;
let agents: AgentInstanceRepository;
let bindings: BindingRepository;
let home: World;
let other: World;
let launch: Project;
let garden: Project;

const tick = (): Date => {
  clock = new Date(clock.getTime() + 1_000);
  return clock;
};
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const nextId = (): string => uuid((idCounter += 1));

const DIGEST = 'a'.repeat(64);

const WRITER: NewResourcePackage = {
  packageId: 'builtin.writer',
  version: '1.0.0',
  kind: 'agent',
  name: 'Writer',
  publisher: 'Atlas Realm',
  source: 'bundled',
  digestSha256: DIGEST,
  license: 'UNLICENSED',
  reviewState: 'trusted',
  dependencies: [
    { requirementKind: 'default_skill', dependencyId: 'builtin.brief', versionRange: '^1.0.0' },
    { requirementKind: 'default_tool', dependencyId: 'builtin.files', versionRange: '^1.0.0' },
  ],
};
const BRIEF: NewResourcePackage = {
  ...WRITER,
  packageId: 'builtin.brief',
  kind: 'skill',
  name: 'Structured Brief',
  digestSha256: 'b'.repeat(64),
  dependencies: [],
};
const FILES: NewResourcePackage = {
  ...WRITER,
  packageId: 'builtin.files',
  kind: 'tool',
  name: 'Project Files',
  digestSha256: 'c'.repeat(64),
  dependencies: [],
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-resources-'));
  clock = new Date('2026-11-28T12:00:00.000Z');
  idCounter = 0;
  db = openDatabase(join(dir, 'app.sqlite'));
  await migrate(db, MIGRATIONS, { backupDir: join(dir, 'backups') });
  worlds = new WorldRepository(db, tick, nextId);
  projects = new ProjectRepository(db, tick, nextId);
  packages = new ResourcePackageRepository(db, tick);
  installed = new WorldResourceRepository(db, tick);
  agents = new AgentInstanceRepository(db, tick, nextId);
  bindings = new BindingRepository(db, tick);
  home = worlds.create({ name: 'Home', themeId: 'meadow' });
  other = worlds.create({ name: 'Other', themeId: 'meadow' });
  launch = newProject(home, 'Launch plan');
  garden = newProject(other, 'Garden');
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function newProject(world: World, name: string): Project {
  return projects.create({
    worldId: world.id,
    name,
    templateId: 'builtin.generic',
    templateVersion: '1.0.0',
  });
}

/** Records the three packages and installs them (enabled) in `world`. */
function installTeam(world: World): void {
  for (const pkg of [WRITER, BRIEF, FILES]) {
    packages.record(pkg);
    installed.install({
      worldId: world.id,
      packageId: pkg.packageId,
      packageVersion: pkg.version,
      enabled: true,
    });
  }
}

const count = (table: string): number =>
  (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(RepositoryError);
    expect((error as RepositoryError).code).toBe(code);
    return;
  }
  throw new Error(`expected a ${code} refusal`);
}

describe('ResourcePackageRepository', () => {
  it('records a package with typed fields and its dependencies', () => {
    const recorded = packages.record(WRITER);
    expect(recorded).toEqual({
      packageId: 'builtin.writer',
      version: '1.0.0',
      kind: 'agent',
      name: 'Writer',
      publisher: 'Atlas Realm',
      source: 'bundled',
      sourceRevision: null,
      digestSha256: DIGEST,
      license: 'UNLICENSED',
      reviewState: 'trusted',
      createdAt: clock.toISOString(),
      updatedAt: clock.toISOString(),
      revision: 1,
    });
    expect(packages.get('builtin.writer', '1.0.0')).toEqual(recorded);
    expect(packages.listDependencies('builtin.writer', '1.0.0')).toEqual([
      { requirementKind: 'default_skill', dependencyId: 'builtin.brief', versionRange: '^1.0.0' },
      { requirementKind: 'default_tool', dependencyId: 'builtin.files', versionRange: '^1.0.0' },
    ]);
  });

  it('returns the existing record for the same content and refuses different content', () => {
    const first = packages.record(WRITER);
    expect(packages.record(WRITER)).toEqual(first);
    expectCode(
      () => packages.record({ ...WRITER, digestSha256: 'd'.repeat(64) }),
      'already_exists',
    );
    expectCode(
      () => packages.record({ ...WRITER, kind: 'skill', dependencies: [] }),
      'already_exists',
    );
    expect(packages.record({ ...WRITER, version: '1.1.0' }).version).toBe('1.1.0');
    expect(packages.list().map((p) => p.version)).toEqual(['1.0.0', '1.1.0']);
  });

  it('refuses malformed input and writes nothing', () => {
    const bad: Partial<NewResourcePackage>[] = [
      { packageId: 'Writer' },
      { packageId: 'builtin' },
      { version: '1.0' },
      { kind: 'workflow' as never },
      { source: 'web' as never },
      { reviewState: 'approved' },
      { source: 'local', reviewState: 'trusted' },
      { digestSha256: 'A'.repeat(64) },
      { license: 'PROJECT LICENSE' },
      { name: '' },
      { name: 'Writer‮' },
      { publisher: 'x'.repeat(81) },
      { sourceRevision: 'has space' },
      {
        dependencies: [
          { requirementKind: 'requires', dependencyId: 'builtin.writer', versionRange: '1.0.0' },
        ],
      },
      {
        dependencies: [
          { requirementKind: 'requires', dependencyId: 'builtin.brief', versionRange: '>=1.0.0' },
        ],
      },
      {
        dependencies: [
          { requirementKind: 'requires', dependencyId: 'builtin.brief', versionRange: '1.0.0' },
          { requirementKind: 'requires', dependencyId: 'builtin.brief', versionRange: '^1.0.0' },
        ],
      },
    ];
    for (const change of bad) {
      expectCode(() => packages.record({ ...WRITER, ...change }), 'invalid_input');
    }
    // Default skills/tools belong to agents only.
    expectCode(
      () =>
        packages.record({
          ...BRIEF,
          dependencies: [
            {
              requirementKind: 'default_tool',
              dependencyId: 'builtin.files',
              versionRange: '1.0.0',
            },
          ],
        }),
      'invalid_input',
    );
    expect(count('resource_packages')).toBe(0);
    expect(count('resource_dependencies')).toBe(0);
  });

  it('keeps an imported package with its source revision', () => {
    const imported = packages.record({
      ...WRITER,
      packageId: 'acme.writer',
      source: 'github',
      sourceRevision: '0123456789abcdef0123456789abcdef01234567',
      reviewState: 'unreviewed',
      license: 'MIT',
      dependencies: [],
    });
    expect(imported).toMatchObject({ source: 'github', reviewState: 'unreviewed' });
  });
});

describe('WorldResourceRepository', () => {
  it('installs one version per world, with the kind from the record', () => {
    packages.record(WRITER);
    packages.record({ ...WRITER, version: '1.1.0' });
    const row = installed.install({
      worldId: home.id,
      packageId: 'builtin.writer',
      packageVersion: '1.0.0',
      enabled: false,
    });
    expect(row).toMatchObject({ kind: 'agent', enabled: false, revision: 1 });
    expectCode(
      () =>
        installed.install({
          worldId: home.id,
          packageId: 'builtin.writer',
          packageVersion: '1.1.0',
          enabled: true,
        }),
      'already_exists',
    );
    installed.install({
      worldId: other.id,
      packageId: 'builtin.writer',
      packageVersion: '1.1.0',
      enabled: true,
    });
    expect(installed.listByWorld(home.id).map((r) => r.packageVersion)).toEqual(['1.0.0']);
  });

  it('refuses an unknown world or package record, and a non-boolean enabled', () => {
    packages.record(WRITER);
    expectCode(
      () =>
        installed.install({
          worldId: uuid(999),
          packageId: 'builtin.writer',
          packageVersion: '1.0.0',
          enabled: true,
        }),
      'not_found',
    );
    expectCode(
      () =>
        installed.install({
          worldId: home.id,
          packageId: 'builtin.writer',
          packageVersion: '9.0.0',
          enabled: true,
        }),
      'not_found',
    );
    expectCode(
      () =>
        installed.install({
          worldId: home.id,
          packageId: 'builtin.writer',
          packageVersion: '1.0.0',
          enabled: 1 as never,
        }),
      'invalid_input',
    );
    expect(count('world_resources')).toBe(0);
  });

  it('switches enabled with a revision check', () => {
    installTeam(home);
    const on = installed.get(home.id, 'builtin.brief');
    expect(on?.enabled).toBe(true);
    const off = installed.setEnabled(home.id, 'builtin.brief', false, 1);
    expect(off).toMatchObject({ enabled: false, revision: 2 });
    expectCode(() => installed.setEnabled(home.id, 'builtin.brief', true, 1), 'revision_conflict');
    expectCode(() => installed.setEnabled(other.id, 'builtin.brief', true, 1), 'not_found');
  });

  it('refuses uninstalling while used, naming the users; the record stays after uninstall', () => {
    installTeam(home);
    const agent = agents.create({ projectId: launch.id, templateId: 'builtin.writer' });
    bindings.bindSkill({ agentInstanceId: agent.id, skillId: 'builtin.brief', enabled: true });
    bindings.bindTool({ projectId: launch.id, toolId: 'builtin.files', enabledCapabilities: [] });

    expect(installed.usersOf(home.id, 'builtin.writer').agentInstanceIds).toEqual([agent.id]);
    expect(installed.usersOf(home.id, 'builtin.brief').skillBoundAgentIds).toEqual([agent.id]);
    expect(installed.usersOf(home.id, 'builtin.files').toolBoundProjectIds).toEqual([launch.id]);
    for (const id of ['builtin.writer', 'builtin.brief', 'builtin.files']) {
      expectCode(() => installed.uninstall(home.id, id, 1), 'invalid_transition');
    }
    // A stale revision is reported as a conflict, not as "in use".
    expectCode(() => installed.uninstall(home.id, 'builtin.writer', 7), 'revision_conflict');

    bindings.unbindTool(launch.id, 'builtin.files', 1);
    expect(installed.uninstall(home.id, 'builtin.files', 1).packageId).toBe('builtin.files');
    expect(installed.get(home.id, 'builtin.files')).toBeUndefined();
    expect(packages.get('builtin.files', '1.0.0')).toBeDefined();
    expectCode(() => installed.uninstall(home.id, 'builtin.files', 1), 'not_found');
  });
});

describe('AgentInstanceRepository', () => {
  beforeEach(() => {
    installTeam(home);
  });

  it('recruits an idle agent from the installed template, with typed fields', () => {
    const agent = agents.create({
      projectId: launch.id,
      templateId: 'builtin.writer',
      nickname: '  Quill  ',
      appearanceId: 'placeholder.agent.scribe',
    });
    expect(agent).toEqual({
      id: expect.any(String) as string,
      worldId: home.id,
      projectId: launch.id,
      templateId: 'builtin.writer',
      templateVersion: '1.0.0',
      nickname: 'Quill',
      appearanceId: 'placeholder.agent.scribe',
      createdAt: expect.any(String) as string,
      updatedAt: expect.any(String) as string,
      revision: 1,
    });
    expect(agents.listByProject(launch.id)).toEqual([agent]);
    // Recruiting starts no work: no other table changes.
    expect(count('agent_skill_bindings')).toBe(0);
    expect(count('project_tool_bindings')).toBe(0);
  });

  it('refuses unknown projects, templates not installed there, and non-agent packages', () => {
    expectCode(
      () => agents.create({ projectId: uuid(999), templateId: 'builtin.writer' }),
      'not_found',
    );
    // Installed in HOME only, and GARDEN is in OTHER.
    expectCode(
      () => agents.create({ projectId: garden.id, templateId: 'builtin.writer' }),
      'not_found',
    );
    expectCode(
      () => agents.create({ projectId: launch.id, templateId: 'builtin.brief' }),
      'not_found',
    );
    expect(count('agent_instances')).toBe(0);
  });

  it('applies display-name rules to nicknames', () => {
    for (const nickname of ['', '   ', 'x'.repeat(81), 'Qu\u0000ill', 'Line\nbreak', 'Quill​']) {
      expectCode(
        () => agents.create({ projectId: launch.id, templateId: 'builtin.writer', nickname }),
        'invalid_input',
      );
    }
    expectCode(
      () =>
        agents.create({ projectId: launch.id, templateId: 'builtin.writer', appearanceId: '../x' }),
      'invalid_input',
    );
    expect(count('agent_instances')).toBe(0);
  });

  it('updates nickname and appearance with a revision check', () => {
    const agent = agents.create({ projectId: launch.id, templateId: 'builtin.writer' });
    const renamed = agents.update(agent.id, 1, { nickname: 'Quill' });
    expect(renamed).toMatchObject({ nickname: 'Quill', appearanceId: null, revision: 2 });
    expect(agents.update(agent.id, 2, { nickname: null }).nickname).toBeNull();
    expectCode(() => agents.update(agent.id, 1, { nickname: 'Late' }), 'revision_conflict');
    expectCode(() => agents.update(agent.id, 3, {}), 'invalid_input');
  });

  it('dismissing deletes the agent and its skills, and nothing else', () => {
    const agent = agents.create({ projectId: launch.id, templateId: 'builtin.writer' });
    bindings.bindSkill({ agentInstanceId: agent.id, skillId: 'builtin.brief', enabled: true });
    bindings.bindTool({ projectId: launch.id, toolId: 'builtin.files', enabledCapabilities: [] });

    expectCode(() => agents.dismiss(agent.id, 5), 'revision_conflict');
    expect(agents.dismiss(agent.id, 1).id).toBe(agent.id);

    expect(agents.get(agent.id)).toBeUndefined();
    expect(bindings.listSkills(agent.id)).toEqual([]);
    expect(bindings.listTools(launch.id)).toHaveLength(1);
    expect(installed.listByWorld(home.id)).toHaveLength(3);
    expect(packages.list()).toHaveLength(3);
    expect(projects.get(launch.id)?.status).toBe('active');
    expectCode(() => agents.dismiss(agent.id, 1), 'not_found');
  });
});

describe('BindingRepository', () => {
  beforeEach(() => {
    installTeam(home);
  });

  it('binds an installed skill to an agent, switches it and removes it', () => {
    const agent = agents.create({ projectId: launch.id, templateId: 'builtin.writer' });
    const skill = bindings.bindSkill({
      agentInstanceId: agent.id,
      skillId: 'builtin.brief',
      enabled: true,
    });
    expect(skill).toMatchObject({ worldId: home.id, skillVersion: '1.0.0', enabled: true });
    expectCode(
      () =>
        bindings.bindSkill({ agentInstanceId: agent.id, skillId: 'builtin.brief', enabled: true }),
      'already_exists',
    );
    expect(bindings.setSkillEnabled(agent.id, 'builtin.brief', false, 1).enabled).toBe(false);
    expectCode(() => bindings.unbindSkill(agent.id, 'builtin.brief', 1), 'revision_conflict');
    bindings.unbindSkill(agent.id, 'builtin.brief', 2);
    expect(bindings.listSkills(agent.id)).toEqual([]);
  });

  it('refuses skills that are not installed skills in the agent world', () => {
    const agent = agents.create({ projectId: launch.id, templateId: 'builtin.writer' });
    expectCode(
      () =>
        bindings.bindSkill({ agentInstanceId: uuid(999), skillId: 'builtin.brief', enabled: true }),
      'not_found',
    );
    expectCode(
      () =>
        bindings.bindSkill({ agentInstanceId: agent.id, skillId: 'builtin.files', enabled: true }),
      'not_found',
    );
    expectCode(
      () =>
        bindings.bindSkill({ agentInstanceId: agent.id, skillId: 'builtin.nope', enabled: true }),
      'not_found',
    );
    expect(count('agent_skill_bindings')).toBe(0);
  });

  it('binds a tool with switched-on capabilities and writes no grant', () => {
    const tablesBefore = db.prepare(`SELECT name FROM sqlite_schema WHERE type = 'table'`).all();
    const tool = bindings.bindTool({
      projectId: launch.id,
      toolId: 'builtin.files',
      enabledCapabilities: ['project.files.read', 'project.files.list'],
    });
    expect(tool).toMatchObject({
      worldId: home.id,
      toolVersion: '1.0.0',
      enabledCapabilities: ['project.files.read', 'project.files.list'],
    });
    // No grant table exists yet, and binding created none.
    expect(db.prepare(`SELECT name FROM sqlite_schema WHERE type = 'table'`).all()).toEqual(
      tablesBefore,
    );
    const updated = bindings.setToolCapabilities(launch.id, 'builtin.files', [], 1);
    expect(updated).toMatchObject({ enabledCapabilities: [], revision: 2 });
  });

  it('refuses unknown or repeated capabilities and tools not installed there', () => {
    const bad: unknown[][] = [
      ['process.execute'],
      ['made.up'],
      ['project.files.read', 'project.files.read'],
    ];
    for (const enabledCapabilities of bad) {
      expectCode(
        () =>
          bindings.bindTool({
            projectId: launch.id,
            toolId: 'builtin.files',
            enabledCapabilities: enabledCapabilities as CapabilityId[],
          }),
        'invalid_input',
      );
    }
    expectCode(
      () =>
        bindings.bindTool({
          projectId: garden.id,
          toolId: 'builtin.files',
          enabledCapabilities: [],
        }),
      'not_found',
    );
    expectCode(
      () =>
        bindings.bindTool({
          projectId: launch.id,
          toolId: 'builtin.brief',
          enabledCapabilities: [],
        }),
      'not_found',
    );
    expect(count('project_tool_bindings')).toBe(0);
  });

  it('drops a stored capability the app no longer knows when reading', () => {
    bindings.bindTool({ projectId: launch.id, toolId: 'builtin.files', enabledCapabilities: [] });
    db.prepare(
      `UPDATE project_tool_bindings SET enabled_capabilities = '["project.files.read","old.cap"]'`,
    ).run();
    expect(bindings.getTool(launch.id, 'builtin.files')?.enabledCapabilities).toEqual([
      'project.files.read',
    ]);
  });
});

describe('trashing a project (PRODUCT_RULES §3.1)', () => {
  it('keeps package records, installed packages, agents and bindings', () => {
    installTeam(home);
    const agent = agents.create({ projectId: launch.id, templateId: 'builtin.writer' });
    bindings.bindSkill({ agentInstanceId: agent.id, skillId: 'builtin.brief', enabled: true });
    bindings.bindTool({ projectId: launch.id, toolId: 'builtin.files', enabledCapabilities: [] });

    projects.trash(launch.id, launch.revision);

    expect(projects.get(launch.id)?.status).toBe('trashed');
    expect(packages.list()).toHaveLength(3);
    expect(packages.listDependencies('builtin.writer', '1.0.0')).toHaveLength(2);
    expect(installed.listByWorld(home.id)).toHaveLength(3);
    expect(agents.listByProject(launch.id)).toEqual([agent]);
    expect(bindings.listSkills(agent.id)).toHaveLength(1);
    expect(bindings.listTools(launch.id)).toHaveLength(1);
  });
});

describe('security review fixes (#113)', () => {
  const ACME: NewResourcePackage = {
    ...WRITER,
    packageId: 'acme.writer',
    source: 'local',
    reviewState: 'unreviewed',
    license: 'MIT',
    dependencies: [],
  };

  it('keeps builtin.* for bundled packages and refuses URL-like source revisions', () => {
    expectCode(
      () => packages.record({ ...WRITER, source: 'local', reviewState: 'unreviewed' }),
      'invalid_input',
    );
    expectCode(
      () => packages.record({ ...ACME, source: 'bundled', reviewState: 'trusted' }),
      'invalid_input',
    );
    for (const sourceRevision of ['https://user:ghp_x@github.com/a/b', 'user@host', 'a b']) {
      expectCode(
        () => packages.record({ ...ACME, source: 'github', sourceRevision }),
        'invalid_input',
      );
    }
    expect(count('resource_packages')).toBe(0);
  });

  it('never returns an existing record to a caller with other provenance', () => {
    packages.record(ACME);
    expectCode(() => packages.record({ ...ACME, reviewState: 'approved' }), 'already_exists');
    expectCode(() => packages.record({ ...ACME, source: 'github' }), 'already_exists');
    expect(packages.get('acme.writer', '1.0.0')?.reviewState).toBe('unreviewed');
  });

  it('refuses installing, recruiting and binding blocked packages', () => {
    packages.record({ ...ACME, reviewState: 'blocked' });
    expectCode(
      () =>
        installed.install({
          worldId: home.id,
          packageId: 'acme.writer',
          packageVersion: '1.0.0',
          enabled: true,
        }),
      'invalid_transition',
    );
    expect(count('world_resources')).toBe(0);

    // Blocked after installing (a later review): recruiting and binding are refused.
    installTeam(home);
    const agent = agents.create({ projectId: launch.id, templateId: 'builtin.writer' });
    db.prepare(
      `UPDATE resource_packages SET review_state = 'blocked' WHERE source <> 'bundled'`,
    ).run();
    db.exec(`
      INSERT INTO resource_packages (package_id, version, kind, name, publisher, source,
                                     digest_sha256, license, review_state, created_at, updated_at)
      VALUES ('acme.brief', '1.0.0', 'skill', 'Brief', 'Acme', 'local', '${DIGEST}', 'MIT',
              'unreviewed', 'x', 'x'),
             ('acme.files', '1.0.0', 'tool', 'Files', 'Acme', 'local', '${DIGEST}', 'MIT',
              'unreviewed', 'x', 'x'),
             ('acme.agent', '1.0.0', 'agent', 'Agent', 'Acme', 'local', '${DIGEST}', 'MIT',
              'unreviewed', 'x', 'x');
    `);
    for (const id of ['acme.brief', 'acme.files', 'acme.agent']) {
      installed.install({
        worldId: home.id,
        packageId: id,
        packageVersion: '1.0.0',
        enabled: true,
      });
    }
    db.prepare(
      `UPDATE resource_packages SET review_state = 'blocked' WHERE package_id LIKE 'acme.%'`,
    ).run();
    expectCode(
      () => agents.create({ projectId: launch.id, templateId: 'acme.agent' }),
      'invalid_transition',
    );
    expectCode(
      () => bindings.bindSkill({ agentInstanceId: agent.id, skillId: 'acme.brief', enabled: true }),
      'invalid_transition',
    );
    expectCode(
      () =>
        bindings.bindTool({ projectId: launch.id, toolId: 'acme.files', enabledCapabilities: [] }),
      'invalid_transition',
    );
  });

  it('still lets a disabled package be assigned (readiness reports it, DATA_MODEL §10.2)', () => {
    installTeam(home);
    installed.setEnabled(home.id, 'builtin.writer', false, 1);
    installed.setEnabled(home.id, 'builtin.brief', false, 1);
    const agent = agents.create({ projectId: launch.id, templateId: 'builtin.writer' });
    expect(
      bindings.bindSkill({ agentInstanceId: agent.id, skillId: 'builtin.brief', enabled: true })
        .enabled,
    ).toBe(true);
  });

  it('drops refused and repeated capabilities when reading (fail closed)', () => {
    installTeam(home);
    bindings.bindTool({ projectId: launch.id, toolId: 'builtin.files', enabledCapabilities: [] });
    db.prepare(
      `UPDATE project_tool_bindings
       SET enabled_capabilities = '["process.execute","project.files.read","project.files.read"]'`,
    ).run();
    expect(bindings.getTool(launch.id, 'builtin.files')?.enabledCapabilities).toEqual([
      'project.files.read',
    ]);
  });

  it('turns forged non-string input into invalid_input', () => {
    installTeam(home);
    const forged = { id: 1 } as never;
    expectCode(
      () => agents.create({ projectId: forged, templateId: 'builtin.writer' }),
      'invalid_input',
    );
    expectCode(
      () => agents.create({ projectId: launch.id, templateId: 'builtin.writer', nickname: forged }),
      'invalid_input',
    );
    expectCode(
      () =>
        bindings.bindSkill({ agentInstanceId: forged, skillId: 'builtin.brief', enabled: true }),
      'invalid_input',
    );
    expectCode(
      () => bindings.bindTool({ projectId: launch.id, toolId: forged, enabledCapabilities: [] }),
      'invalid_input',
    );
    expectCode(
      () =>
        installed.install({
          worldId: forged,
          packageId: 'builtin.writer',
          packageVersion: '1.0.0',
          enabled: true,
        }),
      'invalid_input',
    );
    expectCode(() => packages.record({ ...WRITER, dependencies: forged }), 'invalid_input');
    expectCode(
      () => packages.record({ ...WRITER, dependencies: [null as never] }),
      'invalid_input',
    );
  });
});
