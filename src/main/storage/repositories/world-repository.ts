// Repository for `worlds`: the only code that reads or writes that table.
// A world is identified by its UUID, never its name. Like projects, worlds are archived, not
// deleted (and the schema refuses to delete a world that still has projects).
// Creating a world also records its graph entity, in the same transaction (M1-4).
// Every change takes the revision the caller last read; see guardedUpdate.
import { randomUUID } from 'node:crypto';

import { type Database, withSavepoint } from '../database';
import { GraphEntityRepository } from './graph-entity-repository';
import {
  assertGridSize,
  assertSlug,
  guardedUpdate,
  type GuardedUpdate,
  integer,
  normalizeName,
  nullableText,
  type Row,
  text,
} from './repository-support';

/** Default grid size, the same as the M0 placeholder world (64 × 64 tiles). */
export const DEFAULT_GRID_SIZE = 64;

export interface World {
  readonly id: string;
  readonly name: string;
  readonly themeId: string;
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
}

export interface NewWorld {
  readonly name: string;
  readonly themeId: string;
  readonly gridWidth?: number;
  readonly gridHeight?: number;
}

function toWorld(row: Row): World {
  return {
    id: text(row, 'id'),
    name: text(row, 'name'),
    themeId: text(row, 'theme_id'),
    gridWidth: integer(row, 'grid_width'),
    gridHeight: integer(row, 'grid_height'),
    archivedAt: nullableText(row, 'archived_at'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    revision: integer(row, 'revision'),
  };
}

export class WorldRepository {
  private readonly graph: GraphEntityRepository;

  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {
    this.graph = new GraphEntityRepository(db, newId);
  }

  create(input: NewWorld): World {
    const name = normalizeName(input.name, 'World name');
    const themeId = assertSlug(input.themeId, 'Theme ID');
    const gridWidth = assertGridSize(input.gridWidth ?? DEFAULT_GRID_SIZE, 'Grid width');
    const gridHeight = assertGridSize(input.gridHeight ?? DEFAULT_GRID_SIZE, 'Grid height');
    const at = this.now().toISOString();
    // The world and its graph entity are saved together or not at all.
    return withSavepoint(this.db, (db) => {
      const row = db
        .prepare(
          `INSERT INTO worlds (id, name, theme_id, grid_width, grid_height, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           RETURNING *`,
        )
        .get(this.newId(), name, themeId, gridWidth, gridHeight, at, at);
      if (row === undefined) throw new Error('INSERT … RETURNING returned no row.');
      const world = toWorld(row);
      this.graph.createForWorld(world.id, at);
      return world;
    });
  }

  get(id: string): World | undefined {
    const row = this.db.prepare('SELECT * FROM worlds WHERE id = ?').get(id);
    return row === undefined ? undefined : toWorld(row);
  }

  /** Worlds in creation order; archived ones only when asked for. */
  list(options: { readonly includeArchived?: boolean } = {}): World[] {
    const where = options.includeArchived === true ? '' : 'WHERE archived_at IS NULL';
    return this.db
      .prepare(`SELECT * FROM worlds ${where} ORDER BY created_at, id`)
      .all()
      .map(toWorld);
  }

  rename(id: string, expectedRevision: number, name: string): World {
    return this.update(id, expectedRevision, 'name = :name', {
      params: { name: normalizeName(name, 'World name') },
    });
  }

  archive(id: string, expectedRevision: number): World {
    return this.update(id, expectedRevision, 'archived_at = :updated_at', {
      guard: { sql: 'archived_at IS NULL', refusal: 'The world is already archived.' },
    });
  }

  restore(id: string, expectedRevision: number): World {
    return this.update(id, expectedRevision, 'archived_at = NULL', {
      guard: { sql: 'archived_at IS NOT NULL', refusal: 'The world is not archived.' },
    });
  }

  private update(
    id: string,
    expectedRevision: number,
    set: string,
    options: Pick<GuardedUpdate, 'params' | 'guard'>,
  ): World {
    return toWorld(
      guardedUpdate(this.db, {
        table: 'worlds',
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
