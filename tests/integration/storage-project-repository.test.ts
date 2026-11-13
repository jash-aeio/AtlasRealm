import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Database, openDatabase, withTransaction } from '../../src/main/storage/database';
import { migrate } from '../../src/main/storage/migrate';
import { MIGRATIONS } from '../../src/main/storage/migrations';
import {
  type Project,
  ProjectRepository,
} from '../../src/main/storage/repositories/project-repository';
import { RepositoryError } from '../../src/main/storage/repositories/repository-support';
import { type World, WorldRepository } from '../../src/main/storage/repositories/world-repository';

// ProjectRepository (M1-3, #30): stable identity, expected-revision updates and the
// archive/trash lifecycle without deletes, against a real migrated SQLite file.
let dir: string;
let db: Database;
let clock: Date;
let projects: ProjectRepository;
let world: World;

const tick = (): Date => {
  clock = new Date(clock.getTime() + 1_000);
  return clock;
};

async function open(): Promise<void> {
  db = openDatabase(join(dir, 'app.sqlite'));
  await migrate(db, MIGRATIONS, { backupDir: join(dir, 'backups') });
  projects = new ProjectRepository(db, tick);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-projects-'));
  clock = new Date('2026-11-11T12:00:00.000Z');
  await open();
  world = new WorldRepository(db, tick).create({ name: 'Home', themeId: 'meadow' });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function newProject(name = 'Launch plan'): Project {
  return projects.create({
    worldId: world.id,
    name,
    goal: 'Ship the spring campaign',
    templateId: 'generic',
    templateVersion: '1.0.0',
  });
}

function rowCount(): number {
  return Number(db.prepare('SELECT COUNT(*) AS n FROM projects').get()?.['n']);
}

/** Runs `action`, expecting a RepositoryError with `code`; returns the error. */
function expectRefusal(action: () => unknown, code: RepositoryError['code']): RepositoryError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(RepositoryError);
    expect((error as RepositoryError).code).toBe(code);
    return error as RepositoryError;
  }
  throw new Error(`expected a ${code} RepositoryError, but nothing was thrown`);
}

