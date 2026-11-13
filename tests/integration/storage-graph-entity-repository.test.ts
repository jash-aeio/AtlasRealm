import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Database, openDatabase, withTransaction } from '../../src/main/storage/database';
import { migrate } from '../../src/main/storage/migrate';
import { MIGRATIONS } from '../../src/main/storage/migrations';
import { GraphEntityRepository } from '../../src/main/storage/repositories/graph-entity-repository';
import {
  type Project,
  ProjectRepository,
} from '../../src/main/storage/repositories/project-repository';
import { RepositoryError } from '../../src/main/storage/repositories/repository-support';
import { type World, WorldRepository } from '../../src/main/storage/repositories/world-repository';

// Graph entities (M1-4, #31): every world and project gets one, written in the same
// transaction as the record; trashing tombstones it and restoring clears it; nothing is deleted.
let dir: string;
let db: Database;
let clock: Date;
/** IDs handed out in order. Tests queue specific ones to force a collision. */
let queuedIds: string[];
let idCounter: number;
let worlds: WorldRepository;
let projects: ProjectRepository;
let graph: GraphEntityRepository;

const tick = (): Date => {
  clock = new Date(clock.getTime() + 1_000);
  return clock;
};

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const nextId = (): string => queuedIds.shift() ?? uuid((idCounter += 1));

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-graph-entities-'));
  clock = new Date('2026-11-13T12:00:00.000Z');
  queuedIds = [];
  idCounter = 0;
  db = openDatabase(join(dir, 'app.sqlite'));
  await migrate(db, MIGRATIONS, { backupDir: join(dir, 'backups') });
  worlds = new WorldRepository(db, tick, nextId);
  projects = new ProjectRepository(db, tick, nextId);
  graph = new GraphEntityRepository(db, nextId);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function newWorld(name = 'Home'): World {
  return worlds.create({ name, themeId: 'meadow' });
}

function newProject(world: World, name = 'Launch plan'): Project {
  return projects.create({
    worldId: world.id,
    name,
    templateId: 'generic',
    templateVersion: '1.0.0',
  });
}

function count(table: 'worlds' | 'projects' | 'graph_entities'): number {
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.['n']);
}

describe('creating worlds and projects', () => {
  it('gives a new world its own app-owned entity', () => {
    const world = newWorld();
    const entity = graph.findByWorld(world.id);

    expect(entity).toEqual({
      id: expect.any(String) as string,
      kind: 'world',
      worldId: world.id,
      projectId: null,
      ownership: 'app_owned',
      sourceLocator: null,
      tombstonedAt: null,
      createdAt: world.createdAt,
      updatedAt: world.createdAt,
      revision: 1,
    });
    // Distinct from the record's ID and its name.
    expect(entity?.id).not.toBe(world.id);
    expect(entity?.id).not.toBe(world.name);
    expect(graph.get(entity?.id ?? '')).toEqual(entity);
  });

  it('gives a new project its own entity, scoped to its world', () => {
    const world = newWorld();
    const project = newProject(world);
    const entity = graph.findByProject(project.id);

    expect(entity).toMatchObject({
      kind: 'project',
      worldId: world.id,
      projectId: project.id,
      ownership: 'app_owned',
      tombstonedAt: null,
      createdAt: project.createdAt,
    });
    expect(entity?.id).not.toBe(project.id);
    // findByWorld returns the world's own entity, not one of its projects'.
    expect(graph.findByWorld(world.id)?.kind).toBe('world');
  });

  it('keeps the entity when a project is renamed: identity is not the name', () => {
    const world = newWorld();
    const project = newProject(world);
    const before = graph.findByProject(project.id);

    projects.rename(project.id, project.revision, 'Spring launch');

    expect(graph.findByProject(project.id)).toEqual(before);
  });
});

