// Contract tests for `placement.*` (M2-3 #68) through the real router, against a real profile
// database in a temp directory and the real bundled manifest. Covers the rules running again in
// the handler (§22.2 #5), forged input (unknown, other-world and trashed projects, a second
// building, smuggled footprints), moves that keep the project's identity (§22.2 #4), removal
// that leaves the project readable (§22.2 #3), stale revisions and archived worlds.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import type { PlacementSummary } from '../../src/common/contracts/placement';
import { APP_ENTRY_URL } from '../../src/main/bootstrap/app-origin';
import {
  createPlacementCreateHandler,
  createPlacementListHandler,
  createPlacementMoveHandler,
  createPlacementRemoveHandler,
  placementCreateCommand,
  placementListCommand,
  placementMoveCommand,
  placementRemoveCommand,
} from '../../src/main/ipc/commands/placement';
import { createProjectGetHandler, projectGetCommand } from '../../src/main/ipc/commands/project';
import {
  type CommandDefinition,
  type CommandHandler,
  createCommandHandler,
  trustRendererEntry,
} from '../../src/main/ipc/router';
import { ActiveProfile } from '../../src/main/profiles/active-profile';
import {
  ARCHIVED_WORLD_PLACEMENT_REFUSAL,
  PlacementService,
  SERVICE_BUILDING_REFUSAL,
} from '../../src/main/services/placement-service';
import { ProjectService } from '../../src/main/services/project-service';
import { openStartupProfile, type StartupProfile } from '../../src/main/storage/profiles/startup';
import { PlacementRepository } from '../../src/main/storage/repositories/placement-repository';
import type { Project } from '../../src/main/storage/repositories/project-repository';
import { type World, WorldRepository } from '../../src/main/storage/repositories/world-repository';
import { bundledTemplateFiles } from '../../src/main/templates/bundled-templates';
import { buildTemplateCatalog } from '../../src/main/templates/catalog';
import { BuildingAppearances } from '../../src/main/world/building-appearances';

const isTrusted = trustRendererEntry(APP_ENTRY_URL);
const trusted = { senderFrame: { url: APP_ENTRY_URL, parent: null } };
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const catalog = buildTemplateCatalog(bundledTemplateFiles(), () => undefined);

let userData: string;
let opened: StartupProfile;
let projects: ProjectService;
let service: PlacementService;
let world: World;

function call<I extends z.ZodType, O extends z.ZodType>(
  definition: CommandDefinition<I, O>,
  handler: CommandHandler<I, O>,
  payload: unknown,
) {
  return createCommandHandler(definition, handler, isTrusted)(trusted, payload);
}

const list = (payload: unknown) =>
  call(placementListCommand, createPlacementListHandler(service), payload);
const place = (payload: unknown) =>
  call(placementCreateCommand, createPlacementCreateHandler(service), payload);
const move = (payload: unknown) =>
  call(placementMoveCommand, createPlacementMoveHandler(service), payload);
const remove = (payload: unknown) =>
  call(placementRemoveCommand, createPlacementRemoveHandler(service), payload);
const getProject = (payload: unknown) =>
  call(projectGetCommand, createProjectGetHandler(projects), payload);

function newProject(name = 'Launch plan', worldId = world.id): Project {
  return projects.create({
    worldId,
    templateId: 'builtin.generic',
    templateVersion: '1.0.0',
    name,
    goal: '',
  });
}

const spot = (tileX: number, tileY: number, rotation = 0) => ({ tileX, tileY, rotation });

async function placed(project: Project, tileX = 0, tileY = 0): Promise<PlacementSummary> {
  const result = await place({
    worldId: project.worldId,
    projectId: project.id,
    ...spot(tileX, tileY),
  });
  if (!result.ok) throw new Error(result.error.code);
  return result.data.placement;
}

const change = (placement: PlacementSummary) => ({
  worldId: placement.worldId,
  placementId: placement.id,
  expectedRevision: placement.revision,
});

/** Everything a refused command must leave alone. */
function snapshot(): unknown {
  return {
    placements: opened.db.prepare('SELECT * FROM building_placements ORDER BY id').all(),
    projects: opened.db.prepare('SELECT * FROM projects ORDER BY id').all(),
  };
}

beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'atlas-placement-cmd-'));
  opened = await openStartupProfile(userData);
  const active = new ActiveProfile(userData, { profileId: opened.profileId, db: opened.db });
  projects = new ProjectService(active, catalog);
  service = new PlacementService(active, projects, BuildingAppearances.bundled());
  world = new WorldRepository(opened.db).create({ name: 'Home', themeId: 'meadow' });
});

afterEach(() => {
  if (opened.db.isOpen) opened.db.close();
  rmSync(userData, { recursive: true, force: true });
});

