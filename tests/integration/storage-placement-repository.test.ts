import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Database, openDatabase } from '../../src/main/storage/database';
import { migrate } from '../../src/main/storage/migrate';
import { MIGRATIONS } from '../../src/main/storage/migrations';
import {
  type NewPlacement,
  type Placement,
  PlacementRepository,
} from '../../src/main/storage/repositories/placement-repository';
import {
  type Project,
  ProjectRepository,
} from '../../src/main/storage/repositories/project-repository';
import type { RepresentationTarget } from '../../src/main/storage/repositories/representation-target';
import { RepositoryError } from '../../src/main/storage/repositories/repository-support';
import { type World, WorldRepository } from '../../src/main/storage/repositories/world-repository';

// PlacementRepository (M2-2, #67): a building represents a project, never replaces it. Every
// test that changes a placement also checks that the `projects` table did not change.
let dir: string;
let db: Database;
let clock: Date;
let idCounter: number;
let worlds: WorldRepository;
let projects: ProjectRepository;
let placements: PlacementRepository;
let home: World;
let launch: Project;

const tick = (): Date => {
  clock = new Date(clock.getTime() + 1_000);
  return clock;
};
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const nextId = (): string => uuid((idCounter += 1));

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-placements-'));
  clock = new Date('2026-11-20T12:00:00.000Z');
  idCounter = 0;
  db = openDatabase(join(dir, 'app.sqlite'));
  await migrate(db, MIGRATIONS, { backupDir: join(dir, 'backups') });
  worlds = new WorldRepository(db, tick, nextId);
  projects = new ProjectRepository(db, tick, nextId);
  placements = new PlacementRepository(db, tick, nextId);
  home = worlds.create({ name: 'Home', themeId: 'meadow' });
  launch = newProject(home, 'Launch plan');
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

const projectRows = () => db.prepare('SELECT * FROM projects ORDER BY id').all();
const placementCount = () =>
  Number(db.prepare('SELECT count(*) AS n FROM building_placements').get()?.['n']);

function placeFor(project: Project, overrides: Partial<NewPlacement> = {}): Placement {
  return placements.create({
    worldId: project.worldId,
    target: { type: 'project', id: project.id },
    appearanceId: 'placeholder.building.2x2',
    tileX: 10,
    tileY: 12,
    rotation: 0,
    ...overrides,
  });
}

function expectRefusal(action: () => unknown, code: string): RepositoryError {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(RepositoryError);
  expect((caught as RepositoryError).code).toBe(code);
  return caught as RepositoryError;
}

describe('creating a placement', () => {
  it('places a project and reads it back by ID, by project and by world', () => {
    const before = projectRows();
    const placed = placeFor(launch, { rotation: 90 });

    expect(placed).toEqual({
      id: placed.id,
      worldId: home.id,
      target: { type: 'project', id: launch.id },
      appearanceId: 'placeholder.building.2x2',
      tileX: 10,
      tileY: 12,
      rotation: 90,
      createdAt: placed.createdAt,
      updatedAt: placed.createdAt,
      revision: 1,
    });
    expect(placements.get(placed.id)).toEqual(placed);
    expect(placements.findByProject(launch.id)).toEqual(placed);
    expect(placements.listByWorld(home.id)).toEqual([placed]);
    expect(projectRows()).toEqual(before);
  });

  it('places a service structure', () => {
    const guild = placements.create({
      worldId: home.id,
      target: { type: 'service', id: 'agents-guild' },
      appearanceId: 'placeholder.building.3x3',
      tileX: 30,
      tileY: 30,
      rotation: 270,
    });
    expect(guild.target).toEqual({ type: 'service', id: 'agents-guild' });
  });

  it('refuses a second building for the same project', () => {
    placeFor(launch);
    expectRefusal(() => placeFor(launch, { tileX: 40 }), 'already_exists');
    expect(placementCount()).toBe(1);
  });

  it('refuses forged targets without writing anything', () => {
    const other = worlds.create({ name: 'Elsewhere', themeId: 'meadow' });
    const stranger = newProject(other, 'Garden notes');

    // Another world's project, an unknown project, an unknown world, an unknown service.
    expectRefusal(() => placeFor(stranger, { worldId: home.id }), 'not_found');
    expectRefusal(
      () => placeFor(launch, { target: { type: 'project', id: uuid(999) } }),
      'not_found',
    );
    expectRefusal(() => placeFor(launch, { worldId: uuid(998) }), 'not_found');
    expectRefusal(
      () =>
        placeFor(launch, {
          target: { type: 'service', id: 'dragon-lair' } as unknown as RepresentationTarget,
        }),
      'invalid_input',
    );
    expectRefusal(
      () =>
        placeFor(launch, {
          target: { type: 'file', id: 'x' } as unknown as RepresentationTarget,
        }),
      'invalid_input',
    );
    expect(placementCount()).toBe(0);
  });

  it.each([
    ['a negative tile', { tileX: -1 }],
    ['a tile past the largest grid', { tileY: 256 }],
    ['a fractional tile', { tileX: 1.5 }],
    ['NaN', { tileY: Number.NaN }],
    ['rotation 45', { rotation: 45 }],
    ['an uppercase appearance', { appearanceId: 'Placeholder.Building' }],
    ['a path as appearance', { appearanceId: '../x.png' }],
    ['an empty appearance', { appearanceId: '' }],
    ['a too-long appearance', { appearanceId: 'a'.repeat(101) }],
  ])('refuses %s', (_label, overrides) => {
    expectRefusal(() => placeFor(launch, overrides as Partial<NewPlacement>), 'invalid_input');
    expect(placementCount()).toBe(0);
  });

  it('does not judge collisions: that is the placement rules’ job (M2-1)', () => {
    const second = newProject(home, 'Newsletter');
    placeFor(launch);
    expect(() => placeFor(second)).not.toThrow();
  });

  it('lists only the asked world’s buildings, oldest first', () => {
    const other = worlds.create({ name: 'Elsewhere', themeId: 'meadow' });
    const a = placeFor(launch);
    const b = placeFor(newProject(home, 'Newsletter'), { tileX: 20 });
    placeFor(newProject(other, 'Garden notes'));
    expect(placements.listByWorld(home.id).map((p) => p.id)).toEqual([a.id, b.id]);
  });
});

