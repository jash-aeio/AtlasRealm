// The renderer's view of one world's projects (M1-10 #37): one filter (Active, Archived or
// Trash) at a time, loaded page by page, plus the bundled templates for the create form.
//
// Like the session store it is a cache of what the main process says, never the source of
// truth. Every change goes through `window.atlas.project.*` with the world's ID, and the list is
// read again afterwards so the screen always shows saved data. A `revision_conflict` reloads
// and says so (ADR-0020).
//
// Paging: `project.list` returns an opaque `nextCursor`. This store only passes it back and never
// builds one. Search runs here, on the renderer side: while a search is active the store loads
// the remaining pages of the current filter (at most 1000 projects per world, so a bounded
// number of calls) and filters them by name and goal.
//
// Pure TypeScript with no React or DOM imports: the API is passed in, so it's unit-tested
// with a fake.
import type { AtlasApi } from '../../common/contracts/atlas-api';
import type { IpcError, IpcResult } from '../../common/contracts/ipc-result';
import {
  MAX_PROJECTS_PER_WORLD,
  PROJECT_PAGE_SIZE_DEFAULT,
  PROJECT_PAGE_SIZE_MAX,
  type ProjectStatus,
  type ProjectSummary,
} from '../../common/contracts/project';
import type { TemplateSummary } from '../../common/contracts/project-template';
import { createStore, type Store } from '../state/store';

/** The slice of `window.atlas` the project list needs. */
export interface ProjectListApi {
  readonly project: Pick<
    AtlasApi['project'],
    | 'list'
    | 'create'
    | 'rename'
    | 'updateGoal'
    | 'archive'
    | 'restore'
    | 'trash'
    | 'restoreFromTrash'
  >;
  readonly template: Pick<AtlasApi['template'], 'list'>;
}

export type TemplatesState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: IpcError }
  | { readonly status: 'ready'; readonly templates: readonly TemplateSummary[] };

export interface ProjectListState {
  readonly filter: ProjectStatus;
  /** The search text as typed. Empty means no search. */
  readonly query: string;
  /** `loading` only for the first page of a filter; later pages set `loadingMore`. */
  readonly status: 'loading' | 'ready' | 'error';
  /** Projects loaded so far for this filter, in the order the main process returned them. */
  readonly projects: readonly ProjectSummary[];
  /** Pass back for the next page; null when everything for this filter is loaded. */
  readonly nextCursor: string | null;
  readonly loadingMore: boolean;
  /** Why the list could not be read (status `error`), or why loading more failed. */
  readonly error: IpcError | null;
  /** A one-off message, such as "changed elsewhere, reloaded". */
  readonly notice: string | null;
  readonly templates: TemplatesState;
}

export const PROJECT_CONFLICT_NOTICE =
  'This project changed somewhere else, so the list was reloaded with the latest saved version. Check it and try again.';
export const PROJECT_MISSING_NOTICE =
  'That project is no longer here, so the list was reloaded with the latest saved version.';

/** What a command returned, after the list has reloaded. */
export type ProjectCommandOutcome =
  | {
      readonly ok: true;
      readonly project: ProjectSummary;
      /** Only for archive and trash: how active runs were checked (`stub` until M4). */
      readonly runCheck?: 'stub';
    }
  | { readonly ok: false; readonly error: IpcError };

export type LifecycleAction = 'archive' | 'restore' | 'trash' | 'restoreFromTrash';

export interface ProjectList {
  readonly store: Store<ProjectListState>;
  /** Loads templates and the first page of the current filter. */
  readonly start: () => Promise<void>;
  /** Shows another filter, starting from its first page. */
  readonly setFilter: (filter: ProjectStatus) => Promise<void>;
  /** Sets the search text; a non-empty search loads every remaining page of the filter. */
  readonly setQuery: (query: string) => Promise<void>;
  readonly loadMore: () => Promise<void>;
  /** Reads the current filter again, keeping at least as many projects as are shown now. */
  readonly refresh: (notice?: string | null) => Promise<void>;
  readonly create: (input: {
    readonly templateId: string;
    readonly templateVersion: string;
    readonly name: string;
    readonly goal: string;
  }) => Promise<ProjectCommandOutcome>;
  readonly rename: (projectId: string, name: string) => Promise<ProjectCommandOutcome>;
  readonly updateGoal: (projectId: string, goal: string) => Promise<ProjectCommandOutcome>;
  readonly lifecycle: (
    projectId: string,
    action: LifecycleAction,
  ) => Promise<ProjectCommandOutcome>;
  readonly dismissNotice: () => void;
}

