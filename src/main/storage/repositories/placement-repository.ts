// Repository for `building_placements`: the only code that reads or writes that table.
//
// A placement is where a building stands on a world's grid. It *represents* a project (or a
// service structure); it is never the project (PRODUCT_RULES §3.1). So:
//   - "unplaced" means the project has no row here, and removing a placement deletes only
//     that row. Nothing in this file writes to `projects`.
//   - moving changes tiles and rotation only, never the project's ID, name or files.
//   - a project has at most one placement; the database's UNIQUE index backs that up.
// Footprints, bounds and collisions are not checked here: they depend on the world's size and
// on the appearance's footprint, and live in the shared placement rules (M2-1), which the
// placement service (M2-3) runs before calling this repository.
// Changes take the revision the caller last read (see guardedUpdate / guardedDelete).
import { randomUUID } from 'node:crypto';

import type { Database } from '../database';
import { type RepresentationTarget, resolveTarget, targetFromRow } from './representation-target';
import {
  guardedDelete,
  guardedUpdate,
  integer,
  RepositoryError,
  type Row,
  text,
} from './repository-support';

/** Quarter turns, in degrees (UI_SPEC §17.1). Must match the CHECK in migration 5. */
export const PLACEMENT_ROTATIONS = [0, 90, 180, 270] as const;
export type PlacementRotation = (typeof PLACEMENT_ROTATIONS)[number];

/** The largest tile index any world can have (grid max 256). Matches migration 5. */
export const MAX_TILE = 255;

export interface Placement {
  readonly id: string;
  readonly worldId: string;
  readonly target: RepresentationTarget;
  readonly appearanceId: string;
  readonly tileX: number;
  readonly tileY: number;
  readonly rotation: PlacementRotation;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
}

export interface PlacementSpot {
  readonly tileX: number;
  readonly tileY: number;
  readonly rotation: PlacementRotation;
}

export interface NewPlacement extends PlacementSpot {
  readonly worldId: string;
  readonly target: RepresentationTarget;
  readonly appearanceId: string;
}

// The asset manifest's ID shape (src/common/assets/asset-manifest.ts): lowercase words joined
// by single "." or "-". Whether the appearance exists is the service's question.
const APPEARANCE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const APPEARANCE_ID_MAX_CHARS = 100;

function isRotation(value: number): value is PlacementRotation {
  return (PLACEMENT_ROTATIONS as readonly number[]).includes(value);
}

function assertSpot(spot: PlacementSpot): PlacementSpot {
  for (const [field, value] of [
    ['Tile x', spot.tileX],
    ['Tile y', spot.tileY],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value > MAX_TILE) {
      throw new RepositoryError(
        'invalid_input',
        `${field} must be a whole number from 0 to ${String(MAX_TILE)}.`,
      );
    }
  }
  if (!isRotation(spot.rotation)) {
    throw new RepositoryError('invalid_input', 'Rotation must be 0, 90, 180 or 270.');
  }
  return { tileX: spot.tileX, tileY: spot.tileY, rotation: spot.rotation };
}

function assertAppearanceId(value: string): string {
  if (value.length > APPEARANCE_ID_MAX_CHARS || !APPEARANCE_ID.test(value)) {
    throw new RepositoryError(
      'invalid_input',
      `Appearance ID must be lowercase words joined by "." or "-", at most ${String(APPEARANCE_ID_MAX_CHARS)} characters.`,
    );
  }
  return value;
}

function toPlacement(row: Row): Placement {
  const rotation = integer(row, 'rotation');
  if (!isRotation(rotation)) throw new Error('Unknown rotation in database.');
  return {
    id: text(row, 'id'),
    worldId: text(row, 'world_id'),
    target: targetFromRow(row),
    appearanceId: text(row, 'appearance_id'),
    tileX: integer(row, 'tile_x'),
    tileY: integer(row, 'tile_y'),
    rotation,
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    revision: integer(row, 'revision'),
  };
}

