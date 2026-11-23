import { describe, expect, it, vi } from 'vitest';

import type { IpcResult } from '../../src/common/contracts/ipc-result';
import type {
  ProjectListInput,
  ProjectListOutput,
  ProjectStatus,
  ProjectSummary,
} from '../../src/common/contracts/project';
import {
  createProjectList,
  PROJECT_CONFLICT_NOTICE,
  PROJECT_MISSING_NOTICE,
  searchIncomplete,
  visibleProjects,
  type ProjectListApi,
} from '../../src/renderer/projects/project-list';

const NOW = '2026-11-18T10:00:00.000Z';
const WORLD_ID = '11111111-2222-4333-8444-555555555555';

function project(n: number, status: ProjectStatus = 'active', goal = ''): ProjectSummary {
  const hex = n.toString(16).padStart(12, '0');
  return {
    id: `aaaaaaaa-bbbb-4ccc-8ddd-${hex}`,
    worldId: WORLD_ID,
    name: `Project ${String(n).padStart(3, '0')}`,
    goal,
    templateId: 'builtin.generic',
    templateVersion: '1.0.0',
    status,
    archivedAt: status === 'archived' ? NOW : null,
    trashedAt: status === 'trashed' ? NOW : null,
    createdAt: NOW,
    updatedAt: NOW,
    revision: 1,
  };
}

const ok = <T>(data: T): Promise<IpcResult<T>> => Promise.resolve({ ok: true, data });

/**
 * A fake main process holding `rows`. Its cursor is the index of the next row, encoded so
 * that a test can tell the store passed back exactly what it was given.
 */
function fakeApi(rows: ProjectSummary[]) {
  const list = vi.fn((input: ProjectListInput): Promise<IpcResult<ProjectListOutput>> => {
    const status = input.status ?? 'active';
    const matching = rows.filter((row) => row.status === status);
    const start = input.cursor === undefined ? 0 : Number(input.cursor.slice('c'.length));
    const limit = input.limit ?? 50;
    const page = matching.slice(start, start + limit);
    const end = start + page.length;
    return ok({ projects: page, nextCursor: end < matching.length ? `c${String(end)}` : null });
  });
  const unused = vi.fn(() => Promise.reject(new Error('not expected in this test')));
  const api = {
    project: {
      list,
      create: unused,
      rename: unused,
      updateGoal: unused,
      archive: unused,
      restore: unused,
      trash: unused,
      restoreFromTrash: unused,
    },
    template: { list: vi.fn(() => ok({ templates: [] })) },
  } satisfies ProjectListApi;
  return { api, list };
}

