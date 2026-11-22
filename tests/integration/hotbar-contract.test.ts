// Contract tests for `hotbar.*` (M2-4 #69) through the real router, against a real profile
// database in a temp directory. Covers no silent replacement (`slot_occupied` with the real
// occupant, a wrong expected target), clearing that never touches the target, pins of archived
// and trashed projects, forged targets, archived worlds, and §22.2 #2 at command level.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';

import type { HotbarSlotSummary } from '../../src/common/contracts/hotbar';
import { SERVICE_KINDS } from '../../src/common/world/service-kinds';
import { APP_ENTRY_URL } from '../../src/main/bootstrap/app-origin';
import {
  createHotbarAssignHandler,
  createHotbarClearHandler,
  createHotbarListHandler,
  hotbarAssignCommand,
  hotbarClearCommand,
  hotbarListCommand,
} from '../../src/main/ipc/commands/hotbar';
import {
  createProjectCreateHandler,
  createProjectListHandler,
  projectCreateCommand,
  projectListCommand,
} from '../../src/main/ipc/commands/project';
import {
  type CommandDefinition,
  type CommandHandler,
  createCommandHandler,
  trustRendererEntry,
} from '../../src/main/ipc/router';
import { ActiveProfile } from '../../src/main/profiles/active-profile';
import {
  ARCHIVED_WORLD_HOTBAR_REFUSAL,
  HotbarService,
  PINNED_ELSEWHERE_MESSAGE,
  SLOT_EMPTY_MESSAGE,
  SLOT_OCCUPIED_MESSAGE,
  TRASHED_PROJECT_PIN_REFUSAL,
} from '../../src/main/services/hotbar-service';
import { ProjectService } from '../../src/main/services/project-service';
import { openStartupProfile, type StartupProfile } from '../../src/main/storage/profiles/startup';
import type { Project } from '../../src/main/storage/repositories/project-repository';
import { type World, WorldRepository } from '../../src/main/storage/repositories/world-repository';
import { bundledTemplateFiles } from '../../src/main/templates/bundled-templates';
import { buildTemplateCatalog } from '../../src/main/templates/catalog';

const isTrusted = trustRendererEntry(APP_ENTRY_URL);
const trusted = { senderFrame: { url: APP_ENTRY_URL, parent: null } };
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const catalog = buildTemplateCatalog(bundledTemplateFiles(), () => undefined);

let userData: string;
let opened: StartupProfile;
let projects: ProjectService;
let service: HotbarService;
let world: World;

function call<I extends z.ZodType, O extends z.ZodType>(
  definition: CommandDefinition<I, O>,
  handler: CommandHandler<I, O>,
  payload: unknown,
) {
  return createCommandHandler(definition, handler, isTrusted)(trusted, payload);
}

const list = (payload: unknown) =>
  call(hotbarListCommand, createHotbarListHandler(service), payload);
const assign = (payload: unknown) =>
  call(hotbarAssignCommand, createHotbarAssignHandler(service), payload);
const clear = (payload: unknown) =>
  call(hotbarClearCommand, createHotbarClearHandler(service), payload);

function newProject(name = 'Launch plan', worldId = world.id): Project {
  return projects.create({
    worldId,
    templateId: 'builtin.generic',
    templateVersion: '1.0.0',
    name,
    goal: '',
  });
}

const projectTarget = (project: Project) => ({ type: 'project', id: project.id }) as const;

async function pinned(project: Project, slot = 0): Promise<HotbarSlotSummary> {
  const result = await assign({ worldId: project.worldId, slot, target: projectTarget(project) });
  if (!result.ok) throw new Error(result.error.code);
  return result.data.slot;
}

const lifecycle = (project: Project) => ({
  worldId: project.worldId,
  projectId: project.id,
  expectedRevision: project.revision,
});

/** Everything a refused command must leave alone. */
function snapshot(): unknown {
  return {
    slots: opened.db.prepare('SELECT * FROM hotbar_slots ORDER BY world_id, slot').all(),
    projects: opened.db.prepare('SELECT * FROM projects ORDER BY id').all(),
  };
}

