import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Database, openDatabase } from '../../src/main/storage/database';
import { migrate } from '../../src/main/storage/migrate';
import { MIGRATIONS } from '../../src/main/storage/migrations';
import { HotbarRepository } from '../../src/main/storage/repositories/hotbar-repository';
import {
  type Project,
  ProjectRepository,
} from '../../src/main/storage/repositories/project-repository';
import type { RepresentationTarget } from '../../src/main/storage/repositories/representation-target';
import { RepositoryError } from '../../src/main/storage/repositories/repository-support';
import { type World, WorldRepository } from '../../src/main/storage/repositories/world-repository';

// HotbarRepository (M2-2, #67): a slot is a shortcut. Filling a used slot is never silent, a
// target is pinned at most once per world, and nothing here changes a project.
let dir: string;
let db: Database;
let clock: Date;
let idCounter: number;
let worlds: WorldRepository;
let projects: ProjectRepository;
let hotbar: HotbarRepository;
let home: World;
let launch: Project;
let newsletter: Project;

const tick = (): Date => {
  clock = new Date(clock.getTime() + 1_000);
  return clock;
};
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const nextId = (): string => uuid((idCounter += 1));

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-hotbar-'));
  clock = new Date('2026-11-20T12:00:00.000Z');
  idCounter = 0;
  db = openDatabase(join(dir, 'app.sqlite'));
  await migrate(db, MIGRATIONS, { backupDir: join(dir, 'backups') });
  worlds = new WorldRepository(db, tick, nextId);
  projects = new ProjectRepository(db, tick, nextId);
  hotbar = new HotbarRepository(db, tick);
  home = worlds.create({ name: 'Home', themeId: 'meadow' });
  launch = newProject(home, 'Launch plan');
  newsletter = newProject(home, 'Newsletter');
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

const projectTarget = (project: Project): RepresentationTarget => ({
  type: 'project',
  id: project.id,
});
const projectRows = () => db.prepare('SELECT * FROM projects ORDER BY id').all();
const slotRows = () => db.prepare('SELECT * FROM hotbar_slots ORDER BY world_id, slot').all();

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

describe('assigning a slot', () => {
  it('pins a project and a service, and lists filled slots in order', () => {
    const before = projectRows();
    const settings = hotbar.assign(home.id, 9, { type: 'service', id: 'settings' });
    const pinned = hotbar.assign(home.id, 0, projectTarget(launch));

    expect(pinned).toEqual({
      worldId: home.id,
      slot: 0,
      target: { type: 'project', id: launch.id },
      createdAt: pinned.createdAt,
      updatedAt: pinned.createdAt,
      revision: 1,
    });
    expect(hotbar.list(home.id)).toEqual([pinned, settings]);
    expect(hotbar.get(home.id, 0)).toEqual(pinned);
    expect(hotbar.get(home.id, 5)).toBeUndefined();
    expect(hotbar.findByTarget(home.id, projectTarget(launch))).toEqual(pinned);
    expect(hotbar.findByTarget(home.id, { type: 'service', id: 'settings' })).toEqual(settings);
    expect(projectRows()).toEqual(before);
  });

  it('never silently replaces a filled slot', () => {
    const pinned = hotbar.assign(home.id, 3, projectTarget(launch));
    expectRefusal(() => hotbar.assign(home.id, 3, projectTarget(newsletter)), 'already_exists');
    expect(hotbar.list(home.id)).toEqual([pinned]);
  });

  it('refuses to pin the same target to a second slot', () => {
    hotbar.assign(home.id, 0, projectTarget(launch));
    hotbar.assign(home.id, 1, { type: 'service', id: 'activity' });
    const before = slotRows();
    expectRefusal(() => hotbar.assign(home.id, 2, projectTarget(launch)), 'already_exists');
    expectRefusal(
      () => hotbar.assign(home.id, 2, { type: 'service', id: 'activity' }),
      'already_exists',
    );
    expect(slotRows()).toEqual(before);
  });

  it('keeps each world’s hotbar separate', () => {
    const other = worlds.create({ name: 'Elsewhere', themeId: 'meadow' });
    hotbar.assign(home.id, 0, { type: 'service', id: 'activity' });
    hotbar.assign(other.id, 0, { type: 'service', id: 'activity' });
    expect(hotbar.list(home.id)).toHaveLength(1);
    expect(hotbar.list(other.id)).toHaveLength(1);
  });

  it('refuses forged targets and slots without writing anything', () => {
    const other = worlds.create({ name: 'Elsewhere', themeId: 'meadow' });
    const stranger = newProject(other, 'Garden notes');

    expectRefusal(() => hotbar.assign(home.id, 0, projectTarget(stranger)), 'not_found');
    expectRefusal(() => hotbar.assign(home.id, 0, { type: 'project', id: uuid(999) }), 'not_found');
    expectRefusal(() => hotbar.assign(uuid(998), 0, projectTarget(launch)), 'not_found');
    expectRefusal(
      () =>
        hotbar.assign(home.id, 0, {
          type: 'service',
          id: 'dragon-lair',
        } as unknown as RepresentationTarget),
      'invalid_input',
    );
    for (const slot of [-1, 10, 1.5, Number.NaN]) {
      expectRefusal(() => hotbar.assign(home.id, slot, projectTarget(launch)), 'invalid_input');
    }
    expect(slotRows()).toEqual([]);
  });

  it('fills all ten slots and an eleventh project leaves every slot and project in place', () => {
    // §22.2 #2 at repository level; the command and UI versions are M2-4 and M2-10.
    const pinned = Array.from({ length: 9 }, (_, i) => newProject(home, `Project ${String(i)}`));
    pinned.unshift(launch);
    pinned.forEach((project, slot) => hotbar.assign(home.id, slot, projectTarget(project)));
    const slotsBefore = slotRows();

    const eleventh = newProject(home, 'Eleventh');

    expect(slotRows()).toEqual(slotsBefore);
    expectRefusal(() => hotbar.assign(home.id, 4, projectTarget(eleventh)), 'already_exists');
    expect(slotRows()).toEqual(slotsBefore);
    for (const project of [...pinned, eleventh, newsletter]) {
      expect(projects.get(project.id)).toBeDefined();
    }
  });
});

