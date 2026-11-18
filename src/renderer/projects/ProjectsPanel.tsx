// The conventional project list for one world (M1-10 #37, UI_SPEC §6.3 / §6.6): filters,
// search, paging, and every M1 project action, with no canvas needed. A project shows here
// whether or not anything in the world represents it (PRODUCT_RULES §3.1).
//
// The parent gives this component `key={world.id}`, so another world gets a fresh list.
import { useEffect, useId, useState } from 'react';

import type { ProjectStatus } from '../../common/contracts/project';
import type { WorldSummary } from '../../common/contracts/world';
import { useStore } from '../state/use-store';
import { ProjectItem } from './ProjectItem';
import {
  createProjectList,
  searchIncomplete,
  visibleProjects,
  type ProjectListState,
} from './project-list';
import { FILTER_ADJECTIVES, FILTER_LABELS } from './project-messages';

interface ProjectsPanelProps {
  readonly world: WorldSummary;
}

const FILTERS: readonly ProjectStatus[] = ['active', 'archived', 'trashed'];

export function ProjectsPanel({ world }: ProjectsPanelProps) {
  const searchId = useId();
  const [list] = useState(() => createProjectList(window.atlas, world.id));
  const state = useStore(list.store);

  useEffect(() => {
    void list.start();
  }, [list]);

  const shown = visibleProjects(state);
  const searching = state.query.trim() !== '';

  return (
    <section className="projects" aria-labelledby="projects-heading">
      <h3 id="projects-heading">Projects</h3>

      <div className="projects-toolbar">
        <div role="group" aria-label="Show projects" className="projects-filters">
          {FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              aria-pressed={state.filter === filter}
              onClick={() => void list.setFilter(filter)}
            >
              {FILTER_LABELS[filter]}
            </button>
          ))}
        </div>
        <div className="projects-search">
          <label htmlFor={searchId}>Search projects</label>
          <input
            id={searchId}
            type="search"
            value={state.query}
            maxLength={200}
            placeholder="Name or goal"
            onChange={(event) => void list.setQuery(event.target.value)}
          />
        </div>
      </div>

      {state.notice !== null && (
        <div role="status" className="notice" data-testid="projects-notice">
          {state.notice}{' '}
          <button type="button" onClick={list.dismissNotice}>
            Dismiss
          </button>
        </div>
      )}

      {/* One polite summary instead of announcing every row (UI_SPEC §6.6). */}
      <p role="status" className="muted" data-testid="projects-summary">
        {summaryText(state, shown.length)}
      </p>

      {state.status === 'error' && state.error !== null && (
        <div role="alert" className="error">
          <p>
            Could not read the projects: {state.error.message} ({state.error.code})
          </p>
          <button type="button" onClick={() => void list.refresh()}>
            Try again
          </button>
        </div>
      )}

      {state.status === 'ready' && shown.length > 0 && (
        <ul className="project-list" aria-label={`${FILTER_LABELS[state.filter]} projects`}>
          {shown.map((project) => (
            <ProjectItem key={project.id} project={project} templates={state.templates} />
          ))}
        </ul>
      )}

      {state.status === 'ready' && state.error !== null && (
        <p role="alert" className="error">
          Could not load more projects: {state.error.message}
        </p>
      )}

      {state.status === 'ready' && state.nextCursor !== null && !searching && (
        <button type="button" disabled={state.loadingMore} onClick={() => void list.loadMore()}>
          {state.loadingMore ? 'Loading…' : 'Load more projects'}
        </button>
      )}

      <p className="muted">
        Every project in this world is listed here, whether or not it has a building on the map.
      </p>
    </section>
  );
}

function summaryText(state: ProjectListState, shownCount: number): string {
  const label = FILTER_ADJECTIVES[state.filter];
  if (state.status === 'loading') return `Loading ${label} projects…`;
  if (state.status === 'error') return '';
  const query = state.query.trim();
  if (query !== '') {
    if (searchIncomplete(state)) return 'Searching all projects…';
    if (shownCount === 0) return `No ${label} projects match “${query}”.`;
    return `${String(shownCount)} ${label} ${shownCount === 1 ? 'project matches' : 'projects match'} “${query}”.`;
  }
  if (shownCount === 0) {
    if (state.filter === 'active') return 'No active projects in this world yet.';
    if (state.filter === 'archived') return 'No archived projects.';
    return 'The trash is empty.';
  }
  const more = state.nextCursor === null ? '' : ' More are available below.';
  return `Showing ${String(shownCount)} ${label} ${shownCount === 1 ? 'project' : 'projects'}.${more}`;
}
