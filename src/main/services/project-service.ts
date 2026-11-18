// Application service for projects (M1-7 #34). The `project.*` IPC handlers call this; it
// checks ownership, templates, limits and active runs, then lets ProjectRepository make the
// change. Repository errors pass through and the handlers map them (withRepositoryErrors).
//
// Ownership (ADR-0020): every call names a world and a project. A project that doesn't exist,
// lives in another world, or belongs to another profile's database is `not_found` all the
// same, so the answer never reveals which of those it was.
import { z } from 'zod';

import {
  MAX_PROJECTS_PER_WORLD,
  ProjectId,
  type ProjectStatus,
} from '../../common/contracts/project';
import { WorldId } from '../../common/contracts/world';
import { CommandError } from '../ipc/router';
import type { ActiveProfile } from '../profiles/active-profile';
import {
  type Project,
  type ProjectPageKey,
  ProjectRepository,
} from '../storage/repositories/project-repository';
import { RepositoryError } from '../storage/repositories/repository-support';
import { WorldRepository } from '../storage/repositories/world-repository';
import type { TemplateCatalog } from '../templates/catalog';

/**
 * Answers "does this project have queued or running work?" before archive and trash.
 * `kind` says how much the answer can be trusted and is passed on to the UI as `runCheck`.
 */
export interface ActiveRunsProbe {
  readonly kind: 'stub';
  activeRunCount(projectId: string): number;
}

/**
 * STUB until the run runtime exists (M4). There are no runs yet, so it always reports none;
 * results carry `runCheck: 'stub'` so nothing claims this was verified. M4 replaces it with a
 * probe that reads persisted runs, and archive then requests cancellation (PRD §5.6).
 */
export const noActiveRunsStub: ActiveRunsProbe = {
  kind: 'stub',
  activeRunCount: () => 0,
};

export interface ProjectPageResult {
  readonly projects: readonly Project[];
  readonly nextCursor: string | null;
}

export interface LifecycleResult {
  readonly project: Project;
  readonly runCheck: ActiveRunsProbe['kind'];
}

type Change = {
  readonly worldId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
};

// What a cursor holds once decoded. It is bound to the world and status it was made for, so a
// cursor from another list is refused instead of quietly starting somewhere odd.
const CursorPayload = z.strictObject({
  v: z.literal(1),
  w: WorldId,
  s: z.enum(['active', 'archived', 'trashed']),
  n: z.string().max(400),
  i: ProjectId,
});

function encodeCursor(worldId: string, status: ProjectStatus, key: ProjectPageKey): string {
  const payload = { v: 1, w: worldId, s: status, n: key.name, i: key.id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string, worldId: string, status: ProjectStatus): ProjectPageKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    parsed = undefined;
  }
  const result = CursorPayload.safeParse(parsed);
  if (!result.success || result.data.w !== worldId || result.data.s !== status) {
    throw new CommandError(
      'invalid_payload',
      'That page link is no longer valid. Reload the list.',
    );
  }
  return { name: result.data.n, id: result.data.i };
}

