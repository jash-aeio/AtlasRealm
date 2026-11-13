// Repository for `projects`: the only code that reads or writes that table.
//
// Identity: a project is its `id` (a UUID). Renaming changes only `name` (PRODUCT_RULES §3.1).
// Removal: there is no delete method. Archive and trash are status + timestamp changes, so a
// project and everything it owns stay recoverable (PRD §5.6; permanent delete is not in M1).
// Lifecycle:   active ⇄ archived,   active|archived → trashed → back to where it was (ADR-0015).
// Every change takes the revision the caller last read; see guardedUpdate.
// Graph entity (M1-4): created with the project, tombstoned on trash and cleared on restore,
// each in the same transaction as the project change.
import { randomUUID } from 'node:crypto';

import { type Database, withSavepoint } from '../database';
import { GraphEntityRepository } from './graph-entity-repository';
import {
  assertSlug,
  assertVersion,
  guardedUpdate,
  type GuardedUpdate,
  integer,
  LIMITS,
  normalizeName,
  normalizeText,
  nullableText,
  RepositoryError,
  type Row,
  text,
} from './repository-support';

export const PROJECT_STATUSES = ['active', 'archived', 'trashed'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface Project {
  readonly id: string;
  readonly worldId: string;
  readonly name: string;
  readonly goal: string;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly status: ProjectStatus;
  readonly archivedAt: string | null;
  readonly trashedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
}

export interface NewProject {
  readonly worldId: string;
  readonly name: string;
  readonly goal?: string;
  readonly templateId: string;
  readonly templateVersion: string;
}

/** Where a page ended: the sort key of its last project. */
export interface ProjectPageKey {
  readonly name: string;
  readonly id: string;
}

export interface ProjectPage {
  readonly projects: Project[];
  /** Pass as `after` to get the next page; null on the last page. */
  readonly next: ProjectPageKey | null;
}

function isProjectStatus(value: string): value is ProjectStatus {
  return (PROJECT_STATUSES as readonly string[]).includes(value);
}

function toProject(row: Row): Project {
  const status = text(row, 'status');
  if (!isProjectStatus(status)) throw new Error(`Unknown project status in database.`);
  return {
    id: text(row, 'id'),
    worldId: text(row, 'world_id'),
    name: text(row, 'name'),
    goal: text(row, 'goal'),
    templateId: text(row, 'template_id'),
    templateVersion: text(row, 'template_version'),
    status,
    archivedAt: nullableText(row, 'archived_at'),
    trashedAt: nullableText(row, 'trashed_at'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    revision: integer(row, 'revision'),
  };
}

const NOT_TRASHED = {
  sql: "status <> 'trashed'",
  refusal: 'A trashed project cannot be edited. Restore it first.',
} as const;

export class ProjectRepository {
  private readonly graph: GraphEntityRepository;

  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {
    this.graph = new GraphEntityRepository(db, newId);
  }

  /** Creates an active project in an existing world. */
  create(input: NewProject): Project {
    const name = normalizeName(input.name, 'Project name');
    const goal = normalizeText(input.goal ?? '', 'Project goal', LIMITS.goalMaxChars);
    const templateId = assertSlug(input.templateId, 'Template ID');
    const templateVersion = assertVersion(input.templateVersion, 'Template version');
    // Checked first for a clear error; the foreign key still guards the insert itself.
    if (this.db.prepare('SELECT 1 FROM worlds WHERE id = ?').get(input.worldId) === undefined) {
      throw new RepositoryError('not_found', 'No world with that ID.');
    }

    const at = this.now().toISOString();
    // The project and its graph entity are saved together or not at all.
    return withSavepoint(this.db, (db) => {
      const row = db
        .prepare(
          `INSERT INTO projects (id, world_id, name, goal, template_id, template_version,
                                 created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING *`,
        )
        .get(this.newId(), input.worldId, name, goal, templateId, templateVersion, at, at);
      if (row === undefined) throw new Error('INSERT … RETURNING returned no row.');
      const project = toProject(row);
      this.graph.createForProject(project.id, project.worldId, at);
      return project;
    });
  }

  get(id: string): Project | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    return row === undefined ? undefined : toProject(row);
  }

  /**
   * A world's projects with the given statuses (active only by default), by name. Unpaged:
   * the IPC commands use pageByWorld instead.
   */
  listByWorld(worldId: string, statuses: readonly ProjectStatus[] = ['active']): Project[] {
    const wanted = PROJECT_STATUSES.filter((status) => statuses.includes(status));
    if (wanted.length === 0) return [];
    const placeholders = wanted.map(() => '?').join(', ');
    return this.db
      .prepare(
        `SELECT * FROM projects WHERE world_id = ? AND status IN (${placeholders})
         ORDER BY name COLLATE NOCASE, id`,
      )
      .all(worldId, ...wanted)
      .map(toProject);
  }

  /**
   * One page of a world's projects with one status, in the same order as listByWorld.
   *
   * Keyset paging: instead of "skip N rows", the next page starts strictly after the last
   * (name, id) the caller saw. Projects created, renamed or trashed between two page loads
   * can't shift the rest of the list, so nothing is shown twice or skipped because of an
   * offset. `id` breaks ties between equal names, which makes the order total.
   */
  pageByWorld(
    worldId: string,
    status: ProjectStatus,
    options: { readonly after?: ProjectPageKey; readonly limit: number },
  ): ProjectPage {
    const limit = Math.trunc(options.limit);
    if (limit < 1) throw new RepositoryError('invalid_input', 'Page size must be at least 1.');
    const after = options.after;
    // One extra row tells us whether another page exists without a second COUNT query.
    const rows = (
      after === undefined
        ? this.db
            .prepare(
              `SELECT * FROM projects WHERE world_id = ? AND status = ?
               ORDER BY name COLLATE NOCASE, id LIMIT ?`,
            )
            .all(worldId, status, limit + 1)
        : this.db
            .prepare(
              `SELECT * FROM projects WHERE world_id = ? AND status = ?
                 AND (name COLLATE NOCASE > ? OR (name COLLATE NOCASE = ? AND id > ?))
               ORDER BY name COLLATE NOCASE, id LIMIT ?`,
            )
            .all(worldId, status, after.name, after.name, after.id, limit + 1)
    ).map(toProject);
    const projects = rows.slice(0, limit);
    const last = projects.at(-1);
    return {
      projects,
      next: rows.length > limit && last !== undefined ? { name: last.name, id: last.id } : null,
    };
  }

  /** All of a world's projects, trashed ones included (for the per-world cap). */
  countByWorld(worldId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM projects WHERE world_id = ?')
      .get(worldId);
    return integer(row ?? {}, 'n');
  }

  /** Changes the display name. The ID, and everything that refers to it, stays the same. */
  rename(id: string, expectedRevision: number, name: string): Project {
    return this.update(id, expectedRevision, 'name = :name', {
      params: { name: normalizeName(name, 'Project name') },
      guard: NOT_TRASHED,
    });
  }

  setGoal(id: string, expectedRevision: number, goal: string): Project {
    return this.update(id, expectedRevision, 'goal = :goal', {
      params: { goal: normalizeText(goal, 'Project goal', LIMITS.goalMaxChars) },
      guard: NOT_TRASHED,
    });
  }

  /** Hides an active project from active views. Its data stays where it is. */
  archive(id: string, expectedRevision: number): Project {
    return this.update(id, expectedRevision, "status = 'archived', archived_at = :updated_at", {
      guard: { sql: "status = 'active'", refusal: 'Only an active project can be archived.' },
    });
  }

  restoreFromArchive(id: string, expectedRevision: number): Project {
    return this.update(id, expectedRevision, "status = 'active', archived_at = NULL", {
      guard: { sql: "status = 'archived'", refusal: 'The project is not archived.' },
    });
  }

  /**
   * Moves a project to the trash and tombstones its graph entity. `archived_at` is kept so a
   * restore knows where to return. Nothing is deleted.
   */
  trash(id: string, expectedRevision: number): Project {
    return withSavepoint(this.db, () => {
      const project = this.update(
        id,
        expectedRevision,
        "status = 'trashed', trashed_at = :updated_at",
        { guard: { sql: "status <> 'trashed'", refusal: 'The project is already in the trash.' } },
      );
      this.graph.tombstoneProject(project.id, project.updatedAt);
      return project;
    });
  }

  /**
   * Takes a project out of the trash, back to archived if it was archived, else active, and
   * clears its graph entity's tombstone.
   */
  restoreFromTrash(id: string, expectedRevision: number): Project {
    return withSavepoint(this.db, () => {
      const project = this.update(
        id,
        expectedRevision,
        `status = CASE WHEN archived_at IS NULL THEN 'active' ELSE 'archived' END,
         trashed_at = NULL`,
        { guard: { sql: "status = 'trashed'", refusal: 'The project is not in the trash.' } },
      );
      this.graph.clearProjectTombstone(project.id, project.updatedAt);
      return project;
    });
  }

  private update(
    id: string,
    expectedRevision: number,
    set: string,
    options: Pick<GuardedUpdate, 'params' | 'guard'>,
  ): Project {
    return toProject(
      guardedUpdate(this.db, {
        table: 'projects',
        keyColumn: 'id',
        key: id,
        expectedRevision,
        set,
        now: this.now(),
        ...options,
      }),
    );
  }
}