describe('placement.create', () => {
  it("places a project's building with the default 2×2 appearance", async () => {
    const project = newProject();
    const result = await place({ worldId: world.id, projectId: project.id, ...spot(3, 4, 90) });
    expect(result).toMatchObject({
      ok: true,
      data: {
        placement: {
          worldId: world.id,
          target: { type: 'project', id: project.id },
          projectStatus: 'active',
          projectName: 'Launch plan',
          appearanceId: 'placeholder.building.2x2',
          footprint: { columns: 2, rows: 2 },
          tileX: 3,
          tileY: 4,
          rotation: 90,
          revision: 1,
        },
      },
    });
  });

  it('places an archived project, reporting its status (user decision 2026-11-21)', async () => {
    const project = newProject();
    projects.archive({ worldId: world.id, projectId: project.id, expectedRevision: 1 });
    await expect(placed(project)).resolves.toMatchObject({ projectStatus: 'archived' });
  });

  it('refuses a trashed project as invalid_transition and changes nothing', async () => {
    const project = newProject();
    projects.trash({ worldId: world.id, projectId: project.id, expectedRevision: 1 });
    const before = snapshot();
    await expect(
      place({ worldId: world.id, projectId: project.id, ...spot(0, 0) }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_transition' } });
    expect(snapshot()).toEqual(before);
  });

  it("refuses an unknown project and another world's project with the same not_found", async () => {
    const elsewhere = new WorldRepository(opened.db).create({
      name: 'Elsewhere',
      themeId: 'meadow',
    });
    const foreign = newProject('Foreign', elsewhere.id);
    const before = snapshot();
    const unknown = await place({ worldId: world.id, projectId: UNKNOWN_ID, ...spot(0, 0) });
    const otherWorld = await place({ worldId: world.id, projectId: foreign.id, ...spot(0, 0) });
    expect(unknown).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(otherWorld).toEqual(unknown);
    expect(snapshot()).toEqual(before);
  });

  it('refuses an unknown world as not_found', async () => {
    const project = newProject();
    await expect(
      place({ worldId: UNKNOWN_ID, projectId: project.id, ...spot(0, 0) }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('refuses a second building for the same project as already_exists', async () => {
    const project = newProject();
    await placed(project);
    const before = snapshot();
    await expect(
      place({ worldId: world.id, projectId: project.id, ...spot(10, 10) }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'already_exists' } });
    expect(snapshot()).toEqual(before);
  });

  it('re-runs the rules: an overlap is placement_blocked with the blocking building', async () => {
    const first = await placed(newProject('First'), 5, 5);
    const second = newProject('Second');
    const before = snapshot();
    await expect(
      place({ worldId: world.id, projectId: second.id, ...spot(6, 6) }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'placement_blocked',
        message: 'Another building is in the way.',
        placement: { reason: 'overlaps', blockingIds: [first.id] },
      },
    });
    expect(snapshot()).toEqual(before);
    // Touching edges is fine.
    await expect(placed(second, 7, 5)).resolves.toMatchObject({ tileX: 7, tileY: 5 });
  });

  it('refuses a building that hangs off the edge of this world as out_of_bounds', async () => {
    const project = newProject();
    const before = snapshot();
    const edge = world.gridWidth - 1;
    await expect(
      place({ worldId: world.id, projectId: project.id, ...spot(edge, 0) }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'placement_blocked',
        message: 'The building does not fit inside the world there.',
        placement: { reason: 'out_of_bounds', blockingIds: [] },
      },
    });
    expect(snapshot()).toEqual(before);
  });

  it.each([
    ['a rotation that is not a quarter turn', { rotation: 45 }],
    ['a tile past the largest grid', { tileX: 256 }],
    ['a negative tile', { tileY: -1 }],
    ['a fractional tile', { tileX: 1.5 }],
    ['a smuggled footprint', { footprint: { columns: 1, rows: 1 } }],
    ['a smuggled appearance', { appearanceId: 'placeholder.marker.selection' }],
    ['a service target', { target: { type: 'service', id: 'agents-guild' } }],
  ])('refuses %s as invalid_payload', async (_label, override) => {
    const project = newProject();
    const before = snapshot();
    await expect(
      place({ worldId: world.id, projectId: project.id, ...spot(0, 0), ...override }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
    expect(snapshot()).toEqual(before);
  });

  it('treats a stored building whose art no longer resolves as 4×4 (fail closed)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const lost = newProject('Lost art');
    new PlacementRepository(opened.db).create({
      worldId: world.id,
      target: { type: 'project', id: lost.id },
      appearanceId: 'renamed.art',
      tileX: 0,
      tileY: 0,
      rotation: 0,
    });
    const next = newProject('Next');
    // (3, 3) is inside a 4×4 at the origin, though outside the 2×2 the default art would cover.
    await expect(
      place({ worldId: world.id, projectId: next.id, ...spot(3, 3) }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'placement_blocked' } });
    await expect(placed(next, 4, 0)).resolves.toMatchObject({ tileX: 4 });
    const calls = warn.mock.calls.length;
    warn.mockRestore();
    expect(calls).toBe(1);
  });
});

describe('placement.list', () => {
  it("lists this world's buildings oldest first, with each project's status", async () => {
    const a = await placed(newProject('A'), 0, 0);
    const b = await placed(newProject('B'), 4, 0);
    const elsewhere = new WorldRepository(opened.db).create({
      name: 'Elsewhere',
      themeId: 'meadow',
    });
    await placed(newProject('Foreign', elsewhere.id), 0, 0);

    const result = await list({ worldId: world.id });
    expect(result.ok && result.data.placements.map((p) => p.id)).toEqual([a.id, b.id]);
    expect(result.ok && result.data.placements.every((p) => p.projectStatus === 'active')).toBe(
      true,
    );
  });

  it('refuses an unknown world as not_found, not an empty list', async () => {
    await expect(list({ worldId: UNKNOWN_ID })).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });
});

describe('placement.move', () => {
  it("moves and turns a building; the project's ID, name and revision stay (§22.2 #4)", async () => {
    const project = newProject();
    const building = await placed(project, 2, 2);
    const result = await move({ ...change(building), ...spot(20, 30, 270) });
    expect(result).toMatchObject({
      ok: true,
      data: { placement: { id: building.id, tileX: 20, tileY: 30, rotation: 270, revision: 2 } },
    });
    await expect(getProject({ worldId: world.id, projectId: project.id })).resolves.toMatchObject({
      ok: true,
      data: { project: { id: project.id, name: project.name, revision: project.revision } },
    });
  });

  it('may move onto part of its own old tiles', async () => {
    const building = await placed(newProject(), 2, 2);
    await expect(move({ ...change(building), ...spot(3, 2) })).resolves.toMatchObject({ ok: true });
  });

  it('re-runs the rules: moving onto another building is refused and changes nothing', async () => {
    const other = await placed(newProject('Other'), 10, 10);
    const building = await placed(newProject('Mover'), 0, 0);
    const before = snapshot();
    await expect(move({ ...change(building), ...spot(11, 11) })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'placement_blocked',
        placement: { reason: 'overlaps', blockingIds: [other.id] },
      },
    });
    expect(snapshot()).toEqual(before);
  });

  it('refuses a stale revision as revision_conflict with the current revision', async () => {
    const building = await placed(newProject(), 0, 0);
    await move({ ...change(building), ...spot(5, 5) });
    const before = snapshot();
    await expect(move({ ...change(building), ...spot(8, 8) })).resolves.toMatchObject({
      ok: false,
      error: { code: 'revision_conflict', currentRevision: 2 },
    });
    expect(snapshot()).toEqual(before);
  });

  it("refuses another world's building as not_found", async () => {
    const elsewhere = new WorldRepository(opened.db).create({
      name: 'Elsewhere',
      themeId: 'meadow',
    });
    const foreign = await placed(newProject('Foreign', elsewhere.id), 0, 0);
    const before = snapshot();
    await expect(
      move({ ...change(foreign), worldId: world.id, ...spot(5, 5) }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(snapshot()).toEqual(before);
  });
});

describe('placement.remove', () => {
  it('makes the project unplaced; the project stays readable and unchanged (§22.2 #3)', async () => {
    const project = newProject();
    const building = await placed(project, 1, 1);
    await expect(remove(change(building))).resolves.toMatchObject({
      ok: true,
      data: { placement: { id: building.id } },
    });
    await expect(list({ worldId: world.id })).resolves.toEqual({
      ok: true,
      data: { placements: [] },
    });
    await expect(getProject({ worldId: world.id, projectId: project.id })).resolves.toMatchObject({
      ok: true,
      data: { project: { id: project.id, name: project.name, revision: project.revision } },
    });
    // Unplaced, so it can be placed again.
    await expect(placed(project, 9, 9)).resolves.toMatchObject({ tileX: 9 });
  });

  it('refuses a stale revision as revision_conflict', async () => {
    const building = await placed(newProject(), 0, 0);
    await move({ ...change(building), ...spot(5, 5) });
    const before = snapshot();
    await expect(remove(change(building))).resolves.toMatchObject({
      ok: false,
      error: { code: 'revision_conflict', currentRevision: 2 },
    });
    expect(snapshot()).toEqual(before);
  });

  it("refuses another world's building as not_found", async () => {
    const elsewhere = new WorldRepository(opened.db).create({
      name: 'Elsewhere',
      themeId: 'meadow',
    });
    const foreign = await placed(newProject('Foreign', elsewhere.id), 0, 0);
    const before = snapshot();
    await expect(remove({ ...change(foreign), worldId: world.id })).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(snapshot()).toEqual(before);
  });
});

describe('placements inside an archived world (F5, #59)', () => {
  it('refuses create, move and remove with the same reason; list still works', async () => {
    const building = await placed(newProject('Placed'), 0, 0);
    const unplaced = newProject('Unplaced');
    const current = new WorldRepository(opened.db).get(world.id);
    if (current === undefined) throw new Error('setup failed');
    new WorldRepository(opened.db).archive(world.id, current.revision);
    const before = snapshot();

    const attempts = {
      create: await place({ worldId: world.id, projectId: unplaced.id, ...spot(10, 10) }),
      move: await move({ ...change(building), ...spot(10, 10) }),
      remove: await remove(change(building)),
    };
    for (const [command, result] of Object.entries(attempts)) {
      expect(result, command).toEqual({
        ok: false,
        error: { code: 'invalid_transition', message: ARCHIVED_WORLD_PLACEMENT_REFUSAL },
      });
    }
    expect(snapshot()).toEqual(before);
    await expect(list({ worldId: world.id })).resolves.toMatchObject({
      ok: true,
      data: { placements: [{ id: building.id }] },
    });
  });
});

describe('archive and trash remove the building in the same transaction (user decision 2026-11-20)', () => {
  const lifecycle = (project: Project) => ({
    worldId: project.worldId,
    projectId: project.id,
    expectedRevision: project.revision,
  });
  const buildings = () => new PlacementRepository(opened.db).listByWorld(world.id);

  it('archive removes the building; restore leaves the project unplaced', async () => {
    const project = newProject();
    await placed(project);
    const { project: archived } = projects.archive(lifecycle(project));
    expect(archived.status).toBe('archived');
    expect(buildings()).toEqual([]);

    projects.restore(lifecycle(archived));
    expect(buildings()).toEqual([]);
  });

  it("trash removes the building, also an archived project's re-placed one", async () => {
    const active = newProject('Active');
    await placed(active, 0, 0);
    projects.trash(lifecycle(active));

    const archived = projects.archive(lifecycle(newProject('Archived'))).project;
    await placed(archived, 4, 0);
    const { project: trashed } = projects.trash(lifecycle(archived));
    expect(buildings()).toEqual([]);

    projects.restoreFromTrash(lifecycle(trashed));
    expect(buildings()).toEqual([]);
  });

  it("leaves other projects' buildings alone", async () => {
    const keep = await placed(newProject('Keep'), 0, 0);
    const project = newProject('Go');
    await placed(project, 4, 0);
    projects.archive(lifecycle(project));
    expect(buildings().map((b) => b.id)).toEqual([keep.id]);
  });

  it('a refused archive (stale revision) keeps the building', async () => {
    const project = newProject();
    await placed(project);
    const before = snapshot();
    expect(() => projects.archive({ ...lifecycle(project), expectedRevision: 9 })).toThrow();
    expect(snapshot()).toEqual(before);
  });

  it('if removing the building fails, the status change is rolled back too', async () => {
    const project = newProject();
    await placed(project);
    // A temporary trigger makes the building delete fail after the project row has changed.
    opened.db.exec(`CREATE TEMP TRIGGER fail_delete BEFORE DELETE ON building_placements
                    BEGIN SELECT RAISE(ABORT, 'refused by test'); END;`);
    const before = snapshot();
    expect(() => projects.archive(lifecycle(project))).toThrow(/refused by test/);
    expect(() => projects.trash(lifecycle(project))).toThrow(/refused by test/);
    expect(snapshot()).toEqual(before);
  });
});

describe('service structures (default deny, #68 security L2)', () => {
  it('refuses to move or remove a service building and changes nothing', async () => {
    const guild = new PlacementRepository(opened.db).create({
      worldId: world.id,
      target: { type: 'service', id: 'agents-guild' },
      appearanceId: 'placeholder.building.2x2',
      tileX: 0,
      tileY: 0,
      rotation: 0,
    });
    const ref = { worldId: world.id, placementId: guild.id, expectedRevision: guild.revision };
    const before = snapshot();
    const attempts = {
      move: await move({ ...ref, ...spot(10, 10) }),
      remove: await remove(ref),
    };
    for (const [command, result] of Object.entries(attempts)) {
      expect(result, command).toEqual({
        ok: false,
        error: { code: 'invalid_transition', message: SERVICE_BUILDING_REFUSAL },
      });
    }
    expect(snapshot()).toEqual(before);
    // Still listed, as a service with no project status.
    await expect(list({ worldId: world.id })).resolves.toMatchObject({
      ok: true,
      data: { placements: [{ id: guild.id, target: { type: 'service' }, projectStatus: null }] },
    });
  });
});