export class PlacementRepository {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  /**
   * Places a building for a project (or a service structure) in a world. Refuses with
   * `not_found` if the world is missing or the project is not in it, and with `already_exists`
   * if the project already has a building. Does not check collisions (see the file comment).
   */
  create(input: NewPlacement): Placement {
    const spot = assertSpot(input);
    const appearanceId = assertAppearanceId(input.appearanceId);
    const target = resolveTarget(this.db, input.worldId, input.target);
    // Checked first for a clear error; the UNIQUE index still guards the insert itself.
    if (target.project_id !== null && this.findByProject(target.project_id) !== undefined) {
      throw new RepositoryError('already_exists', 'This project already has a building.');
    }

    const at = this.now().toISOString();
    const row = this.db
      .prepare(
        `INSERT INTO building_placements (id, world_id, project_id, service_kind, appearance_id,
                                          tile_x, tile_y, rotation, created_at, updated_at)
         VALUES (:id, :world_id, :project_id, :service_kind, :appearance_id,
                 :tile_x, :tile_y, :rotation, :at, :at)
         RETURNING *`,
      )
      .get({
        ...target,
        id: this.newId(),
        world_id: input.worldId,
        appearance_id: appearanceId,
        tile_x: spot.tileX,
        tile_y: spot.tileY,
        rotation: spot.rotation,
        at,
      });
    if (row === undefined) throw new Error('INSERT … RETURNING returned no row.');
    return toPlacement(row);
  }

  get(id: string): Placement | undefined {
    const row = this.db.prepare('SELECT * FROM building_placements WHERE id = ?').get(id);
    return row === undefined ? undefined : toPlacement(row);
  }

  /** The project's building, or undefined when the project is unplaced. */
  findByProject(projectId: string): Placement | undefined {
    const row = this.db
      .prepare('SELECT * FROM building_placements WHERE project_id = ?')
      .get(projectId);
    return row === undefined ? undefined : toPlacement(row);
  }

  /**
   * Every building in a world, oldest first. Unbounded: a world's buildings are capped by its
   * project cap (plus a handful of services); the IPC command (M2-3) adds its own bound.
   */
  listByWorld(worldId: string): Placement[] {
    return this.db
      .prepare('SELECT * FROM building_placements WHERE world_id = ? ORDER BY created_at, id')
      .all(worldId)
      .map(toPlacement);
  }

  /** Moves or turns a building. The target and appearance stay the same. */
  move(id: string, expectedRevision: number, spot: PlacementSpot): Placement {
    const checked = assertSpot(spot);
    return toPlacement(
      guardedUpdate(this.db, {
        table: 'building_placements',
        keyColumn: 'id',
        key: id,
        expectedRevision,
        set: 'tile_x = :tile_x, tile_y = :tile_y, rotation = :rotation',
        params: { tile_x: checked.tileX, tile_y: checked.tileY, rotation: checked.rotation },
        now: this.now(),
      }),
    );
  }

  /**
   * Removes a building. Its project becomes unplaced and is otherwise untouched: same row,
   * same revision, same files, runs keep going. Returns what was removed (for undo, M2-8).
   */
  remove(id: string, expectedRevision: number): Placement {
    return toPlacement(
      guardedDelete(this.db, {
        table: 'building_placements',
        keyColumn: 'id',
        key: id,
        expectedRevision,
      }),
    );
  }

  /**
   * Removes a project's building, if it has one, without a revision check. Only for use
   * inside the transaction that archives or trashes the project (M2-3, user decision
   * 2026-11-20): that change already checked the project's revision, and the building must go
   * whatever state it is in. Returns the removed placement, or undefined if it was unplaced.
   */
  removeByProject(projectId: string): Placement | undefined {
    const row = this.db
      .prepare('DELETE FROM building_placements WHERE project_id = ? RETURNING *')
      .get(projectId);
    return row === undefined ? undefined : toPlacement(row);
  }
}
