// Contract tests for `project.*` (M1-7 #34) through the real router, against real profile
// databases in a temp directory and the real bundled templates. Covers forged input (unknown
// IDs, another world's or profile's IDs, stale revisions, tampered cursors), paging, the
// archive/trash lifecycle without deletes, the stubbed active-runs check, and identity across
// a rename and a restart.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { MAX_PROJECTS_PER_WORLD, type ProjectSummary } from '../../src/common/contracts/project';
import { APP_ENTRY_URL } from '../../src/main/bootstrap/app-origin';
import {
  createProjectArchiveHandler,
  createProjectCreateHandler,
  createProjectGetHandler,
  createProjectListHandler,
  createProjectRenameHandler,
  createProjectRestoreFromTrashHandler,
  createProjectRestoreHandler,
  createProjectTrashHandler,
  createProjectUpdateGoalHandler,
  projectArchiveCommand,
  projectCreateCommand,
  projectGetCommand,
  projectListCommand,
  projectRenameCommand,
  projectRestoreCommand,
  projectRestoreFromTrashCommand,
  projectTrashCommand,
  projectUpdateGoalCommand,
} from '../../src/main/ipc/commands/project';
import {
  type CommandDefinition,
  type CommandHandler,
  createCommandHandler,
  trustRendererEntry,
} from '../../src/main/ipc/router';
import { ActiveProfile } from '../../src/main/profiles/active-profile';
import { ProfileService } from '../../src/main/profiles/profile-service';
import {
  type ActiveRunsProbe,
  noActiveRunsStub,
  ProjectService,
} from '../../src/main/services/project-service';
import { openAppDatabase } from '../../src/main/storage/app-database';
import { type Database, withTransaction } from '../../src/main/storage/database';
import { toProfileId } from '../../src/main/storage/profiles/profile-id';
import { openStartupProfile, type StartupProfile } from '../../src/main/storage/profiles/startup';
import { ProjectRepository } from '../../src/main/storage/repositories/project-repository';
import { type World, WorldRepository } from '../../src/main/storage/repositories/world-repository';
import { bundledTemplateFiles } from '../../src/main/templates/bundled-templates';
import { buildTemplateCatalog, type TemplateCatalog } from '../../src/main/templates/catalog';

const isTrusted = trustRendererEntry(APP_ENTRY_URL);
const trusted = { senderFrame: { url: APP_ENTRY_URL, parent: null } };
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

// The real bundled templates plus one broken file, so "unavailable" can be tested too.
const catalog: TemplateCatalog = buildTemplateCatalog(
  { ...bundledTemplateFiles(), 'broken/1.0.0': { id: 'builtin.broken' } },
  () => undefined,
);

let userData: string;
let opened: StartupProfile;
let active: ActiveProfile;
let service: ProjectService;
let world: World;
const extraDbs: Database[] = [];

function call<I extends z.ZodType, O extends z.ZodType>(
  definition: CommandDefinition<I, O>,
  handler: CommandHandler<I, O>,
  payload: unknown,
) {
  return createCommandHandler(definition, handler, isTrusted)(trusted, payload);
}

const create = (payload: unknown) =>
  call(projectCreateCommand, createProjectCreateHandler(service), payload);
const get = (payload: unknown) =>
  call(projectGetCommand, createProjectGetHandler(service), payload);
const list = (payload: unknown) =>
  call(projectListCommand, createProjectListHandler(service), payload);
const rename = (payload: unknown) =>
  call(projectRenameCommand, createProjectRenameHandler(service), payload);
const updateGoal = (payload: unknown) =>
  call(projectUpdateGoalCommand, createProjectUpdateGoalHandler(service), payload);
const archive = (payload: unknown) =>
  call(projectArchiveCommand, createProjectArchiveHandler(service), payload);
const restore = (payload: unknown) =>
  call(projectRestoreCommand, createProjectRestoreHandler(service), payload);
const trash = (payload: unknown) =>
  call(projectTrashCommand, createProjectTrashHandler(service), payload);