describe('create and read', () => {
  it('creates an active project with a UUID, trimmed fields and revision 1', () => {
    const project = projects.create({
      worldId: world.id,
      name: '  Launch plan \n',
      goal: '\tShip it  ',
      templateId: 'content-campaign',
      templateVersion: '1.0.0',
    });
    expect(project).toMatchObject({
      worldId: world.id,
      name: 'Launch plan',
      goal: 'Ship it',
      templateId: 'content-campaign',
      templateVersion: '1.0.0',
      status: 'active',
      archivedAt: null,
      trashedAt: null,
      revision: 1,
    });
    expect(project.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(project.createdAt).toBe(project.updatedAt);
    expect(projects.get(project.id)).toEqual(project);
  });

  it('allows two projects with the same name: names are not keys', () => {
    const a = newProject('Same');
    const b = newProject('Same');
    expect(a.id).not.toBe(b.id);
  });

  it('refuses a world that does not exist', () => {
    expectRefusal(
      () =>
        projects.create({
          worldId: '99999999-9999-4999-8999-999999999999',
          name: 'Orphan',
          templateId: 'generic',
          templateVersion: '1.0.0',
        }),
      'not_found',
    );
    expect(rowCount()).toBe(0);
  });

  it.each([
    ['an empty name', { name: '   ' }],
    ['an 81-character name', { name: 'x'.repeat(81) }],
    ['a name with a NUL byte', { name: `ok${String.fromCodePoint(0)}hidden` }],
    ['a name with a bidi override', { name: `invoice${String.fromCodePoint(0x202e)}fdp.exe` }],
    ['a name with a zero-width space', { name: `Launch${String.fromCodePoint(0x200b)}plan` }],
    ['a name with a line separator', { name: `Launch${String.fromCodePoint(0x2028)}plan` }],
    ['a name with an Arabic letter mark', { name: `Launch${String.fromCodePoint(0x061c)}plan` }],
    ['a name with a soft hyphen', { name: `Launch${String.fromCodePoint(0x00ad)}plan` }],
    ['a name with a word joiner', { name: `Launch${String.fromCodePoint(0x2060)}plan` }],
    ['a name with a BOM', { name: `Launch${String.fromCodePoint(0xfeff)}plan` }],
    ['a name with tag characters', { name: `Launch${String.fromCodePoint(0xe0041)}plan` }],
    ['a goal with tag characters', { goal: `Ship ${String.fromCodePoint(0xe0069)}it` }],
    ['a name with a lone surrogate', { name: `A${String.fromCharCode(0xd800)}B` }],
    ['a goal with a bidi isolate', { goal: `Ship ${String.fromCodePoint(0x2066)}it` }],
    ['a 2001-character goal', { goal: 'x'.repeat(2001) }],
    ['an unsafe template ID', { templateId: '../generic' }],
    ['a non-semver template version', { templateVersion: 'latest' }],
  ])('refuses %s with invalid_input', (_label, overrides) => {
    expectRefusal(
      () =>
        projects.create({
          worldId: world.id,
          name: 'Valid',
          templateId: 'generic',
          templateVersion: '1.0.0',
          ...overrides,
        }),
      'invalid_input',
    );
    expect(rowCount()).toBe(0);
  });

  it('keeps joiners that emoji sequences and scripts need', () => {
    const family = ['👩', '👩', '👧'].join(String.fromCodePoint(0x200d)); // zero-width joiner
    expect(newProject(`Family ${family}`).name).toBe(`Family ${family}`);
  });

  it('counts an emoji-heavy name in characters, like SQLite does', () => {
    // 80 code points, but 160 UTF-16 units: must be accepted.
    expect(newProject('🏰'.repeat(80)).name).toBe('🏰'.repeat(80));
  });

  it('lists a world’s projects by status, active only by default', () => {
    const active = newProject('Bravo');
    const archived = projects.archive(newProject('Alpha').id, 1);
    const trashed = projects.trash(newProject('Charlie').id, 1);

    expect(projects.listByWorld(world.id).map((p) => p.id)).toEqual([active.id]);
    expect(projects.listByWorld(world.id, ['active', 'archived']).map((p) => p.id)).toEqual([
      archived.id,
      active.id,
    ]);
    expect(projects.listByWorld(world.id, ['trashed']).map((p) => p.id)).toEqual([trashed.id]);
    expect(projects.listByWorld(world.id, [])).toEqual([]);
  });
});

describe('keyset paging (M1-7)', () => {
  /** Follows `next` until the last page and returns every page's names. */
  function allPages(limit: number): string[][] {
    const pages: string[][] = [];
    let after: { name: string; id: string } | undefined;
    for (;;) {
      const page = projects.pageByWorld(world.id, 'active', { after, limit });
      pages.push(page.projects.map((p) => p.name));
      if (page.next === null) return pages;
      after = page.next;
    }
  }

  it('walks every project once, in listByWorld order, ignoring case', () => {
    for (const name of ['delta', 'Alpha', 'charlie', 'Bravo', 'echo']) newProject(name);
    expect(allPages(2)).toEqual([['Alpha', 'Bravo'], ['charlie', 'delta'], ['echo']]);
    expect(allPages(5)).toEqual([['Alpha', 'Bravo', 'charlie', 'delta', 'echo']]);
  });

  it('breaks ties between equal names by ID, so no duplicate name is skipped', () => {
    const ids = [newProject('Same'), newProject('Same'), newProject('Same')].map((p) => p.id);
    const seen: string[] = [];
    let after: { name: string; id: string } | undefined;
    do {
      const page = projects.pageByWorld(world.id, 'active', { after, limit: 1 });
      seen.push(...page.projects.map((p) => p.id));
      after = page.next ?? undefined;
    } while (after !== undefined);
    expect(seen).toEqual([...ids].sort());
  });

  it('does not shift later pages when projects change between page loads', () => {
    for (const name of ['A', 'B', 'C', 'D']) newProject(name);
    const first = projects.pageByWorld(world.id, 'active', { limit: 2 });
    expect(first.projects.map((p) => p.name)).toEqual(['A', 'B']);
    // An offset-based page 2 would now start at "D" and skip "C".
    const a = first.projects[0];
    if (a === undefined) throw new Error('missing');
    projects.trash(a.id, a.revision);
    newProject('AA');
    const second = projects.pageByWorld(world.id, 'active', {
      after: first.next ?? undefined,
      limit: 2,
    });
    expect(second.projects.map((p) => p.name)).toEqual(['C', 'D']);
    expect(second.next).toBeNull();
  });

  it('filters by status and world', () => {
    newProject('Active');
    projects.archive(newProject('Archived').id, 1);
    const other = new WorldRepository(db, tick).create({ name: 'Other', themeId: 'meadow' });
    projects.create({
      worldId: other.id,
      name: 'Elsewhere',
      templateId: 'g',
      templateVersion: '1.0.0',
    });

    const names = (status: 'active' | 'archived' | 'trashed') =>
      projects.pageByWorld(world.id, status, { limit: 10 }).projects.map((p) => p.name);
    expect(names('active')).toEqual(['Active']);
    expect(names('archived')).toEqual(['Archived']);
    expect(names('trashed')).toEqual([]);
  });

  it('counts a world’s projects in every status', () => {
    newProject('One');
    projects.archive(newProject('Two').id, 1);
    projects.trash(newProject('Three').id, 1);
    expect(projects.countByWorld(world.id)).toBe(3);
  });

  it('rejects a page size below 1', () => {
    expect(() => projects.pageByWorld(world.id, 'active', { limit: 0 })).toThrow(RepositoryError);
  });
});

describe('expected-revision updates', () => {
  it('renames, keeping the ID and bumping revision and updated_at', () => {
    const created = newProject('Old name');
    const renamed = projects.rename(created.id, created.revision, ' New name ');
    expect(renamed).toMatchObject({
      id: created.id,
      name: 'New name',
      revision: 2,
      createdAt: created.createdAt,
    });
    expect(renamed.updatedAt > created.updatedAt).toBe(true);
    expect(projects.get(created.id)).toEqual(renamed);
  });

  it('refuses a stale revision with revision_conflict and changes nothing', () => {
    const created = newProject('Original');
    projects.rename(created.id, 1, 'First edit'); // now revision 2
    const before = projects.get(created.id);

    const error = expectRefusal(
      () => projects.rename(created.id, 1, 'Lost update'),
      'revision_conflict',
    );
    expect(error.currentRevision).toBe(2);
    expect(projects.get(created.id)).toEqual(before);

    // The same holds for every kind of change, not just renames.
    expectRefusal(() => projects.setGoal(created.id, 1, 'x'), 'revision_conflict');
    expectRefusal(() => projects.archive(created.id, 1), 'revision_conflict');
    expectRefusal(() => projects.trash(created.id, 1), 'revision_conflict');
    expect(projects.get(created.id)).toEqual(before);
  });

  it('refuses an unknown project with not_found', () => {
    expectRefusal(
      () => projects.rename('99999999-9999-4999-8999-999999999999', 1, 'x'),
      'not_found',
    );
  });

  it.each([0, -1, 1.5, Number.NaN])('refuses expected revision %s as invalid_input', (rev) => {
    const created = newProject();
    expectRefusal(() => projects.rename(created.id, rev, 'x'), 'invalid_input');
  });

  it('sets the goal, and allows clearing it', () => {
    const created = newProject();
    expect(projects.setGoal(created.id, 1, '  ').goal).toBe('');
  });

  it('stays inside the caller’s transaction, so a later failure rolls the change back', () => {
    const created = newProject('Before');
    expect(() =>
      withTransaction(db, () => {
        projects.rename(created.id, 1, 'Inside');
        throw new Error('something else in the same transaction failed');
      }),
    ).toThrow('something else');
    expect(projects.get(created.id)).toMatchObject({ name: 'Before', revision: 1 });
  });
});

describe('archive and trash never delete rows', () => {
  it('archives and restores an active project', () => {
    const created = newProject();
    const archived = projects.archive(created.id, 1);
    expect(archived).toMatchObject({ id: created.id, status: 'archived', revision: 2 });
    expect(archived.archivedAt).toBe(archived.updatedAt);

    const restored = projects.restoreFromArchive(created.id, 2);
    expect(restored).toMatchObject({ status: 'active', archivedAt: null, revision: 3 });
    expect(rowCount()).toBe(1);
  });

  it('trashes an active project and restores it to active', () => {
    const created = newProject();
    const trashed = projects.trash(created.id, 1);
    expect(trashed).toMatchObject({ status: 'trashed', archivedAt: null });
    expect(trashed.trashedAt).toBe(trashed.updatedAt);
    expect(rowCount()).toBe(1);

    expect(projects.restoreFromTrash(created.id, 2)).toMatchObject({
      status: 'active',
      trashedAt: null,
      revision: 3,
    });
  });

  it('restores an archived-then-trashed project back to archived (ADR-0015)', () => {
    const created = newProject();
    const archived = projects.archive(created.id, 1);
    const trashed = projects.trash(created.id, 2);
    expect(trashed).toMatchObject({ status: 'trashed', archivedAt: archived.archivedAt });

    expect(projects.restoreFromTrash(created.id, 3)).toMatchObject({
      status: 'archived',
      archivedAt: archived.archivedAt,
      trashedAt: null,
    });
  });

  it('refuses changes that the current status does not allow', () => {
    const created = newProject();
    expectRefusal(() => projects.restoreFromArchive(created.id, 1), 'invalid_transition');
    expectRefusal(() => projects.restoreFromTrash(created.id, 1), 'invalid_transition');

    projects.trash(created.id, 1);
    const before = projects.get(created.id);
    expectRefusal(() => projects.trash(created.id, 2), 'invalid_transition');
    expectRefusal(() => projects.archive(created.id, 2), 'invalid_transition');
    expectRefusal(() => projects.rename(created.id, 2, 'Edited in trash'), 'invalid_transition');
    expectRefusal(() => projects.setGoal(created.id, 2, 'Edited in trash'), 'invalid_transition');
    expect(projects.get(created.id)).toEqual(before);
  });

  it('exposes no delete operation', () => {
    const methods = Object.getOwnPropertyNames(ProjectRepository.prototype);
    expect(methods.filter((name) => /delete|remove|purge|destroy/i.test(name))).toEqual([]);
  });
});

describe('persistence', () => {
  it('keeps projects, IDs and revisions after the database is closed and reopened', async () => {
    const created = newProject('Survivor');
    const renamed = projects.rename(created.id, 1, 'Survivor (renamed)');
    projects.archive(created.id, renamed.revision);
    const before = projects.get(created.id);

    db.close();
    await open();

    expect(projects.get(created.id)).toEqual(before);
    expect(before).toMatchObject({ name: 'Survivor (renamed)', status: 'archived', revision: 3 });
  });
});