describe('transaction rollback', () => {
  it('saves no world if its entity cannot be saved', () => {
    const first = newWorld(); // uses IDs 1 (world) and 2 (entity)
    const takenEntityId = graph.findByWorld(first.id)?.id ?? '';
    // The next world gets a fresh ID, but its entity would reuse an existing entity ID.
    queuedIds.push(uuid(100), takenEntityId);

    expect(() => newWorld('Second')).toThrow(/UNIQUE/);

    expect(worlds.get(uuid(100))).toBeUndefined();
    expect(count('worlds')).toBe(1);
    expect(count('graph_entities')).toBe(1);
  });

  it('saves no project if its entity cannot be saved', () => {
    const world = newWorld();
    const takenEntityId = graph.findByWorld(world.id)?.id ?? '';
    queuedIds.push(uuid(100), takenEntityId);

    expect(() => newProject(world)).toThrow(/UNIQUE/);

    expect(projects.get(uuid(100))).toBeUndefined();
    expect(count('projects')).toBe(0);
    expect(count('graph_entities')).toBe(1);
  });

  it('saves no entity if the project itself cannot be saved', () => {
    const world = newWorld();
    const existing = newProject(world);
    // Reusing the project ID makes the project insert fail before any entity is written.
    queuedIds.push(existing.id, uuid(100));

    expect(() => newProject(world, 'Duplicate')).toThrow(/UNIQUE/);

    expect(graph.get(uuid(100))).toBeUndefined();
    expect(count('projects')).toBe(1);
    expect(count('graph_entities')).toBe(2);
  });

  it('does not trash a project whose entity cannot be tombstoned', () => {
    const world = newWorld();
    const project = newProject(world);
    // Simulates a broken invariant: the entity is missing.
    db.prepare('DELETE FROM graph_entities WHERE project_id = ?').run(project.id);

    expect(() => projects.trash(project.id, project.revision)).toThrow(RepositoryError);

    expect(projects.get(project.id)).toEqual(project);
  });

  it('joins a caller’s transaction, so the caller can roll everything back', () => {
    expect(() =>
      withTransaction(db, () => {
        newProject(newWorld());
        throw new Error('the caller changed its mind');
      }),
    ).toThrow('the caller changed its mind');

    expect([count('worlds'), count('projects'), count('graph_entities')]).toEqual([0, 0, 0]);
  });

  it('undoes only the failed write inside a caller’s transaction', () => {
    withTransaction(db, () => {
      const kept = newWorld();
      queuedIds.push(uuid(100), graph.findByWorld(kept.id)?.id ?? '');
      expect(() => newWorld('Second')).toThrow(/UNIQUE/);
    });

    expect(count('worlds')).toBe(1);
    expect(count('graph_entities')).toBe(1);
    expect(worlds.get(uuid(100))).toBeUndefined();
  });
});

describe('tombstones', () => {
  it('tombstones on trash and clears on restore, never deleting the entity', () => {
    const world = newWorld();
    const project = newProject(world);
    const created = graph.findByProject(project.id);

    const trashed = projects.trash(project.id, project.revision);
    const tombstoned = graph.findByProject(project.id);
    expect(tombstoned).toMatchObject({
      id: created?.id,
      tombstonedAt: trashed.trashedAt,
      updatedAt: trashed.updatedAt,
      revision: 2,
    });
    expect(count('graph_entities')).toBe(2);

    const restored = projects.restoreFromTrash(project.id, trashed.revision);
    expect(graph.findByProject(project.id)).toMatchObject({
      id: created?.id,
      tombstonedAt: null,
      updatedAt: restored.updatedAt,
      revision: 3,
    });
    expect(count('graph_entities')).toBe(2);
  });

  it('does not tombstone an archived project; trash and restore from archive round-trips', () => {
    const project = newProject(newWorld());
    const archived = projects.archive(project.id, project.revision);
    expect(graph.findByProject(project.id)?.tombstonedAt).toBeNull();

    const trashed = projects.trash(project.id, archived.revision);
    expect(graph.findByProject(project.id)?.tombstonedAt).toBe(trashed.trashedAt);

    const restored = projects.restoreFromTrash(project.id, trashed.revision);
    expect(restored.status).toBe('archived');
    expect(graph.findByProject(project.id)?.tombstonedAt).toBeNull();
  });

  it('leaves the entity untouched when the trash is refused (stale revision)', () => {
    const project = newProject(newWorld());
    const before = graph.findByProject(project.id);
    projects.rename(project.id, project.revision, 'Renamed');

    expect(() => projects.trash(project.id, project.revision)).toThrow(
      expect.objectContaining({ code: 'revision_conflict' }),
    );

    expect(graph.findByProject(project.id)).toEqual(before);
  });

  it('refuses to tombstone twice or clear a live entity', () => {
    const project = newProject(newWorld());
    const at = '2026-11-13T13:00:00.000Z';

    expect(() => graph.clearProjectTombstone(project.id, at)).toThrow(
      expect.objectContaining({ code: 'invalid_transition' }),
    );
    graph.tombstoneProject(project.id, at);
    expect(() => graph.tombstoneProject(project.id, at)).toThrow(
      expect.objectContaining({ code: 'invalid_transition' }),
    );
    expect(() => graph.tombstoneProject(uuid(999), at)).toThrow(
      expect.objectContaining({ code: 'not_found' }),
    );
  });
});
