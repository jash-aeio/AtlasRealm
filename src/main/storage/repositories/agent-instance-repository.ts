// Repository for `agent_instances`: the only code that reads or writes that table.
//
// A recruited agent belongs to one project and is made from the agent package installed in
// that project's world (ADR-0036): the template version is read from `world_resources`, never
// taken from the caller. Creating an instance starts no work (PRD §5.3): nothing here writes
// runs, jobs or events. Dismissing deletes the instance and, through the foreign key, its
// skill bindings; the project, its artifacts and the installed packages are never touched.
// Whether an archived or trashed project may recruit is a service rule (M3-6). Trashing a
// project keeps its agents, like its links (ADR-0029).
import { randomUUID } from 'node:crypto';

import type { Database } from '../database';
import {
  guardedDelete,
  guardedUpdate,
  integer,
  normalizeName,
  nullableText,
  RepositoryError,
  type Row,
  text,
} from './repository-support';

export interface AgentInstance {
  readonly id: string;
  readonly worldId: string;
  readonly projectId: string;
  readonly templateId: string;
  readonly templateVersion: string;
  /** NULL: shown with the template's name. */
  readonly nickname: string | null;
  /** NULL: the template's default look. */
  readonly appearanceId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The configuration revision (DATA_MODEL §9.3). */
  readonly revision: number;
}

function toInstance(row: Row): AgentInstance {
  return {
    id: text(row, 'id'),
    worldId: text(row, 'world_id'),
    projectId: text(row, 'project_id'),
    templateId: text(row, 'template_id'),
    templateVersion: text(row, 'template_version'),
    nickname: nullableText(row, 'nickname'),
    appearanceId: nullableText(row, 'appearance_id'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    revision: integer(row, 'revision'),
  };
}

// A versioned asset ID such as placeholder.agent.scribe (same shape as building appearances).
const APPEARANCE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const APPEARANCE_MAX_CHARS = 100;

function cleanNickname(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return normalizeName(value, 'Nickname');
}

function cleanAppearance(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'string' ||
    value.length > APPEARANCE_MAX_CHARS ||
    !APPEARANCE_ID.test(value)
  ) {
    throw new RepositoryError('invalid_input', 'Appearance must be an asset ID.');
  }
  return value;
}

export class AgentInstanceRepository {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  get(id: string): AgentInstance | undefined {
    const row = this.db.prepare('SELECT * FROM agent_instances WHERE id = ?').get(id);
    return row === undefined ? undefined : toInstance(row);
  }

  /** A project's agents in recruit order (then ID). */
  listByProject(projectId: string): AgentInstance[] {
    return this.db
      .prepare('SELECT * FROM agent_instances WHERE project_id = ? ORDER BY created_at, id')
      .all(projectId)
      .map(toInstance);
  }

  /**
   * Recruits an idle agent into a project from the agent package installed in its world.
   * Refuses with `not_found` for an unknown project, or when that world has no agent package
   * with this ID installed (a skill or tool ID counts as not installed), and with
   * `invalid_input` for a bad nickname or appearance. Nothing is written on refusal.
   */
  create(input: {
    readonly projectId: string;
    readonly templateId: string;
    readonly nickname?: string | null;
    readonly appearanceId?: string | null;
  }): AgentInstance {
    const nickname = cleanNickname(input.nickname);
    const appearanceId = cleanAppearance(input.appearanceId);
    const project = this.db
      .prepare('SELECT world_id FROM projects WHERE id = ?')
      .get(input.projectId);
    if (project === undefined) throw new RepositoryError('not_found', 'No project with that ID.');
    const worldId = text(project, 'world_id');
    const template = this.db
      .prepare(
        `SELECT package_version FROM world_resources
         WHERE world_id = ? AND package_id = ? AND kind = 'agent'`,
      )
      .get(worldId, input.templateId);
    if (template === undefined) {
      throw new RepositoryError('not_found', 'That agent is not installed in this world.');
    }

    const at = this.now().toISOString();
    const row = this.db
      .prepare(
        `INSERT INTO agent_instances (id, world_id, project_id, template_id, template_version,
                                      nickname, appearance_id, created_at, updated_at)
         VALUES (:id, :world_id, :project_id, :template_id, :template_version, :nickname,
                 :appearance_id, :at, :at)
         RETURNING *`,
      )
      .get({
        id: this.newId(),
        world_id: worldId,
        project_id: input.projectId,
        template_id: input.templateId,
        template_version: text(template, 'package_version'),
        nickname,
        appearance_id: appearanceId,
        at,
      });
    if (row === undefined) throw new Error('INSERT … RETURNING returned no row.');
    return toInstance(row);
  }

  /**
   * Changes the nickname and/or appearance; `null` clears one, leaving a field out keeps it.
   * Refuses with `not_found`, `revision_conflict` or `invalid_input`.
   */
  update(
    id: string,
    expectedRevision: number,
    changes: { readonly nickname?: string | null; readonly appearanceId?: string | null },
  ): AgentInstance {
    const sets: string[] = [];
    const params: Record<string, string | null> = {};
    if ('nickname' in changes) {
      sets.push('nickname = :nickname');
      params['nickname'] = cleanNickname(changes.nickname);
    }
    if ('appearanceId' in changes) {
      sets.push('appearance_id = :appearance_id');
      params['appearance_id'] = cleanAppearance(changes.appearanceId);
    }
    if (sets.length === 0) throw new RepositoryError('invalid_input', 'Nothing to change.');
    const row = guardedUpdate(this.db, {
      table: 'agent_instances',
      keyColumn: 'id',
      key: id,
      expectedRevision,
      set: sets.join(', '),
      params,
      now: this.now(),
    });
    return toInstance(row);
  }

  /**
   * Dismisses an agent: deletes the instance and its skill bindings (ADR-0036). Nothing else
   * changes. Refuses with `not_found` or `revision_conflict`. Returns the removed instance.
   */
  dismiss(id: string, expectedRevision: number): AgentInstance {
    return toInstance(
      guardedDelete(this.db, {
        table: 'agent_instances',
        keyColumn: 'id',
        key: id,
        expectedRevision,
      }),
    );
  }
}