/** Hard stop on page reads in one load, in case a cursor chain never ends. */
const MAX_PAGE_READS = Math.ceil(MAX_PROJECTS_PER_WORLD / PROJECT_PAGE_SIZE_MAX) + 2;

/** The projects that match the search (all loaded ones when there is no search). */
export function visibleProjects(state: ProjectListState): readonly ProjectSummary[] {
  const needle = state.query.trim().toLocaleLowerCase();
  if (needle === '') return state.projects;
  return state.projects.filter(
    (project) =>
      project.name.toLocaleLowerCase().includes(needle) ||
      project.goal.toLocaleLowerCase().includes(needle),
  );
}

/** True while a search is active but not every project of the filter has been read yet. */
export function searchIncomplete(state: ProjectListState): boolean {
  return state.query.trim() !== '' && state.nextCursor !== null;
}

export function createProjectList(api: ProjectListApi, worldId: string): ProjectList {
  const store = createStore<ProjectListState>({
    filter: 'active',
    query: '',
    status: 'loading',
    projects: [],
    nextCursor: null,
    loadingMore: false,
    error: null,
    notice: null,
    templates: { status: 'loading' },
  });
  // Only the newest load may write the list, so a slow older read (for example of a filter the
  // user already left) can't overwrite it.
  let latestLoad = 0;

  function patch(changes: Partial<ProjectListState>): void {
    store.set({ ...store.get(), ...changes });
  }

  type Pages =
    | { readonly ok: true; readonly projects: ProjectSummary[]; readonly next: string | null }
    | { readonly ok: false; readonly error: IpcError };

  /**
   * Reads pages of `filter` from `cursor` on until it has `atLeast` projects (or all of them
   * when `atLeast` is Infinity) or the last page is reached.
   */
  async function readPages(
    filter: ProjectStatus,
    cursor: string | undefined,
    atLeast: number,
  ): Promise<Pages> {
    const projects: ProjectSummary[] = [];
    let next: string | undefined = cursor;
    for (let read = 0; read < MAX_PAGE_READS; read++) {
      const wanted = atLeast - projects.length;
      const limit =
        wanted === Infinity
          ? PROJECT_PAGE_SIZE_MAX
          : Math.min(PROJECT_PAGE_SIZE_MAX, Math.max(PROJECT_PAGE_SIZE_DEFAULT, wanted));
      const result = await api.project.list({
        worldId,
        status: filter,
        limit,
        ...(next === undefined ? {} : { cursor: next }),
      });
      if (!result.ok) return { ok: false, error: result.error };
      projects.push(...result.data.projects);
      if (result.data.nextCursor === null) return { ok: true, projects, next: null };
      next = result.data.nextCursor;
      if (projects.length >= atLeast) break;
    }
    return { ok: true, projects, next: next ?? null };
  }

  /** Replaces the list with a fresh read of `filter`. */
  async function load(
    filter: ProjectStatus,
    atLeast: number,
    notice: string | null,
  ): Promise<void> {
    const ticket = ++latestLoad;
    // Re-reading the same filter keeps the current rows on screen until the new ones arrive;
    // another filter starts empty, so it never shows the previous filter's projects.
    const state = store.get();
    const sameFilter = state.filter === filter && state.status === 'ready';
    patch({
      filter,
      status: sameFilter ? 'ready' : 'loading',
      ...(sameFilter ? {} : { projects: [], nextCursor: null }),
      loadingMore: false,
      error: null,
    });
    const searching = store.get().query.trim() !== '';
    const pages = await readPages(filter, undefined, searching ? Infinity : atLeast);
    if (ticket !== latestLoad) return;
    if (!pages.ok) {
      patch({ status: 'error', projects: [], nextCursor: null, error: pages.error, notice });
      return;
    }
    patch({ status: 'ready', projects: pages.projects, nextCursor: pages.next, notice });
  }

  /** Appends pages after the current cursor (one page, or all of them while searching). */
  async function appendPages(all: boolean): Promise<void> {
    const state = store.get();
    if (state.status !== 'ready' || state.loadingMore || state.nextCursor === null) return;
    const ticket = latestLoad;
    patch({ loadingMore: true, error: null });
    const pages = await readPages(
      state.filter,
      state.nextCursor,
      all ? Infinity : PROJECT_PAGE_SIZE_DEFAULT,
    );
    if (ticket !== latestLoad) return;
    if (!pages.ok) {
      // A stale cursor (`invalid_payload`) means the list moved on: start over from the top.
      if (pages.error.code === 'invalid_payload') {
        await load(state.filter, store.get().projects.length, null);
        return;
      }
      patch({ loadingMore: false, error: pages.error });
      return;
    }
    // Skip anything already shown: a project renamed between two reads can appear twice.
    const seen = new Set(store.get().projects.map((project) => project.id));
    patch({
      loadingMore: false,
      projects: [...store.get().projects, ...pages.projects.filter((p) => !seen.has(p.id))],
      nextCursor: pages.next,
    });
  }

  async function loadTemplates(): Promise<void> {
    const result = await api.template.list();
    patch({
      templates: result.ok
        ? { status: 'ready', templates: result.data.templates }
        : { status: 'error', error: result.error },
    });
  }

  function refresh(notice: string | null = null): Promise<void> {
    const state = store.get();
    return load(state.filter, Math.max(state.projects.length, PROJECT_PAGE_SIZE_DEFAULT), notice);
  }

  /** Runs a command, then reloads. A conflict or a vanished project reloads with a notice. */
  async function command(
    run: () => Promise<IpcResult<{ project: ProjectSummary; runCheck?: 'stub' }>>,
  ): Promise<ProjectCommandOutcome> {
    const result = await run();
    if (result.ok) {
      await refresh(null);
      return { ok: true, ...result.data };
    }
    if (result.error.code === 'revision_conflict') await refresh(PROJECT_CONFLICT_NOTICE);
    else if (result.error.code === 'not_found') await refresh(PROJECT_MISSING_NOTICE);
    return { ok: false, error: result.error };
  }

  /** The loaded project with this ID: its revision is the one the user last saw. */
  function loaded(projectId: string): ProjectSummary {
    const project = store.get().projects.find((p) => p.id === projectId);
    if (project === undefined) throw new Error('unknown project');
    return project;
  }

  function change(projectId: string) {
    const project = loaded(projectId);
    return { worldId, projectId, expectedRevision: project.revision };
  }

  return {
    store,
    async start() {
      await Promise.all([
        loadTemplates(),
        load(store.get().filter, PROJECT_PAGE_SIZE_DEFAULT, null),
      ]);
    },
    setFilter: (filter) => load(filter, PROJECT_PAGE_SIZE_DEFAULT, null),
    async setQuery(query) {
      patch({ query });
      if (query.trim() !== '') await appendPages(true);
    },
    loadMore: () => appendPages(false),
    refresh,
    async create(input) {
      const result = await api.project.create({ worldId, ...input });
      if (!result.ok) return { ok: false, error: result.error };
      // A new project is active: show that filter so it appears at once.
      await load('active', Math.max(store.get().projects.length, PROJECT_PAGE_SIZE_DEFAULT), null);
      return { ok: true, project: result.data.project };
    },
    rename: (projectId, name) => command(() => api.project.rename({ ...change(projectId), name })),
    updateGoal: (projectId, goal) =>
      command(() => api.project.updateGoal({ ...change(projectId), goal })),
    lifecycle: (projectId, action) => command(() => api.project[action](change(projectId))),
    dismissNotice() {
      if (store.get().notice !== null) patch({ notice: null });
    },
  };
}