describe('replacing a slot', () => {
  it('points a filled slot at a new target with the right revision; the old one is untouched', () => {
    hotbar.assign(home.id, 0, projectTarget(launch));
    const before = projectRows();

    const replaced = hotbar.replace(home.id, 0, 1, { type: 'service', id: 'tool-shops' });

    expect(replaced).toMatchObject({
      slot: 0,
      target: { type: 'service', id: 'tool-shops' },
      revision: 2,
    });
    expect(hotbar.findByTarget(home.id, projectTarget(launch))).toBeUndefined();
    expect(projectRows()).toEqual(before);
  });

  it('refuses a stale revision with the current revision', () => {
    hotbar.assign(home.id, 0, projectTarget(launch));
    hotbar.replace(home.id, 0, 1, projectTarget(newsletter));

    const error = expectRefusal(
      () => hotbar.replace(home.id, 0, 1, projectTarget(launch)),
      'revision_conflict',
    );
    expect(error.currentRevision).toBe(2);
    expect(hotbar.get(home.id, 0)?.target).toEqual(projectTarget(newsletter));
  });

  it('refuses an empty slot and a target pinned elsewhere', () => {
    hotbar.assign(home.id, 0, projectTarget(launch));
    hotbar.assign(home.id, 1, projectTarget(newsletter));
    const before = slotRows();

    expectRefusal(() => hotbar.replace(home.id, 5, 1, projectTarget(launch)), 'not_found');
    expectRefusal(() => hotbar.replace(home.id, 0, 1, projectTarget(newsletter)), 'already_exists');
    expectRefusal(() => hotbar.replace(home.id, 0, 0, projectTarget(launch)), 'invalid_input');
    expect(slotRows()).toEqual(before);
  });
});

describe('clearing a slot', () => {
  it('empties the slot and never touches its project', () => {
    const pinned = hotbar.assign(home.id, 2, projectTarget(launch));
    const before = projectRows();

    expect(hotbar.clear(home.id, 2, 1)).toEqual(pinned);

    expect(hotbar.get(home.id, 2)).toBeUndefined();
    expect(projectRows()).toEqual(before);
    expect(projects.get(launch.id)).toEqual(launch);
  });

  it('keeps the pin of an archived or trashed project (the status is shown, not hidden)', () => {
    hotbar.assign(home.id, 0, projectTarget(launch));
    const archived = projects.archive(launch.id, launch.revision);
    projects.trash(archived.id, archived.revision);
    expect(hotbar.get(home.id, 0)?.target).toEqual(projectTarget(launch));
  });

  it('refuses a stale revision and an already empty slot', () => {
    hotbar.assign(home.id, 0, projectTarget(launch));
    hotbar.replace(home.id, 0, 1, projectTarget(newsletter));
    const before = slotRows();

    expect(
      expectRefusal(() => hotbar.clear(home.id, 0, 1), 'revision_conflict').currentRevision,
    ).toBe(2);
    expectRefusal(() => hotbar.clear(home.id, 7, 1), 'not_found');
    expect(slotRows()).toEqual(before);
  });

  it('frees the target so it can be pinned to another slot', () => {
    hotbar.assign(home.id, 0, projectTarget(launch));
    hotbar.clear(home.id, 0, 1);
    expect(hotbar.assign(home.id, 6, projectTarget(launch)).slot).toBe(6);
  });
});
