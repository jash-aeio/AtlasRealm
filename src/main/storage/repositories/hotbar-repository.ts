// Repository for `hotbar_slots`: the only code that reads or writes that table.
//
// Each world has ten shortcut slots (0-9, shown as keys 1-9 and 0). A slot points at a project
// or a service; it is a shortcut, never the thing itself (PRODUCT_RULES §3.1). So clearing or
// replacing a slot deletes or rewrites only the slot row; nothing here writes to `projects`.
// An empty slot has no row.
// No silent replacement: `assign` only fills an empty slot. Overwriting a filled slot is a
// separate `replace` that names the revision the caller last saw (M2-4 adds the "expected
// occupant" check on top). Each target is pinned at most once per world (ADR-0023).
import { HOTBAR_SLOT_COUNT } from '../../../common/contracts/hotbar';
import type { Database } from '../database';
import { type RepresentationTarget, resolveTarget, targetFromRow } from './representation-target';
import {
  assertRevision,
  explainUnchanged,
  integer,
  RepositoryError,
  type Row,
  text,
} from './repository-support';

// One number for the contract, this repository and migration 5. Re-exported for callers.
export { HOTBAR_SLOT_COUNT };

export interface HotbarSlot {
  readonly worldId: string;
  /** 0-9. Slot 0 is key 1, slot 9 is key 0. */
  readonly slot: number;
  readonly target: RepresentationTarget;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
}

function assertSlot(slot: number): number {
  if (!Number.isInteger(slot) || slot < 0 || slot >= HOTBAR_SLOT_COUNT) {
    throw new RepositoryError(
      'invalid_input',
      `Hotbar slot must be a whole number from 0 to ${String(HOTBAR_SLOT_COUNT - 1)}.`,
    );
  }
  return slot;
}

function toHotbarSlot(row: Row): HotbarSlot {
  const target = targetFromRow(row);
  if (text(row, 'target_type') !== target.type) {
    throw new Error('Hotbar slot target type disagrees with its target in database.');
  }
  return {
    worldId: text(row, 'world_id'),
    slot: integer(row, 'slot'),
    target,
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    revision: integer(row, 'revision'),
  };
}

const SELECT_REVISION =
  'SELECT revision FROM hotbar_slots WHERE world_id = :world_id AND slot = :slot';

export class HotbarRepository {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The world's filled slots, by slot number. Empty slots are simply absent. */
  list(worldId: string): HotbarSlot[] {
    return this.db
      .prepare('SELECT * FROM hotbar_slots WHERE world_id = ? ORDER BY slot')
      .all(worldId)
      .map(toHotbarSlot);
  }

  get(worldId: string, slot: number): HotbarSlot | undefined {
    const row = this.db
      .prepare('SELECT * FROM hotbar_slots WHERE world_id = ? AND slot = ?')
      .get(worldId, assertSlot(slot));
    return row === undefined ? undefined : toHotbarSlot(row);
  }

  /** The slot a target is pinned to in this world, if any. */
  findByTarget(worldId: string, target: RepresentationTarget): HotbarSlot | undefined {
    // `target` may come from outside TypeScript; an unknown tag is an error, not a guess.
    const type: string = target.type;
    if (type !== 'project' && type !== 'service') {
      throw new RepositoryError('invalid_input', 'Unknown target type.');
    }
    const column = type === 'project' ? 'project_id' : 'service_kind';
    const row = this.db
      .prepare(`SELECT * FROM hotbar_slots WHERE world_id = ? AND ${column} = ?`)
      .get(worldId, target.id);
    return row === undefined ? undefined : toHotbarSlot(row);
  }

