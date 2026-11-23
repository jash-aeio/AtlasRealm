import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Database, openDatabase } from '../../src/main/storage/database';
import { migrate } from '../../src/main/storage/migrate';
import { MIGRATIONS } from '../../src/main/storage/migrations';
import { ProjectRelationRepository } from '../../src/main/storage/repositories/project-relation-repository';
import {
  type Project,
  ProjectRepository,
} from '../../src/main/storage/repositories/project-repository';
import { RepositoryError } from '../../src/main/storage/repositories/repository-support';
import { type World, WorldRepository } from '../../src/main/storage/repositories/world-repository';
import type { RelationType } from '../../src/common/contracts/relation';

// ProjectRelationRepository (M2-11 #76, ADR-0029): directed, descriptive links inside one world.
// Refusals write nothing, and removing a link never touches a project.
let dir: string;
let db: Database;
let clock: Date;
let idCounter: number;
let projects: ProjectRepository;
let relations: ProjectRelationRepository;
let home: World;
let other: World;
let launch: Project;
let newsletter: Project;
let garden: Project;

const tick = (): Date => {
  clock = new Date(clock.getTime() + 1_000);
  return clock;
};
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const nextId = (): string => uuid((idCounter += 1));

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-relations-'));
  clock = new Date('2026-11-23T12:00:00.000Z');
  idCounter = 0;
  db = openDatabase(join(dir, 'app.sqlite'));
  await migrate(db, MIGRATIONS, { backupDir: join(dir, 'backups') });
  const worlds = new WorldRepository(db, tick, nextId);
  projects = new ProjectRepository(db, tick, nextId);
  relations = new ProjectRelationRepository(db, tick, nextId);
  home = worlds.create({ name: 'Home', themeId: 'meadow' });
  other = worlds.create({ name: 'Other', themeId: 'meadow' });
  launch = newProject(home, 'Launch plan');
  newsletter = newProject(home, 'Newsletter');
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

const link = (source: Project, target: Project, type: RelationType = 'depends_on') =>
  relations.create({
    worldId: home.id,
    sourceProjectId: source.id,
    targetProjectId: target.id,
    type,
  });
const relationRows = () => db.prepare('SELECT * FROM project_relations ORDER BY id').all();
const projectRows = () => db.prepare('SELECT * FROM projects ORDER BY id').all();

function expectRefusal(action: () => unknown, code: string): void {
  const before = relationRows();
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(RepositoryError);
  expect((caught as RepositoryError).code).toBe(code);
  expect(relationRows()).toEqual(before);
}

describe('create', () => {
  it('stores a confirmed user link with its direction', () => {
    const created = link(launch, newsletter);
    expect(created).toMatchObject({
      worldId: home.id,
      sourceProjectId: launch.id,
      targetProjectId: newsletter.id,
      type: 'depends_on',
      origin: 'user',
      confirmationState: 'confirmed',
      revision: 1,
    });
    expect(relations.get(created.id)).toEqual(created);
  });

  it('treats the reverse direction and another type as different links', () => {
    link(launch, newsletter);
    link(newsletter, launch);
    link(launch, newsletter, 'references');
    expect(relations.listByWorld(home.id)).toHaveLength(3);
  });

  it('refuses a duplicate', () => {
    link(launch, newsletter);
    expectRefusal(() => link(launch, newsletter), 'already_exists');
  });

  it('refuses a self-link', () => {
    expectRefusal(() => link(launch, launch), 'invalid_input');
  });

  it('refuses an unknown type that slipped past TypeScript', () => {
    expectRefusal(() => link(launch, newsletter, 'blocks' as RelationType), 'invalid_input');
  });

  it('refuses a project of another world, an unknown project and an unknown world', () => {
    expectRefusal(() => link(launch, garden), 'not_found');
    expectRefusal(() => link(garden, launch), 'not_found');
    expectRefusal(
      () =>
        relations.create({
          worldId: home.id,
          sourceProjectId: launch.id,
          targetProjectId: uuid(999),
          type: 'supports',
        }),
      'not_found',
    );
    expectRefusal(
      () =>
        relations.create({
          worldId: uuid(998),
          sourceProjectId: launch.id,
          targetProjectId: newsletter.id,
          type: 'supports',
        }),
      'not_found',
    );
  });

  it('never changes a project', () => {
    const before = projectRows();
    link(launch, newsletter);
    expect(projectRows()).toEqual(before);
  });
});

describe('listByWorld', () => {
  it('lists only that world, oldest first', () => {
    const first = link(launch, newsletter);
    const second = link(newsletter, launch, 'supports');
    expect(relations.listByWorld(home.id).map((r) => r.id)).toEqual([first.id, second.id]);
    expect(relations.listByWorld(other.id)).toEqual([]);
  });
});

describe('remove', () => {
  it('deletes only the link and returns it', () => {
    const created = link(launch, newsletter);
    const before = projectRows();
    expect(relations.remove(created.id, 1)).toEqual(created);
    expect(relations.get(created.id)).toBeUndefined();
    expect(projectRows()).toEqual(before);
  });

  it('refuses an unknown link and a stale revision', () => {
    const created = link(launch, newsletter);
    expectRefusal(() => relations.remove(uuid(999), 1), 'not_found');
    expectRefusal(() => relations.remove(created.id, 2), 'revision_conflict');
  });
});

describe('trashed projects', () => {
  it('keeps their links stored (the service hides them)', () => {
    const created = link(launch, newsletter);
    projects.trash(newsletter.id, newsletter.revision);
    expect(relations.get(created.id)).toEqual(created);
  });
});
