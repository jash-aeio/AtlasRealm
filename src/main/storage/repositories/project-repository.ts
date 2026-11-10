// Repository for `projects`: the only code that reads or writes that table.
//
// Identity: a project is its `id` (a UUID). Renaming changes only `name` (PRODUCT_RULES §3.1).
// Removal: there is no delete method. Archive and trash are status + timestamp changes, so a
// project and everything it owns stay recoverable (PRD §5.6; permanent delete is not in M1).
// Lifecycle:   active ⇄ archived,   active|archived → trashed → back to where it was (ADR-0015).
// Every change takes the revision the caller last read; see guardedUpdate.
import { randomUUID } from 'node:crypto';

import type { Database } from '../database';
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
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

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
    const row = this.db
      .prepare(
        `INSERT INTO projects (id, world_id, name, goal, template_id, template_version,
                               created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .get(this.newId(), input.worldId, name, goal, templateId, templateVersion, at, at);
    if (row === undefined) throw new Error('INSERT … RETURNING returned no row.');
    return toProject(row);
  }

  get(id: string): Project | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    return row === undefined ? undefined : toProject(row);
  }

  /**
   * A world's projects with the given statuses (active only by default), by name. Unpaged for
   * now: the project commands (M1-7) add cursor paging on top of this query path.
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

  /** Moves a project to the trash. `archived_at` is kept so a restore knows where to return. */
  trash(id: string, expectedRevision: number): Project {
    return this.update(id, expectedRevision, "status = 'trashed', trashed_at = :updated_at", {
      guard: { sql: "status <> 'trashed'", refusal: 'The project is already in the trash.' },
    });
  }

  /** Takes a project out of the trash, back to archived if it was archived, else active. */
  restoreFromTrash(id: string, expectedRevision: number): Project {
    return this.update(
      id,
      expectedRevision,
      `status = CASE WHEN archived_at IS NULL THEN 'active' ELSE 'archived' END,
       trashed_at = NULL`,
      { guard: { sql: "status = 'trashed'", refusal: 'The project is not in the trash.' } },
    );
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