function archiveWorld(): void {
  const current = new WorldRepository(opened.db).get(world.id);
  if (current === undefined) throw new Error('setup failed');
  new WorldRepository(opened.db).archive(world.id, current.revision);
}

beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'atlas-hotbar-cmd-'));
  opened = await openStartupProfile(userData);
  const active = new ActiveProfile(userData, { profileId: opened.profileId, db: opened.db });
  projects = new ProjectService(active, catalog);
  service = new HotbarService(active, projects);
  world = new WorldRepository(opened.db).create({ name: 'Home', themeId: 'meadow' });
});

afterEach(() => {
  if (opened.db.isOpen) opened.db.close();
  rmSync(userData, { recursive: true, force: true });
});

describe('hotbar.assign', () => {
  it('pins a project to an empty slot', async () => {
    const project = newProject();
    const result = await assign({ worldId: world.id, slot: 3, target: projectTarget(project) });
    expect(result).toMatchObject({
      ok: true,
      data: {
        slot: {
          worldId: world.id,
          slot: 3,
          target: { type: 'project', id: project.id },
          projectStatus: 'active',
          revision: 1,
        },
      },
    });
  });

  it('pins every service from the fixed list', async () => {
    for (const [slot, kind] of SERVICE_KINDS.entries()) {
      const result = await assign({
        worldId: world.id,
        slot,
        target: { type: 'service', id: kind },
      });
      expect(result, kind).toMatchObject({
        ok: true,
        data: { slot: { target: { type: 'service', id: kind }, projectStatus: null } },
      });
    }
  });

  it('refuses a filled slot without replace: slot_occupied with the occupant, nothing changes', async () => {
    const first = newProject('First');
    const second = newProject('Second');
    await pinned(first, 0);
    const before = snapshot();

    const result = await assign({
      worldId: world.id,
      slot: 0,
      target: projectTarget(second),
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'slot_occupied',
        message: SLOT_OCCUPIED_MESSAGE,
        hotbar: {
          slot: 0,
          occupant: { target: { type: 'project', id: first.id }, projectStatus: 'active' },
        },
      },
    });
    expect(snapshot()).toEqual(before);
  });

  it('refuses a replace that names the wrong expected target, reporting the real occupant', async () => {
    const first = newProject('First');
    const other = newProject('Other');
    const second = newProject('Second');
    await pinned(first, 0);
    const before = snapshot();

    for (const expectedTargetId of [other.id, UNKNOWN_ID, 'settings']) {
      const result = await assign({
        worldId: world.id,
        slot: 0,
        target: projectTarget(second),
        replace: { expectedTargetId },
      });
      expect(result, expectedTargetId).toMatchObject({
        ok: false,
        error: {
          code: 'slot_occupied',
          hotbar: { slot: 0, occupant: { target: { type: 'project', id: first.id } } },
        },
      });
    }
    expect(snapshot()).toEqual(before);
  });

  it('replaces when the expected target matches; the old project is untouched', async () => {
    const first = newProject('First');
    const second = newProject('Second');
    await pinned(first, 0);
    const projectsBefore = (snapshot() as { projects: unknown }).projects;

    const result = await assign({
      worldId: world.id,
      slot: 0,
      target: projectTarget(second),
      replace: { expectedTargetId: first.id },
    });
    expect(result).toMatchObject({
      ok: true,
      data: { slot: { slot: 0, target: { type: 'project', id: second.id }, revision: 2 } },
    });
    expect((snapshot() as { projects: unknown }).projects).toEqual(projectsBefore);
  });

  it('replaces a service with a project and back', async () => {
    const project = newProject();
    await assign({ worldId: world.id, slot: 5, target: { type: 'service', id: 'activity' } });
    await expect(
      assign({
        worldId: world.id,
        slot: 5,
        target: projectTarget(project),
        replace: { expectedTargetId: 'activity' },
      }),
    ).resolves.toMatchObject({ ok: true, data: { slot: { target: projectTarget(project) } } });
    await expect(
      assign({
        worldId: world.id,
        slot: 5,
        target: { type: 'service', id: 'activity' },
        replace: { expectedTargetId: project.id },
      }),
    ).resolves.toMatchObject({ ok: true, data: { slot: { projectStatus: null } } });
  });

  it('fills an empty slot even when replace was given (user decision 2026-11-22)', async () => {
    const project = newProject();
    const result = await assign({
      worldId: world.id,
      slot: 7,
      target: projectTarget(project),
      replace: { expectedTargetId: UNKNOWN_ID },
    });
    expect(result).toMatchObject({ ok: true, data: { slot: { slot: 7, revision: 1 } } });
  });

  it('returns the slot unchanged when it already holds that target', async () => {
    const project = newProject();
    const first = await pinned(project, 2);
    const before = snapshot();
    await expect(
      assign({ worldId: world.id, slot: 2, target: projectTarget(project) }),
    ).resolves.toEqual({ ok: true, data: { slot: first } });
    expect(snapshot()).toEqual(before);
  });

  it('refuses a target already pinned to another slot, also when replacing', async () => {
    const project = newProject('Pinned');
    const other = newProject('Other');
    await pinned(project, 0);
    await pinned(other, 1);
    const before = snapshot();

    const expected = {
      ok: false,
      error: { code: 'already_exists', message: PINNED_ELSEWHERE_MESSAGE },
    };
    await expect(
      assign({ worldId: world.id, slot: 4, target: projectTarget(project) }),
    ).resolves.toEqual(expected);
    await expect(
      assign({
        worldId: world.id,
        slot: 1,
        target: projectTarget(project),
        replace: { expectedTargetId: other.id },
      }),
    ).resolves.toEqual(expected);
    expect(snapshot()).toEqual(before);
  });

  it('pins an archived project and reports its status; refuses a trashed one', async () => {
    const archived = projects.archive(lifecycle(newProject('Archived'))).project;
    await expect(pinned(archived, 0)).resolves.toMatchObject({ projectStatus: 'archived' });

    const trashed = projects.trash(lifecycle(newProject('Trashed'))).project;
    const before = snapshot();
    await expect(
      assign({ worldId: world.id, slot: 1, target: projectTarget(trashed) }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_transition', message: TRASHED_PROJECT_PIN_REFUSAL },
    });
    expect(snapshot()).toEqual(before);
  });

  it("refuses an unknown project and another world's project with the same not_found", async () => {
    const otherWorld = new WorldRepository(opened.db).create({ name: 'Away', themeId: 'meadow' });
    const foreign = newProject('Foreign', otherWorld.id);
    const before = snapshot();

    const unknown = await assign({
      worldId: world.id,
      slot: 0,
      target: { type: 'project', id: UNKNOWN_ID },
    });
    expect(unknown).toMatchObject({ ok: false, error: { code: 'not_found' } });
    await expect(
      assign({ worldId: world.id, slot: 0, target: projectTarget(foreign) }),
    ).resolves.toEqual(unknown);
    await expect(
      assign({ worldId: UNKNOWN_ID, slot: 0, target: projectTarget(foreign) }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(snapshot()).toEqual(before);
  });

  it('refuses forged payloads before any handler code runs', async () => {
    const project = newProject();
    const forged: unknown[] = [
      { worldId: world.id, slot: 0, target: { type: 'service', id: 'bank-vault' } },
      { worldId: world.id, slot: 0, target: { type: 'workflow', id: project.id } },
      { worldId: world.id, slot: 0, target: { type: 'service', id: project.id } },
      { worldId: world.id, slot: 0, target: { type: 'project', id: 'settings' } },
      { worldId: world.id, slot: 0, target: { ...projectTarget(project), extra: 1 } },
      { worldId: world.id, slot: 10, target: projectTarget(project) },
      { worldId: world.id, slot: -1, target: projectTarget(project) },
      { worldId: world.id, slot: 1.5, target: projectTarget(project) },
      { worldId: world.id, slot: '0', target: projectTarget(project) },
      { worldId: world.id, slot: 0, target: projectTarget(project), replace: {} },
      {
        worldId: world.id,
        slot: 0,
        target: projectTarget(project),
        replace: { expectedTargetId: 'x' },
      },
      { worldId: world.id, slot: 0, target: projectTarget(project), force: true },
    ];
    for (const payload of forged) {
      await expect(assign(payload), JSON.stringify(payload)).resolves.toMatchObject({
        ok: false,
        error: { code: 'invalid_payload' },
      });
    }
    expect(snapshot()).toMatchObject({ slots: [] });
  });
});

describe('hotbar.clear', () => {
  it('empties the slot and returns what it held; the project is untouched', async () => {
    const project = newProject();
    const slot = await pinned(project, 4);
    const projectsBefore = (snapshot() as { projects: unknown }).projects;

    await expect(
      clear({ worldId: world.id, slot: 4, expectedTargetId: project.id }),
    ).resolves.toEqual({ ok: true, data: { slot } });
    expect(snapshot()).toEqual({ slots: [], projects: projectsBefore });
  });

  it('refuses the wrong expected target with slot_occupied and changes nothing', async () => {
    const project = newProject();
    await pinned(project, 4);
    const before = snapshot();
    await expect(
      clear({ worldId: world.id, slot: 4, expectedTargetId: UNKNOWN_ID }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'slot_occupied',
        hotbar: { slot: 4, occupant: { target: projectTarget(project) } },
      },
    });
    expect(snapshot()).toEqual(before);
  });

  it('refuses a slot that was cleared and refilled, even though its revision is 1 again', async () => {
    const first = newProject('First');
    const second = newProject('Second');
    await pinned(first, 0);
    await clear({ worldId: world.id, slot: 0, expectedTargetId: first.id });
    const refilled = await pinned(second, 0);
    expect(refilled.revision).toBe(1);

    await expect(
      clear({ worldId: world.id, slot: 0, expectedTargetId: first.id }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'slot_occupied' } });
  });

  it('reports an empty slot as not_found', async () => {
    await expect(
      clear({ worldId: world.id, slot: 9, expectedTargetId: 'settings' }),
    ).resolves.toEqual({ ok: false, error: { code: 'not_found', message: SLOT_EMPTY_MESSAGE } });
  });

  it("clears a trashed project's pin without changing the project", async () => {
    const project = newProject();
    await pinned(project, 0);
    const trashed = projects.trash(lifecycle(project)).project;
    const projectsBefore = (snapshot() as { projects: unknown }).projects;
    await expect(
      clear({ worldId: world.id, slot: 0, expectedTargetId: trashed.id }),
    ).resolves.toMatchObject({ ok: true, data: { slot: { projectStatus: 'trashed' } } });
    expect(snapshot()).toEqual({ slots: [], projects: projectsBefore });
  });
});

