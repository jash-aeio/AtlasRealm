import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Database, openDatabase } from '../../src/main/storage/database';
import { migrate } from '../../src/main/storage/migrate';
import { MIGRATIONS } from '../../src/main/storage/migrations';
import { RepositoryError } from '../../src/main/storage/repositories/repository-support';
import {
  DEFAULT_GRID_SIZE,
  WorldRepository,
} from '../../src/main/storage/repositories/world-repository';

// WorldRepository (M1-3, #30) against a real migrated SQLite file.
let dir: string;
let db: Database;
let worlds: WorldRepository;
let clock: Date;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-worlds-'));
  db = openDatabase(join(dir, 'app.sqlite'));
  await migrate(db, MIGRATIONS, { backupDir: join(dir, 'backups') });
  clock = new Date('2026-11-11T12:00:00.000Z');
  worlds = new WorldRepository(db, () => {
    clock = new Date(clock.getTime() + 1_000);
    return clock;
  });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof RepositoryError) return error.code;
    throw error;
  }
  return undefined;
}

describe('WorldRepository', () => {
  it('creates a world with the default 64 × 64 grid', () => {
    const world = worlds.create({ name: ' Home ', themeId: 'meadow' });
    expect(world).toMatchObject({
      name: 'Home',
      themeId: 'meadow',
      gridWidth: DEFAULT_GRID_SIZE,
      gridHeight: DEFAULT_GRID_SIZE,
      archivedAt: null,
      revision: 1,
    });
    expect(worlds.get(world.id)).toEqual(world);
  });

  it.each([
    ['an empty name', { name: '' }],
    ['an unsafe theme ID', { themeId: 'Meadow/../x' }],
    ['a grid that is too small', { gridWidth: 8 }],
    ['a grid that is too large', { gridHeight: 512 }],
    ['a fractional grid size', { gridWidth: 32.5 }],
  ])('refuses %s', (_label, overrides) => {
    expect(codeOf(() => worlds.create({ name: 'Home', themeId: 'meadow', ...overrides }))).toBe(
      'invalid_input',
    );
    expect(worlds.list({ includeArchived: true })).toEqual([]);
  });

  it('renames with the expected revision and keeps the ID', () => {
    const world = worlds.create({ name: 'Home', themeId: 'meadow' });
    expect(worlds.rename(world.id, 1, 'Capital')).toMatchObject({
      id: world.id,
      name: 'Capital',
      revision: 2,
    });
  });

  it('refuses a stale revision and changes nothing', () => {
    const world = worlds.create({ name: 'Home', themeId: 'meadow' });
    worlds.rename(world.id, 1, 'Capital');
    const before = worlds.get(world.id);
    expect(codeOf(() => worlds.rename(world.id, 1, 'Lost'))).toBe('revision_conflict');
    expect(codeOf(() => worlds.archive(world.id, 1))).toBe('revision_conflict');
    expect(worlds.get(world.id)).toEqual(before);
  });

  it('archives and restores, hiding archived worlds from the default list', () => {
    const home = worlds.create({ name: 'Home', themeId: 'meadow' });
    const away = worlds.create({ name: 'Away', themeId: 'meadow' });

    const archived = worlds.archive(away.id, 1);
    expect(archived.archivedAt).toBe(archived.updatedAt);
    expect(worlds.list().map((w) => w.id)).toEqual([home.id]);
    expect(worlds.list({ includeArchived: true }).map((w) => w.id)).toEqual([home.id, away.id]);
    expect(codeOf(() => worlds.archive(away.id, 2))).toBe('invalid_transition');

    expect(worlds.restore(away.id, 2)).toMatchObject({ archivedAt: null, revision: 3 });
    expect(codeOf(() => worlds.restore(away.id, 3))).toBe('invalid_transition');
  });
});