describe('project list store', () => {
  it('loads the first page of active projects for its world', async () => {
    const { api, list } = fakeApi([project(1), project(2), project(3, 'archived')]);
    const projects = createProjectList(api, WORLD_ID);
    await projects.start();

    const state = projects.store.get();
    expect(state.status).toBe('ready');
    expect(state.projects.map((p) => p.name)).toEqual(['Project 001', 'Project 002']);
    expect(state.nextCursor).toBeNull();
    expect(state.templates).toEqual({ status: 'ready', templates: [] });
    expect(list).toHaveBeenCalledWith({ worldId: WORLD_ID, status: 'active', limit: 50 });
  });

  it('pages with the cursor it was given and never builds one', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => project(i + 1));
    const { api, list } = fakeApi(rows);
    const projects = createProjectList(api, WORLD_ID);
    await projects.start();
    expect(projects.store.get().projects).toHaveLength(50);
    expect(projects.store.get().nextCursor).toBe('c50');

    await projects.loadMore();
    expect(list).toHaveBeenLastCalledWith({
      worldId: WORLD_ID,
      status: 'active',
      limit: 50,
      cursor: 'c50',
    });
    await projects.loadMore();
    const state = projects.store.get();
    expect(state.projects).toHaveLength(120);
    expect(state.nextCursor).toBeNull();
    // Every cursor sent was one the fake returned.
    const sent = list.mock.calls.map(([input]) => input.cursor).filter((c) => c !== undefined);
    expect(sent).toEqual(['c50', 'c100']);
  });

  it('switching filter starts empty and reads that status', async () => {
    const { api } = fakeApi([project(1), project(2, 'archived'), project(3, 'trashed')]);
    const projects = createProjectList(api, WORLD_ID);
    await projects.start();

    const pending = projects.setFilter('trashed');
    expect(projects.store.get()).toMatchObject({
      filter: 'trashed',
      status: 'loading',
      projects: [],
    });
    await pending;
    expect(projects.store.get().projects.map((p) => p.status)).toEqual(['trashed']);
  });

  it('a slow read of a filter the user already left cannot overwrite the list', async () => {
    const { api, list } = fakeApi([project(1), project(2, 'archived')]);
    const projects = createProjectList(api, WORLD_ID);
    await projects.start();

    let releaseSlow!: () => void;
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const fast = list.getMockImplementation();
    list.mockImplementationOnce(async (input) => {
      await slow;
      if (fast === undefined) throw new Error('no list implementation');
      return fast(input);
    });
    const first = projects.setFilter('archived');
    const second = projects.setFilter('active');
    await second;
    releaseSlow();
    await first;
    expect(projects.store.get().filter).toBe('active');
    expect(projects.store.get().projects.map((p) => p.status)).toEqual(['active']);
  });

  it('a search loads every remaining page and matches name or goal', async () => {
    const rows = Array.from({ length: 230 }, (_, i) => project(i + 1));
    rows[219] = project(220, 'active', 'Write the spring newsletter');
    const { api } = fakeApi(rows);
    const projects = createProjectList(api, WORLD_ID);
    await projects.start();
    expect(projects.store.get().projects).toHaveLength(50);

    await projects.setQuery('NEWSLETTER');
    const state = projects.store.get();
    expect(state.projects).toHaveLength(230);
    expect(searchIncomplete(state)).toBe(false);
    expect(visibleProjects(state).map((p) => p.name)).toEqual(['Project 220']);

    await projects.setQuery('project 00');
    expect(visibleProjects(projects.store.get())).toHaveLength(9);
    await projects.setQuery('');
    expect(visibleProjects(projects.store.get())).toHaveLength(230);
  });

  it('the map filter loads every page and keeps placed or unplaced projects', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => project(i + 1));
    const placed = new Set([rows[1]?.id ?? '', rows[110]?.id ?? '']);
    const { api } = fakeApi(rows);
    const projects = createProjectList(api, WORLD_ID);
    await projects.start();
    expect(projects.store.get().projects).toHaveLength(50);

    await projects.setPlacement('placed');
    const state = projects.store.get();
    expect(state.placement).toBe('placed');
    expect(state.projects).toHaveLength(120);
    expect(searchIncomplete(state)).toBe(false);
    expect(visibleProjects(state, placed).map((p) => p.name)).toEqual([
      'Project 002',
      'Project 111',
    ]);

    await projects.setPlacement('unplaced');
    expect(visibleProjects(projects.store.get(), placed)).toHaveLength(118);
    await projects.setPlacement('all');
    expect(visibleProjects(projects.store.get(), placed)).toHaveLength(120);
  });

  it('the map filter combines with the status filter and the search', async () => {
    const rows = [
      project(1, 'archived', 'garden'),
      project(2, 'archived', 'garden'),
      project(3, 'archived', 'kitchen'),
      project(4, 'active', 'garden'),
    ];
    const placed = new Set([rows[0]?.id ?? '']);
    const { api } = fakeApi(rows);
    const projects = createProjectList(api, WORLD_ID);
    await projects.start();
    await projects.setPlacement('unplaced');
    await projects.setFilter('archived');
    // The map filter survives a status change.
    expect(projects.store.get().placement).toBe('unplaced');
    await projects.setQuery('garden');
    expect(visibleProjects(projects.store.get(), placed).map((p) => p.name)).toEqual([
      'Project 002',
    ]);
  });

  it('while placements are unknown a map filter shows nothing instead of guessing', async () => {
    const { api } = fakeApi([project(1), project(2)]);
    const projects = createProjectList(api, WORLD_ID);
    await projects.start();
    await projects.setPlacement('unplaced');
    expect(visibleProjects(projects.store.get(), null)).toEqual([]);
    await projects.setPlacement('all');
    expect(visibleProjects(projects.store.get(), null)).toHaveLength(2);
  });

  it('a map filter chosen during the first read still gets every page', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => project(i + 1));
    const { api } = fakeApi(rows);
    const projects = createProjectList(api, WORLD_ID);
    const starting = projects.start();
    await projects.setPlacement('unplaced');
    await starting;
    const state = projects.store.get();
    expect(state.projects).toHaveLength(120);
    expect(state.nextCursor).toBeNull();
  });

  it('reports a list that could not be read', async () => {
    const { api, list } = fakeApi([]);
    list.mockResolvedValueOnce({
      ok: false,
      error: { code: 'not_found', message: 'That item does not exist in this profile.' },
    });
    const projects = createProjectList(api, WORLD_ID);
    await projects.start();
    expect(projects.store.get()).toMatchObject({ status: 'error', error: { code: 'not_found' } });
  });

  it('a stale cursor starts the list over instead of failing', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => project(i + 1));
    const { api, list } = fakeApi(rows);
    const projects = createProjectList(api, WORLD_ID);
    await projects.start();
    list.mockResolvedValueOnce({
      ok: false,
      error: { code: 'invalid_payload', message: 'That page link is no longer valid.' },
    });
    await projects.loadMore();
    const state = projects.store.get();
    expect(state.status).toBe('ready');
    expect(state.error).toBeNull();
    expect(state.projects).toHaveLength(50);
  });

  it('sends the revision it last saw and reloads after a change', async () => {
    const original = project(1);
    const rows = [original];
    const { api, list } = fakeApi(rows);
    const renamed = { ...original, name: 'Renamed', revision: 2 };
    const rename = vi.fn(() => {
      rows[0] = renamed;
      return ok({ project: renamed });
    });
    const projects = createProjectList({ ...api, project: { ...api.project, rename } }, WORLD_ID);
    await projects.start();
    const reads = list.mock.calls.length;

    const outcome = await projects.rename(original.id, 'Renamed');
    expect(outcome).toEqual({ ok: true, project: renamed });
    expect(rename).toHaveBeenCalledWith({
      worldId: WORLD_ID,
      projectId: renamed.id,
      expectedRevision: 1,
      name: 'Renamed',
    });
    expect(list.mock.calls.length).toBeGreaterThan(reads);
    expect(projects.store.get().projects[0]?.name).toBe('Renamed');
  });

  it('passes on runCheck from archive', async () => {
    const original = project(1);
    const rows = [original];
    const { api } = fakeApi(rows);
    const archive = vi.fn(() => {
      rows[0] = { ...original, status: 'archived' as const, revision: 2 };
      return ok({ project: rows[0], runCheck: 'stub' as const });
    });
    const projects = createProjectList({ ...api, project: { ...api.project, archive } }, WORLD_ID);
    await projects.start();

    const outcome = await projects.lifecycle(original.id, 'archive');
    expect(outcome).toMatchObject({ ok: true, runCheck: 'stub' });
    // It left the Active filter.
    expect(projects.store.get().projects).toEqual([]);
  });

  it('a revision conflict reloads the list and says why', async () => {
    const original = project(1);
    const rows = [original];
    const { api } = fakeApi(rows);
    const trash = vi.fn(() => {
      // Somebody else renamed it first.
      rows[0] = { ...original, name: 'Changed elsewhere', revision: 2 };
      return Promise.resolve<IpcResult<never>>({
        ok: false,
        error: { code: 'revision_conflict', message: 'changed', currentRevision: 2 },
      });
    });
    const projects = createProjectList({ ...api, project: { ...api.project, trash } }, WORLD_ID);
    await projects.start();

    const outcome = await projects.lifecycle(original.id, 'trash');
    expect(outcome).toMatchObject({ ok: false, error: { code: 'revision_conflict' } });
    const state = projects.store.get();
    expect(state.notice).toBe(PROJECT_CONFLICT_NOTICE);
    expect(state.projects[0]).toMatchObject({ name: 'Changed elsewhere', revision: 2 });

    projects.dismissNotice();
    expect(projects.store.get().notice).toBeNull();
  });

  it('a project that vanished reloads with its own notice', async () => {
    const original = project(1);
    const rows = [original];
    const { api } = fakeApi(rows);
    const updateGoal = vi.fn(() => {
      rows.length = 0;
      return Promise.resolve<IpcResult<never>>({
        ok: false,
        error: { code: 'not_found', message: 'gone' },
      });
    });
    const projects = createProjectList(
      { ...api, project: { ...api.project, updateGoal } },
      WORLD_ID,
    );
    await projects.start();
    await projects.updateGoal(original.id, 'New goal');
    expect(projects.store.get()).toMatchObject({ notice: PROJECT_MISSING_NOTICE, projects: [] });
  });

  it('create sends the world and shows the Active filter afterwards', async () => {
    const rows = [project(1, 'trashed')];
    const { api } = fakeApi(rows);
    const created = project(2);
    const create = vi.fn(() => {
      rows.push(created);
      return ok({ project: created });
    });
    const projects = createProjectList({ ...api, project: { ...api.project, create } }, WORLD_ID);
    await projects.start();
    await projects.setFilter('trashed');

    const input = {
      templateId: 'builtin.generic',
      templateVersion: '1.0.0',
      name: 'Project 002',
      goal: '',
    };
    expect(await projects.create(input)).toEqual({ ok: true, project: created });
    expect(create).toHaveBeenCalledWith({ worldId: WORLD_ID, ...input });
    expect(projects.store.get().filter).toBe('active');
    expect(projects.store.get().projects).toEqual([created]);
  });
});