const restoreFromTrash = (payload: unknown) =>
  call(projectRestoreFromTrashCommand, createProjectRestoreFromTrashHandler(service), payload);

const newProjectInput = (name = 'Launch plan', worldId = world.id) => ({
  worldId,
  templateId: 'builtin.generic',
  templateVersion: '1.0.0',
  name,
  goal: 'Ship the spring campaign',
});

async function createProject(name = 'Launch plan', worldId = world.id): Promise<ProjectSummary> {
  const result = await create(newProjectInput(name, worldId));
  if (!result.ok) throw new Error(result.error.code);
  return result.data.project;
}

const change = (project: ProjectSummary) => ({
  worldId: project.worldId,
  projectId: project.id,
  expectedRevision: project.revision,
});

function count(table: 'projects' | 'graph_entities'): number {
  return Number(opened.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.['n']);
}

beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'atlas-project-cmd-'));
  opened = await openStartupProfile(userData);
  active = new ActiveProfile(userData, { profileId: opened.profileId, db: opened.db });
  service = new ProjectService(active, catalog);
  world = new WorldRepository(opened.db).create({ name: 'Home', themeId: 'meadow' });
});

afterEach(() => {
  for (const db of extraDbs.splice(0)) if (db.isOpen) db.close();
  if (opened.db.isOpen) opened.db.close();
  rmSync(userData, { recursive: true, force: true });
});

describe('project.create', () => {
  it('creates an active project from a bundled (namespaced) template', async () => {
    const result = await create({ ...newProjectInput('  Launch plan  '), goal: undefined });
    expect(result).toMatchObject({
      ok: true,
      data: {
        project: {
          worldId: world.id,
          name: 'Launch plan',
          goal: '',
          templateId: 'builtin.generic',
          templateVersion: '1.0.0',
          status: 'active',
          archivedAt: null,
          trashedAt: null,
          revision: 1,
        },
      },
    });
    // The project got its graph entity in the same change (M1-4).
    expect(count('graph_entities')).toBe(2);
  });

  it.each([
    ['unknown template', { templateId: 'builtin.nope' }],
    ['unknown version of a real template', { templateVersion: '9.9.9' }],
    ['template that failed validation at startup', { templateId: 'builtin.broken' }],
  ])('refuses a %s as not_found', async (_label, override) => {
    await expect(create({ ...newProjectInput(), ...override })).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found', message: 'That template is not available.' },
    });
    expect(count('projects')).toBe(0);
  });

  it('refuses an unknown world as not_found', async () => {
    await expect(create(newProjectInput('X', UNKNOWN_ID))).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('refuses an archived world as invalid_transition', async () => {
    new WorldRepository(opened.db).archive(world.id, world.revision);
    await expect(create(newProjectInput())).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_transition' },
    });
  });

  it(`refuses more than ${String(MAX_PROJECTS_PER_WORLD)} projects per world, trash included`, async () => {
    const repository = new ProjectRepository(opened.db);
    withTransaction(opened.db, () => {
      for (let i = 0; i < MAX_PROJECTS_PER_WORLD; i++) {
        const project = repository.create({
          worldId: world.id,
          name: `P${String(i)}`,
          templateId: 'builtin.generic',
          templateVersion: '1.0.0',
        });
        if (i === 0) repository.trash(project.id, project.revision);
      }
    });
    await expect(create(newProjectInput('One too many'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'limit_reached' },
    });
    // Another world has its own budget.
    const other = new WorldRepository(opened.db).create({ name: 'Other', themeId: 'meadow' });
    await expect(create(newProjectInput('Fine', other.id))).resolves.toMatchObject({ ok: true });
  });

  it.each([
    ['chosen ID', { id: UNKNOWN_ID }],
    ['chosen status', { status: 'archived' }],
    ['chosen revision', { revision: 7 }],
    ['path-like template', { templateId: '../generic' }],
    ['uppercase template', { templateId: 'Builtin.Generic' }],
    ['bad version', { templateVersion: '1.0' }],
    ['missing world', { worldId: undefined }],
    ['non-UUID world', { worldId: 'home' }],
    ['oversize name', { name: 'x'.repeat(81) }],
    ['empty name', { name: '   ' }],
    ['control character in goal', { goal: `Goal${String.fromCharCode(7)}` }],
    ['zero-width space in goal', { goal: `Go${String.fromCharCode(0x200b)}al` }],
    ['oversize goal', { goal: 'x'.repeat(2001) }],
  ])('rejects a forged payload (%s) and creates nothing', async (_label, override) => {
    await expect(create({ ...newProjectInput(), ...override })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_payload' },
    });
    expect(count('projects')).toBe(0);
  });

  it('accepts a multi-line goal of exactly 2000 characters', async () => {
    const goal = `${'x'.repeat(999)}\n${'y'.repeat(1000)}`;
    await expect(create({ ...newProjectInput(), goal })).resolves.toMatchObject({
      ok: true,
      data: { project: { goal } },
    });
  });
});

