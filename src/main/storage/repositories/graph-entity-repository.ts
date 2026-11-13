// Repository for `graph_entities`: the only code that reads or writes that table.
//
// A graph entity is the stable node ID the Realm Atlas (M2) and imports build on (GRAPH_MODEL
// §30.5). It has its own UUID, distinct from the name and from any position: layout is cosmetic
// and is stored elsewhere later (graph_view_states). For now every world and project has exactly
// one entity, written by WorldRepository and ProjectRepository in the same transaction as the
// record itself. That is why the write methods here take the record's timestamp and are meant
// to be called inside the caller's transaction, not on their own.
// Removal: there is no delete method. A trashed project's entity is tombstoned (marked as gone,
// row kept) and the tombstone is cleared on restore.
import { randomUUID } from 'node:crypto';

import type { Database } from '../database';
import { integer, nullableText, RepositoryError, type Row, text } from './repository-support';

export const GRAPH_ENTITY_KINDS = ['world', 'project'] as const;
export type GraphEntityKind = (typeof GRAPH_ENTITY_KINDS)[number];

/** app_owned: the app created it. external: it mirrors something found at `sourceLocator`. */
export const GRAPH_ENTITY_OWNERSHIPS = ['app_owned', 'external'] as const;
export type GraphEntityOwnership = (typeof GRAPH_ENTITY_OWNERSHIPS)[number];

export interface GraphEntity {
  readonly id: string;
  readonly kind: GraphEntityKind;
  readonly worldId: string;
  /** Set for project entities; null for a world's own entity. */
  readonly projectId: string | null;
  readonly ownership: GraphEntityOwnership;
  readonly sourceLocator: string | null;
  readonly tombstonedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
}

function oneOf<T extends string>(allowed: readonly T[], value: string, column: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`Unknown ${column} in database.`);
  }
  return value as T;
}

function toGraphEntity(row: Row): GraphEntity {
  return {
    id: text(row, 'id'),
    kind: oneOf(GRAPH_ENTITY_KINDS, text(row, 'kind'), 'graph entity kind'),
    worldId: text(row, 'world_id'),
    projectId: nullableText(row, 'project_id'),
    ownership: oneOf(GRAPH_ENTITY_OWNERSHIPS, text(row, 'ownership'), 'graph entity ownership'),
    sourceLocator: nullableText(row, 'source_locator'),
    tombstonedAt: nullableText(row, 'tombstoned_at'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    revision: integer(row, 'revision'),
  };
}

export class GraphEntityRepository {
  constructor(
    private readonly db: Database,
    private readonly newId: () => string = randomUUID,
  ) {}

  /** Records a new world's entity. Call inside the transaction that inserts the world. */
  createForWorld(worldId: string, at: string): GraphEntity {
    return this.insert('world', worldId, null, at);
  }

  /** Records a new project's entity. Call inside the transaction that inserts the project. */
  createForProject(projectId: string, worldId: string, at: string): GraphEntity {
    return this.insert('project', worldId, projectId, at);
  }

  get(id: string): GraphEntity | undefined {
    const row = this.db.prepare('SELECT * FROM graph_entities WHERE id = ?').get(id);
    return row === undefined ? undefined : toGraphEntity(row);
  }

  /** The world's own entity (not those of its projects). */
  findByWorld(worldId: string): GraphEntity | undefined {
    const row = this.db
      .prepare("SELECT * FROM graph_entities WHERE kind = 'world' AND world_id = ?")
      .get(worldId);
    return row === undefined ? undefined : toGraphEntity(row);
  }

  findByProject(projectId: string): GraphEntity | undefined {
    const row = this.db
      .prepare("SELECT * FROM graph_entities WHERE kind = 'project' AND project_id = ?")
      .get(projectId);
    return row === undefined ? undefined : toGraphEntity(row);
  }

  /** Marks a trashed project's entity as gone. Call inside the transaction that trashes it. */
  tombstoneProject(projectId: string, at: string): GraphEntity {
    return this.setProjectTombstone(projectId, at, at);
  }

  /** Clears the tombstone when a project leaves the trash, in the same transaction. */
  clearProjectTombstone(projectId: string, at: string): GraphEntity {
    return this.setProjectTombstone(projectId, null, at);
  }

  private insert(
    kind: GraphEntityKind,
    worldId: string,
    projectId: string | null,
    at: string,
  ): GraphEntity {
    const row = this.db
      .prepare(
        `INSERT INTO graph_entities (id, kind, world_id, project_id, ownership,
                                     created_at, updated_at)
         VALUES (?, ?, ?, ?, 'app_owned', ?, ?)
         RETURNING *`,
      )
      .get(this.newId(), kind, worldId, projectId, at, at);
    if (row === undefined) throw new Error('INSERT … RETURNING returned no row.');
    return toGraphEntity(row);
  }

  // Entities change only together with their project, which already checked the caller's
  // expected revision; so this matches on the current state instead of taking a revision.
  private setProjectTombstone(
    projectId: string,
    tombstonedAt: string | null,
    at: string,
  ): GraphEntity {
    // Setting a tombstone needs a live entity; clearing one needs a tombstoned entity.
    const stateGuard =
      tombstonedAt === null ? 'tombstoned_at IS NOT NULL' : 'tombstoned_at IS NULL';
    const row = this.db
      .prepare(
        `UPDATE graph_entities
         SET tombstoned_at = ?, updated_at = ?, revision = revision + 1
         WHERE kind = 'project' AND project_id = ? AND ${stateGuard}
         RETURNING *`,
      )
      .get(tombstonedAt, at, projectId);
    if (row !== undefined) return toGraphEntity(row);
    // Nothing matched. Either way the caller's transaction must not go ahead half-done.
    if (this.findByProject(projectId) === undefined) {
      throw new RepositoryError('not_found', 'The project has no graph entity.');
    }
    throw new RepositoryError(
      'invalid_transition',
      tombstonedAt === null
        ? 'The project’s graph entity is not tombstoned.'
        : 'The project’s graph entity is already tombstoned.',
    );
  }
}
