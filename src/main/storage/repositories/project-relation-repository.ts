// Repository for `project_relations`: the only code that reads or writes that table.
//
// A link between two projects of one world (ADR-0029). It is descriptive only: nothing here
// writes to `projects`, and removing a link deletes only the link row (GRAPH_MODEL §30.5).
// Every type is directed; the source → target order is the direction. The checks below run
// first so callers get a stable error code; migration 6's CHECKs, composite foreign keys and
// UNIQUE index still guard every write.
// Whether a trashed or archived project may be linked is a service rule (GraphService).
import { randomUUID } from 'node:crypto';

import {
  CONFIRMATION_STATES,
  type ConfirmationState,
  RELATION_ORIGINS,
  RELATION_TYPES,
  type RelationOrigin,
  type RelationType,
} from '../../../common/contracts/relation';
import type { Database } from '../database';
import { guardedDelete, integer, RepositoryError, type Row, text } from './repository-support';

export interface ProjectRelation {
  readonly id: string;
  readonly worldId: string;
  readonly sourceProjectId: string;
  readonly targetProjectId: string;
  readonly type: RelationType;
  readonly origin: RelationOrigin;
  readonly confirmationState: ConfirmationState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
}

function oneOf<T extends string>(row: Row, column: string, allowed: readonly T[]): T {
  const value = text(row, column);
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`Column ${column} has an unknown value in database.`);
  }
  return value as T;
}

function toRelation(row: Row): ProjectRelation {
  return {
    id: text(row, 'id'),
    worldId: text(row, 'world_id'),
    sourceProjectId: text(row, 'source_project_id'),
    targetProjectId: text(row, 'target_project_id'),
    type: oneOf(row, 'relation_type', RELATION_TYPES),
    origin: oneOf(row, 'origin', RELATION_ORIGINS),
    confirmationState: oneOf(row, 'confirmation_state', CONFIRMATION_STATES),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    revision: integer(row, 'revision'),
  };
}

export class ProjectRelationRepository {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  get(id: string): ProjectRelation | undefined {
    const row = this.db.prepare('SELECT * FROM project_relations WHERE id = ?').get(id);
    return row === undefined ? undefined : toRelation(row);
  }

  /** Every link stored for the world, oldest first (then by ID), including trashed ends. */
  listByWorld(worldId: string): ProjectRelation[] {
    return this.db
      .prepare('SELECT * FROM project_relations WHERE world_id = ? ORDER BY created_at, id')
      .all(worldId)
      .map(toRelation);
  }

  /** The link of this type from `source` to `target`, if one exists. */
  find(
    sourceProjectId: string,
    targetProjectId: string,
    type: RelationType,
  ): ProjectRelation | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM project_relations
         WHERE source_project_id = ? AND target_project_id = ? AND relation_type = ?`,
      )
      .get(sourceProjectId, targetProjectId, type);
    return row === undefined ? undefined : toRelation(row);
  }

  /**
   * Stores a user link, confirmed by being made. Refuses with `invalid_input` for a self-link
   * or an unknown type, `not_found` if either project isn't in this world, and
   * `already_exists` for the same source, target and type. Nothing is written on refusal.
   */
  create(input: {
    readonly worldId: string;
    readonly sourceProjectId: string;
    readonly targetProjectId: string;
    readonly type: RelationType;
  }): ProjectRelation {
    // `type` may come from outside TypeScript; an unknown one is an error, not a guess.
    if (!(RELATION_TYPES as readonly string[]).includes(input.type)) {
      throw new RepositoryError('invalid_input', 'Unknown link type.');
    }
    if (input.sourceProjectId === input.targetProjectId) {
      throw new RepositoryError('invalid_input', 'A project cannot be linked to itself.');
    }
    if (this.db.prepare('SELECT 1 FROM worlds WHERE id = ?').get(input.worldId) === undefined) {
      throw new RepositoryError('not_found', 'No world with that ID.');
    }
    const inWorld = this.db.prepare('SELECT 1 FROM projects WHERE id = ? AND world_id = ?');
    for (const id of [input.sourceProjectId, input.targetProjectId]) {
      if (inWorld.get(id, input.worldId) === undefined) {
        throw new RepositoryError('not_found', 'No project with that ID in this world.');
      }
    }
    if (this.find(input.sourceProjectId, input.targetProjectId, input.type) !== undefined) {
      throw new RepositoryError('already_exists', 'Those projects already have that link.');
    }

    const at = this.now().toISOString();
    const row = this.db
      .prepare(
        `INSERT INTO project_relations (id, world_id, source_project_id, target_project_id,
                                        relation_type, origin, confirmation_state,
                                        created_at, updated_at)
         VALUES (:id, :world_id, :source, :target, :type, 'user', 'confirmed', :at, :at)
         RETURNING *`,
      )
      .get({
        id: this.newId(),
        world_id: input.worldId,
        source: input.sourceProjectId,
        target: input.targetProjectId,
        type: input.type,
        at,
      });
    if (row === undefined) throw new Error('INSERT … RETURNING returned no row.');
    return toRelation(row);
  }

  /**
   * Deletes the link only if it still has `expectedRevision`, and returns it (for undo). The
   * projects are untouched. `not_found` for an unknown ID, `revision_conflict` if it changed.
   */
  remove(id: string, expectedRevision: number): ProjectRelation {
    return toRelation(
      guardedDelete(this.db, {
        table: 'project_relations',
        keyColumn: 'id',
        key: id,
        expectedRevision,
      }),
    );
  }
}