  /**
   * Pins a target to an empty slot. Refuses with `already_exists` if the slot is filled (use
   * `replace`) or the target is already pinned to another slot of this world, and with
   * `not_found` / `invalid_input` for a forged target. Nothing is written on refusal.
   */
  assign(worldId: string, slot: number, target: RepresentationTarget): HotbarSlot {
    assertSlot(slot);
    const columns = resolveTarget(this.db, worldId, target);
    // Checked first for clear errors; the primary key and UNIQUE indexes still guard the insert.
    if (this.get(worldId, slot) !== undefined) {
      throw new RepositoryError('already_exists', 'That hotbar slot is already in use.');
    }
    this.assertNotPinnedElsewhere(worldId, slot, target);

    const at = this.now().toISOString();
    const row = this.db
      .prepare(
        `INSERT INTO hotbar_slots (world_id, slot, target_type, project_id, service_kind,
                                   created_at, updated_at)
         VALUES (:world_id, :slot, :target_type, :project_id, :service_kind, :at, :at)
         RETURNING *`,
      )
      .get({ ...columns, world_id: worldId, slot, target_type: target.type, at });
    if (row === undefined) throw new Error('INSERT … RETURNING returned no row.');
    return toHotbarSlot(row);
  }

  /**
   * Points a filled slot at a different target, only if the slot still has
   * `expectedRevision`. Refuses with `not_found` for an empty slot (use `assign`),
   * `revision_conflict` if someone changed the slot first, and `already_exists` if the new
   * target is pinned to another slot. The old target itself is untouched.
   */
  replace(
    worldId: string,
    slot: number,
    expectedRevision: number,
    target: RepresentationTarget,
  ): HotbarSlot {
    assertSlot(slot);
    assertRevision(expectedRevision);
    const columns = resolveTarget(this.db, worldId, target);
    // An empty slot is the more basic mistake, so it is reported before "pinned elsewhere".
    if (this.get(worldId, slot) === undefined) {
      throw new RepositoryError('not_found', 'That hotbar slot is empty.');
    }
    this.assertNotPinnedElsewhere(worldId, slot, target);

    const params = { world_id: worldId, slot };
    const row = this.db
      .prepare(
        `UPDATE hotbar_slots
         SET target_type = :target_type, project_id = :project_id,
             service_kind = :service_kind, updated_at = :updated_at, revision = revision + 1
         WHERE world_id = :world_id AND slot = :slot AND revision = :expected_revision
         RETURNING *`,
      )
      .get({
        ...columns,
        ...params,
        target_type: target.type,
        expected_revision: expectedRevision,
        updated_at: this.now().toISOString(),
      });
    if (row !== undefined) return toHotbarSlot(row);
    explainUnchanged(this.db, SELECT_REVISION, params, expectedRevision, {
      notFound: 'That hotbar slot is empty.',
      refusal: 'Replace refused.',
    });
  }

  /**
   * Empties a slot, only if it still has `expectedRevision`. Its target (a project or a
   * service) is not touched in any way. Returns what the slot held (for undo).
   */
  clear(worldId: string, slot: number, expectedRevision: number): HotbarSlot {
    assertSlot(slot);
    assertRevision(expectedRevision);
    const params = { world_id: worldId, slot };
    const row = this.db
      .prepare(
        `DELETE FROM hotbar_slots
         WHERE world_id = :world_id AND slot = :slot AND revision = :expected_revision
         RETURNING *`,
      )
      .get({ ...params, expected_revision: expectedRevision });
    if (row !== undefined) return toHotbarSlot(row);
    explainUnchanged(this.db, SELECT_REVISION, params, expectedRevision, {
      notFound: 'That hotbar slot is already empty.',
      refusal: 'Clear refused.',
    });
  }

  private assertNotPinnedElsewhere(
    worldId: string,
    slot: number,
    target: RepresentationTarget,
  ): void {
    const pinned = this.findByTarget(worldId, target);
    if (pinned !== undefined && pinned.slot !== slot) {
      // No slot number in the message: slots are 0-based, keys are not. Callers can look it up.
      throw new RepositoryError('already_exists', 'That is already pinned to another slot.');
    }
  }
}