describe('project.get', () => {
  it('reads a project by ID', async () => {
    const project = await createProject();
    await expect(get({ worldId: world.id, projectId: project.id })).resolves.toEqual({
      ok: true,
      data: { project },
    });
  });

  it('answers not_found for an unknown ID and for a project in another world', async () => {
    const project = await createProject();
    const other = new WorldRepository(opened.db).create({ name: 'Other', themeId: 'meadow' });
    for (const payload of [
      { worldId: world.id, projectId: UNKNOWN_ID },
      { worldId: other.id, projectId: project.id },
    ]) {
      await expect(get(payload)).resolves.toMatchObject({
        ok: false,
        error: { code: 'not_found', message: 'That item does not exist in this profile.' },
      });
    }
  });

  it("cannot see another profile's project", async () => {
    const created = await new ProfileService(active).create('Work');
    const other = await openAppDatabase(userData, toProfileId(created.id), {
      requireExisting: true,
    });
    extraDbs.push(other.db);
    const foreignWorld = new WorldRepository(other.db).create({
      name: 'Secret',
      themeId: 'meadow',
    });
    const foreign = new ProjectRepository(other.db).create({
      worldId: foreignWorld.id,
      name: 'Secret plan',
      templateId: 'builtin.generic',
      templateVersion: '1.0.0',
    });

    await expect(get({ worldId: foreignWorld.id, projectId: foreign.id })).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    await expect(list({ worldId: foreignWorld.id })).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    await expect(
      trash({ worldId: foreignWorld.id, projectId: foreign.id, expectedRevision: 1 }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(new ProjectRepository(other.db).get(foreign.id)?.status).toBe('active');
  });

  it.each([
    ['no world', { projectId: UNKNOWN_ID }],
    ['extra key', { worldId: UNKNOWN_ID, projectId: UNKNOWN_ID, name: 'x' }],
    ['uppercase UUID', { worldId: UNKNOWN_ID, projectId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }],
    ['no payload', undefined],
  ])('rejects a forged payload (%s)', async (_label, payload) => {
    await expect(get(payload)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_payload' },
    });
  });
});

describe('project.list', () => {
  async function pageNames(payload: Record<string, unknown>): Promise<string[][]> {
    const pages: string[][] = [];
    let cursor: string | undefined;
    for (;;) {
      const result = await list({ ...payload, cursor });
      if (!result.ok) throw new Error(result.error.code);
      pages.push(result.data.projects.map((p) => p.name));
      if (result.data.nextCursor === null) return pages;
      cursor = result.data.nextCursor;
    }
  }

  it('pages through active projects by name with an opaque cursor', async () => {
    for (const name of ['delta', 'Alpha', 'charlie', 'Bravo', 'echo']) await createProject(name);
    expect(await pageNames({ worldId: world.id, limit: 2 })).toEqual([
      ['Alpha', 'Bravo'],
      ['charlie', 'delta'],
      ['echo'],
    ]);
    // Default page size (50) fits everything in one page.
    expect(await pageNames({ worldId: world.id })).toEqual([
      ['Alpha', 'Bravo', 'charlie', 'delta', 'echo'],
    ]);
  });

  it('filters by status and only shows the named world', async () => {
    await createProject('Active');
    const toArchive = await createProject('Archived');
    await archive(change(toArchive));
    const toTrash = await createProject('Trashed');
    await trash(change(toTrash));
    const other = new WorldRepository(opened.db).create({ name: 'Other', themeId: 'meadow' });
    await createProject('Elsewhere', other.id);

    expect(await pageNames({ worldId: world.id })).toEqual([['Active']]);
    expect(await pageNames({ worldId: world.id, status: 'archived' })).toEqual([['Archived']]);
    expect(await pageNames({ worldId: world.id, status: 'trashed' })).toEqual([['Trashed']]);
  });

  it('refuses a cursor made for another status or world', async () => {
    for (const name of ['A', 'B']) await createProject(name);
    const first = await list({ worldId: world.id, limit: 1 });
    if (!first.ok || first.data.nextCursor === null) throw new Error('expected a cursor');
    const cursor = first.data.nextCursor;
    const other = new WorldRepository(opened.db).create({ name: 'Other', themeId: 'meadow' });

    for (const payload of [
      { worldId: world.id, status: 'trashed', cursor },
      { worldId: other.id, cursor },
    ]) {
      await expect(list(payload)).resolves.toMatchObject({
        ok: false,
        error: { code: 'invalid_payload' },
      });
    }
  });

  it.each([
    ['not base64url', '***'],
    ['not JSON', Buffer.from('hello').toString('base64url')],
    ['wrong shape', Buffer.from(JSON.stringify({ v: 1 })).toString('base64url')],
    [
      'extra key',
      Buffer.from(
        JSON.stringify({ v: 1, w: UNKNOWN_ID, s: 'active', n: 'A', i: UNKNOWN_ID, x: 1 }),
      ).toString('base64url'),
    ],
    ['too long', 'A'.repeat(1025)],
  ])('refuses a tampered cursor (%s)', async (_label, cursor) => {
    await expect(list({ worldId: world.id, cursor })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_payload' },
    });
  });

  it('still lists a page when a stored name breaks the input rules (e.g. from a restore)', async () => {
    const project = await createProject('Fine');
    // The database accepts this name; the IPC input rules would not.
    const odd = `Odd${String.fromCharCode(0x200b)}name`;
    opened.db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(odd, project.id);
    await expect(list({ worldId: world.id })).resolves.toMatchObject({
      ok: true,
      data: { projects: [{ id: project.id, name: odd }] },
    });
  });

  it('answers not_found for an unknown world instead of an empty list', async () => {
    await expect(list({ worldId: UNKNOWN_ID })).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it.each([
    ['page too big', { limit: 101 }],
    ['page of zero', { limit: 0 }],
    ['unknown status', { status: 'deleted' }],
  ])('rejects a forged payload (%s)', async (_label, override) => {
    await expect(list({ worldId: world.id, ...override })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_payload' },
    });
  });
});

describe('project.rename and project.updateGoal', () => {
  it('renames without changing the ID', async () => {
    const project = await createProject();
    const result = await rename({ ...change(project), name: 'Spring launch' });
    expect(result).toMatchObject({
      ok: true,
      data: { project: { id: project.id, name: 'Spring launch', revision: 2 } },
    });
  });

  it('updates the goal', async () => {
    const project = await createProject();
    await expect(updateGoal({ ...change(project), goal: '  New goal  ' })).resolves.toMatchObject({
      ok: true,
      data: { project: { goal: 'New goal', revision: 2 } },
    });
  });

  it('refuses a stale revision with the current one, and changes nothing', async () => {
    const project = await createProject();
    await rename({ ...change(project), name: 'First edit' });
    for (const result of [
      await rename({ ...change(project), name: 'Lost update' }),
      await updateGoal({ ...change(project), goal: 'Lost update' }),
    ]) {
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'revision_conflict', currentRevision: 2 },
      });
    }
    await expect(get({ worldId: world.id, projectId: project.id })).resolves.toMatchObject({
      data: { project: { name: 'First edit', goal: project.goal, revision: 2 } },
    });
  });

  it('refuses to edit a project through another world', async () => {
    const project = await createProject();
    const other = new WorldRepository(opened.db).create({ name: 'Other', themeId: 'meadow' });
    await expect(
      rename({ ...change(project), worldId: other.id, name: 'Hijacked' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
    await expect(get({ worldId: world.id, projectId: project.id })).resolves.toMatchObject({
      data: { project: { name: 'Launch plan', revision: 1 } },
    });
  });

  it('refuses to edit a trashed project', async () => {
    const project = await createProject();
    const trashed = await trash(change(project));
    if (!trashed.ok) throw new Error(trashed.error.code);
    await expect(
      rename({ ...change(trashed.data.project), name: 'Edited in trash' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_transition' } });
  });

  it('rejects a forged payload (missing expected revision)', async () => {
    const project = await createProject();
    await expect(
      rename({ worldId: world.id, projectId: project.id, name: 'No revision' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
  });
});

describe('archive, restore, trash and restoreFromTrash', () => {
  it('walks the whole lifecycle without deleting a row', async () => {
    const project = await createProject();
    const projects = count('projects');
    const entities = count('graph_entities');

    const archived = await archive(change(project));
    expect(archived).toMatchObject({
      ok: true,
      data: { project: { status: 'archived' }, runCheck: 'stub' },
    });
    if (!archived.ok) throw new Error();

    const trashed = await trash(change(archived.data.project));
    expect(trashed).toMatchObject({
      ok: true,
      data: { project: { status: 'trashed' }, runCheck: 'stub' },
    });
    if (!trashed.ok) throw new Error();

    // Out of the trash it goes back to where it was: archived.
    const untrashed = await restoreFromTrash(change(trashed.data.project));
    expect(untrashed).toMatchObject({ ok: true, data: { project: { status: 'archived' } } });
    if (!untrashed.ok) throw new Error();

    const restored = await restore(change(untrashed.data.project));
    expect(restored).toMatchObject({
      ok: true,
      data: { project: { id: project.id, status: 'active', revision: 5 } },
    });

    expect(count('projects')).toBe(projects);
    expect(count('graph_entities')).toBe(entities);
  });

  it('refuses transitions the current state does not allow', async () => {
    const project = await createProject();
    await expect(restore(change(project))).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_transition' },
    });
    await expect(restoreFromTrash(change(project))).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_transition' },
    });
  });

  it('refuses a stale revision', async () => {
    const project = await createProject();
    await rename({ ...change(project), name: 'Edited' });
    await expect(trash(change(project))).resolves.toMatchObject({
      ok: false,
      error: { code: 'revision_conflict', currentRevision: 2 },
    });
  });

  it('refuses archive and trash while the runs probe reports active runs', async () => {
    const busy: ActiveRunsProbe = { kind: 'stub', activeRunCount: () => 1 };
    service = new ProjectService(active, catalog, busy);
    const project = await createProject();

    for (const result of [await archive(change(project)), await trash(change(project))]) {
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_transition' } });
    }
    await expect(get({ worldId: world.id, projectId: project.id })).resolves.toMatchObject({
      data: { project: { status: 'active', revision: 1 } },
    });
  });

  it('uses the stub probe by default, which reports no runs', () => {
    expect(noActiveRunsStub.kind).toBe('stub');
    expect(noActiveRunsStub.activeRunCount(UNKNOWN_ID)).toBe(0);
  });
});

describe('identity across rename and restart', () => {
  it('finds the project by ID after a rename and a restart', async () => {
    const project = await createProject();
    await rename({ ...change(project), name: 'Renamed before restart' });

    // "Restart": close the database and open the startup profile again from disk.
    opened.db.close();
    opened = await openStartupProfile(userData);
    active = new ActiveProfile(userData, { profileId: opened.profileId, db: opened.db });
    service = new ProjectService(active, catalog);

    await expect(get({ worldId: world.id, projectId: project.id })).resolves.toMatchObject({
      ok: true,
      data: { project: { id: project.id, name: 'Renamed before restart', revision: 2 } },
    });
  });
});