describe('hotbar.list', () => {
  it('lists filled slots by number; archived and trashed pins stay with their status', async () => {
    const active = newProject('Active');
    const archived = newProject('Archived');
    const trashed = newProject('Trashed');
    await pinned(trashed, 8);
    await pinned(active, 1);
    await pinned(archived, 0);
    await assign({ worldId: world.id, slot: 9, target: { type: 'service', id: 'settings' } });
    projects.archive(lifecycle(archived));
    projects.trash(lifecycle(trashed));

    const result = await list({ worldId: world.id });
    if (!result.ok) throw new Error(result.error.code);
    expect(result.data.slots.map((s) => [s.slot, s.target.id, s.projectStatus])).toEqual([
      [0, archived.id, 'archived'],
      [1, active.id, 'active'],
      [8, trashed.id, 'trashed'],
      [9, 'settings', null],
    ]);
  });

  it("never reports another world's project status, even if the FK were lost (#69 security L1)", async () => {
    const otherWorld = new WorldRepository(opened.db).create({ name: 'Away', themeId: 'meadow' });
    const foreign = projects.archive(lifecycle(newProject('Foreign', otherWorld.id))).project;
    // Simulates a damaged database: foreign keys off, a pin planted across worlds.
    opened.db.exec('PRAGMA foreign_keys = OFF');
    opened.db
      .prepare(
        `INSERT INTO hotbar_slots (world_id, slot, target_type, project_id, created_at, updated_at)
         VALUES (?, 0, 'project', ?, '2026-11-22T00:00:00.000Z', '2026-11-22T00:00:00.000Z')`,
      )
      .run(world.id, foreign.id);
    opened.db.exec('PRAGMA foreign_keys = ON');

    const result = await list({ worldId: world.id });
    if (!result.ok) throw new Error(result.error.code);
    expect(result.data.slots).toMatchObject([{ slot: 0, projectStatus: null }]);
  });

  it('refuses an unknown world as not_found', async () => {
    await expect(list({ worldId: UNKNOWN_ID })).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });
});