export class ProjectService {
  constructor(
    private readonly active: ActiveProfile,
    private readonly templates: TemplateCatalog,
    private readonly runs: ActiveRunsProbe = noActiveRunsStub,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Creates an active project from an available template in an existing, unarchived world. */
  create(input: {
    readonly worldId: string;
    readonly templateId: string;
    readonly templateVersion: string;
    readonly name: string;
    readonly goal: string;
  }): Project {
    const world = new WorldRepository(this.db()).get(input.worldId);
    if (world === undefined) throw new RepositoryError('not_found', 'No world with that ID.');
    if (world.archivedAt !== null) {
      throw new CommandError(
        'invalid_transition',
        'This world is archived. Restore it before adding projects.',
      );
    }
    // Only templates that loaded and validated at startup count; an unavailable one is unknown.
    const template = this.templates.available.find(
      (t) => t.id === input.templateId && t.version === input.templateVersion,
    );
    if (template === undefined) {
      throw new CommandError('not_found', 'That template is not available.');
    }
    const projects = this.projects();
    // Count and insert run synchronously, so no other command can slip in between them.
    if (projects.countByWorld(world.id) >= MAX_PROJECTS_PER_WORLD) {
      throw new CommandError(
        'limit_reached',
        `This world already has ${String(MAX_PROJECTS_PER_WORLD)} projects (trash included).`,
      );
    }
    return projects.create({
      worldId: world.id,
      name: input.name,
      goal: input.goal,
      templateId: template.id,
      templateVersion: template.version,
    });
  }

  get(worldId: string, projectId: string): Project {
    return this.owned(this.projects(), worldId, projectId);
  }

  /** One page of a world's projects with one status, by name. */
  list(input: {
    readonly worldId: string;
    readonly status: ProjectStatus;
    readonly cursor?: string | undefined;
    readonly limit: number;
  }): ProjectPageResult {
    // An unknown world (including another profile's) is `not_found`, not an empty list.
    if (new WorldRepository(this.db()).get(input.worldId) === undefined) {
      throw new RepositoryError('not_found', 'No world with that ID.');
    }
    const after =
      input.cursor === undefined
        ? undefined
        : decodeCursor(input.cursor, input.worldId, input.status);
    const page = this.projects().pageByWorld(input.worldId, input.status, {
      after,
      limit: input.limit,
    });
    return {
      projects: page.projects,
      nextCursor: page.next === null ? null : encodeCursor(input.worldId, input.status, page.next),
    };
  }

  /** The ID stays the same; only the display name changes (PRODUCT_RULES §3.1). */
  rename(change: Change, name: string): Project {
    const projects = this.projects();
    const project = this.owned(projects, change.worldId, change.projectId);
    return projects.rename(project.id, change.expectedRevision, name);
  }

  updateGoal(change: Change, goal: string): Project {
    const projects = this.projects();
    const project = this.owned(projects, change.worldId, change.projectId);
    return projects.setGoal(project.id, change.expectedRevision, goal);
  }

  /** Hides the project from active views. Its data and files stay where they are. */
  archive(change: Change): LifecycleResult {
    const projects = this.projects();
    const project = this.owned(projects, change.worldId, change.projectId);
    this.refuseWhileRunsActive(project.id, 'archived');
    return this.lifecycle(projects.archive(project.id, change.expectedRevision));
  }

  restore(change: Change): Project {
    const projects = this.projects();
    const project = this.owned(projects, change.worldId, change.projectId);
    return projects.restoreFromArchive(project.id, change.expectedRevision);
  }

  /** Moves the project to the recoverable trash. Nothing is deleted. */
  trash(change: Change): LifecycleResult {
    const projects = this.projects();
    const project = this.owned(projects, change.worldId, change.projectId);
    this.refuseWhileRunsActive(project.id, 'moved to the trash');
    return this.lifecycle(projects.trash(project.id, change.expectedRevision));
  }

  restoreFromTrash(change: Change): Project {
    const projects = this.projects();
    const project = this.owned(projects, change.worldId, change.projectId);
    return projects.restoreFromTrash(project.id, change.expectedRevision);
  }

  // Asked for on every call, so a profile switch (M1-8) is picked up immediately.
  private db() {
    return this.active.current().db;
  }

  private projects(): ProjectRepository {
    return new ProjectRepository(this.db(), this.now);
  }

  private owned(projects: ProjectRepository, worldId: string, projectId: string): Project {
    const project = projects.get(projectId);
    if (project?.worldId !== worldId) {
      throw new RepositoryError('not_found', 'No project with that ID in that world.');
    }
    return project;
  }

  /**
   * Cancelling runs isn't built yet, so archive and trash refuse while any are active
   * (ADR-0020). With the stub probe this never triggers.
   */
  private refuseWhileRunsActive(projectId: string, action: string): void {
    if (this.runs.activeRunCount(projectId) > 0) {
      throw new CommandError(
        'invalid_transition',
        `This project has active runs, so it can't be ${action} yet. Stop its runs first.`,
      );
    }
  }

  private lifecycle(project: Project): LifecycleResult {
    return { project, runCheck: this.runs.kind };
  }
}