describe('moving a placement', () => {
  it('changes tiles and rotation only, and leaves the project alone', () => {
    const placed = placeFor(launch);
    const before = projectRows();

    const moved = placements.move(home.id, placed.id, 1, { tileX: 3, tileY: 4, rotation: 180 });

    expect(moved).toMatchObject({
      id: placed.id,
      target: placed.target,
      appearanceId: placed.appearanceId,
      tileX: 3,
      tileY: 4,
      rotation: 180,
      createdAt: placed.createdAt,
      revision: 2,
    });
    expect(moved.updatedAt > placed.updatedAt).toBe(true);
    expect(projectRows()).toEqual(before);
  });

  it('refuses a stale revision with revision_conflict and the current revision', () => {
    const placed = placeFor(launch);
    placements.move(home.id, placed.id, 1, { tileX: 3, tileY: 4, rotation: 0 });

    const error = expectRefusal(
      () => placements.move(home.id, placed.id, 1, { tileX: 9, tileY: 9, rotation: 0 }),
      'revision_conflict',
    );
    expect(error.currentRevision).toBe(2);
    expect(placements.get(placed.id)).toMatchObject({ tileX: 3, tileY: 4, revision: 2 });
  });

  it('refuses an unknown placement and a bad spot', () => {
    const placed = placeFor(launch);
    expectRefusal(
      () => placements.move(home.id, uuid(999), 1, { tileX: 1, tileY: 1, rotation: 0 }),
      'not_found',
    );
    expectRefusal(
      () => placements.move(home.id, placed.id, 1, { tileX: 1, tileY: 300, rotation: 0 }),
      'invalid_input',
    );
    expect(placements.get(placed.id)).toEqual(placed);
  });
});

describe('world scope of move and remove', () => {
  it('treats another world’s building as not found and leaves it where it is', () => {
    const other = worlds.create({ name: 'Elsewhere', themeId: 'meadow' });
    const elsewhere = placeFor(newProject(other, 'Garden notes'));

    expectRefusal(
      () => placements.move(home.id, elsewhere.id, 1, { tileX: 1, tileY: 1, rotation: 0 }),
      'not_found',
    );
    expectRefusal(() => placements.remove(home.id, elsewhere.id, 1), 'not_found');
    expect(placements.get(elsewhere.id)).toEqual(elsewhere);
  });
});

describe('removing a placement', () => {
  it('makes the project unplaced and changes nothing about the project', () => {
    const placed = placeFor(launch);
    const before = projectRows();

    expect(placements.remove(home.id, placed.id, 1)).toEqual(placed);

    expect(placements.findByProject(launch.id)).toBeUndefined();
    expect(placements.get(placed.id)).toBeUndefined();
    expect(projectRows()).toEqual(before);
    expect(projects.get(launch.id)).toEqual(launch);
  });

  it('refuses a stale revision and keeps the building', () => {
    const placed = placeFor(launch);
    placements.move(home.id, placed.id, 1, { tileX: 3, tileY: 4, rotation: 0 });

    const error = expectRefusal(
      () => placements.remove(home.id, placed.id, 1),
      'revision_conflict',
    );
    expect(error.currentRevision).toBe(2);
    expect(placementCount()).toBe(1);
  });

  it('refuses an unknown placement and a nonsense revision', () => {
    const placed = placeFor(launch);
    expectRefusal(() => placements.remove(home.id, uuid(999), 1), 'not_found');
    expectRefusal(() => placements.remove(home.id, placed.id, 0), 'invalid_input');
    expect(placementCount()).toBe(1);
  });

  it('lets the project be placed again afterwards', () => {
    const placed = placeFor(launch);
    placements.remove(home.id, placed.id, 1);
    expect(placeFor(launch, { tileX: 50 }).tileX).toBe(50);
  });

  it('removeByProject removes the project’s building without a revision', () => {
    const placed = placeFor(launch);
    placements.move(home.id, placed.id, 1, { tileX: 3, tileY: 4, rotation: 0 });
    const before = projectRows();

    expect(placements.removeByProject(launch.id)).toMatchObject({ id: placed.id, revision: 2 });
    expect(placements.removeByProject(launch.id)).toBeUndefined();
    expect(projectRows()).toEqual(before);
  });
});