describe('hotbar inside an archived world (F5, #59)', () => {
  it('refuses assign with the archived-world reason', async () => {
    const project = newProject();
    archiveWorld();
    const before = snapshot();
    await expect(
      assign({ worldId: world.id, slot: 0, target: projectTarget(project) }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_transition', message: ARCHIVED_WORLD_HOTBAR_REFUSAL },
    });
    expect(snapshot()).toEqual(before);
  });

  it('refuses replace with the archived-world reason', async () => {
    const first = newProject('First');
    const second = newProject('Second');
    await pinned(first, 0);
    archiveWorld();
    const before = snapshot();
    await expect(
      assign({
        worldId: world.id,
        slot: 0,
        target: projectTarget(second),
        replace: { expectedTargetId: first.id },
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_transition', message: ARCHIVED_WORLD_HOTBAR_REFUSAL },
    });
    expect(snapshot()).toEqual(before);
  });

  it('refuses clear with the archived-world reason; list still works', async () => {
    const project = newProject();
    await pinned(project, 0);
    archiveWorld();
    const before = snapshot();
    await expect(
      clear({ worldId: world.id, slot: 0, expectedTargetId: project.id }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_transition', message: ARCHIVED_WORLD_HOTBAR_REFUSAL },
    });
    expect(snapshot()).toEqual(before);
    await expect(list({ worldId: world.id })).resolves.toMatchObject({
      ok: true,
      data: { slots: [{ slot: 0, target: projectTarget(project) }] },
    });
  });
});

describe('§22.2 #2 at command level', () => {
  it('ten slots filled, an 11th project created: every slot and project still present', async () => {
    const createProject = (payload: unknown) =>
      call(projectCreateCommand, createProjectCreateHandler(projects), payload);
    const listProjects = (payload: unknown) =>
      call(projectListCommand, createProjectListHandler(projects), payload);

    const ten: string[] = [];
    for (let slot = 0; slot < 10; slot++) {
      const project = newProject(`Project ${String(slot + 1)}`);
      ten.push(project.id);
      await pinned(project, slot);
    }
    const before = await list({ worldId: world.id });

    const eleventh = await createProject({
      worldId: world.id,
      templateId: 'builtin.generic',
      templateVersion: '1.0.0',
      name: 'Project 11',
      goal: '',
    });
    expect(eleventh).toMatchObject({ ok: true });

    // Nothing pinned it anywhere: the hotbar is exactly as it was.
    const after = await list({ worldId: world.id });
    expect(after).toEqual(before);
    if (!after.ok) throw new Error(after.error.code);
    expect(after.data.slots.map((s) => s.target.id)).toEqual(ten);

    const all = await listProjects({ worldId: world.id, status: 'active', limit: 50 });
    if (!all.ok) throw new Error(all.error.code);
    expect(all.data.projects).toHaveLength(11);

    // Pinning the 11th into a full bar is an explicit choice, never a silent overwrite.
    if (!eleventh.ok) throw new Error('unreachable');
    const eleventhId = eleventh.data.project.id;
    for (let slot = 0; slot < 10; slot++) {
      await expect(
        assign({ worldId: world.id, slot, target: { type: 'project', id: eleventhId } }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'slot_occupied' } });
    }
    await expect(list({ worldId: world.id })).resolves.toEqual(before);
  });
});
