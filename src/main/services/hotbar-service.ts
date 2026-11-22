// Application service for hotbar shortcuts (M2-4 #69, ADR-0026). The `hotbar.*` IPC handlers
// call this; it checks the world, the target and the slot's current occupant, then lets
// HotbarRepository make the change. Repository errors pass through and the handlers map them.
//
// No silent replacement (§22.2 #2, PRODUCT_RULES §3.1): a filled slot only changes when the
// caller names the target it expects there. Otherwise the answer is `slot_occupied` with what
// the slot really holds. The check and the write run in one synchronous call on the single
// writer connection, so nothing can change the slot in between (lesson 024).
//
// The guard is the expected target ID, not the slot's revision (user decision 2026-11-22): a
// slot that is cleared and filled again starts back at revision 1, so an old revision could
// match a different pin. A pin is a shortcut and never the project: nothing here writes to
// `projects`, and archiving or trashing a project leaves its pin in place.
import type { HotbarSlotConflict } from '../../common/contracts/ipc-result';
import type { HotbarSlotSummary, HotbarTarget } from '../../common/contracts/hotbar';
import { CommandError } from '../ipc/router';
import type { ActiveProfile } from '../profiles/active-profile';
import { type HotbarSlot, HotbarRepository } from '../storage/repositories/hotbar-repository';
import { ProjectRepository } from '../storage/repositories/project-repository';
import { RepositoryError } from '../storage/repositories/repository-support';
import { type World, WorldRepository } from '../storage/repositories/world-repository';
import type { ProjectService } from './project-service';

/** The one reason every hotbar change gives while its world is archived (F5, #59). */
export const ARCHIVED_WORLD_HOTBAR_REFUSAL =
  'This world is archived. Restore it before changing its hotbar.';

/** Fixed, user-safe text for `slot_occupied`. The occupant travels in `hotbar`. */
export const SLOT_OCCUPIED_MESSAGE = 'That hotbar slot holds something else.';

export const PINNED_ELSEWHERE_MESSAGE = 'That is already pinned to another hotbar slot.';

export const SLOT_EMPTY_MESSAGE = 'That hotbar slot is already empty.';

export const TRASHED_PROJECT_PIN_REFUSAL =
  'A project in the trash cannot be pinned. Restore it first.';

export class HotbarService {
  constructor(
    private readonly active: ActiveProfile,
    private readonly projects: ProjectService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The world's filled slots, by slot number. Works in an archived world (reads always do). */
  list(worldId: string): HotbarSlotSummary[] {
    this.world(worldId);
    const projects = new ProjectRepository(this.db(), this.now);
    return this.slots()
      .list(worldId)
      .map((slot) => this.summary(slot, projects));
  }

  /**
   * Pins a target to a slot. A filled slot is only changed when `replace.expectedTargetId`
   * names its current target; otherwise `slot_occupied` with the occupant, and nothing is
   * written. Pinning the target a slot already holds returns it unchanged.
   */
  assign(input: {
    readonly worldId: string;
    readonly slot: number;
    readonly target: HotbarTarget;
    readonly replace?: { readonly expectedTargetId: string } | undefined;
  }): HotbarSlotSummary {
    const world = this.mutableWorld(input.worldId);
    this.assertPinnable(world, input.target);
    const slots = this.slots();
    const projects = new ProjectRepository(this.db(), this.now);
    const current = slots.get(world.id, input.slot);

    if (current !== undefined && sameTarget(current.target, input.target)) {
      return this.summary(current, projects);
    }
    // Checked before the occupant, so the caller isn't asked to confirm a replace that would
    // be refused anyway. The repository and the UNIQUE indexes check again.
    const pinned = slots.findByTarget(world.id, input.target);
    if (pinned !== undefined) {
      throw new CommandError('already_exists', PINNED_ELSEWHERE_MESSAGE);
    }
    // An empty slot is simply filled, with or without `replace`: nothing would be lost.
    if (current === undefined) {
      return this.summary(slots.assign(world.id, input.slot, input.target), projects);
    }
    if (input.replace?.expectedTargetId !== current.target.id) {
      throw this.occupied(current, projects);
    }
    const replaced = slots.replace(world.id, input.slot, current.revision, input.target);
    return this.summary(replaced, projects);
  }

  /**
   * Empties a slot, only if it still holds `expectedTargetId`. The target is untouched, in any
   * status. Returns what the slot held, for undo (M2-8).
   */
  clear(input: {
    readonly worldId: string;
    readonly slot: number;
    readonly expectedTargetId: string;
  }): HotbarSlotSummary {
    const world = this.mutableWorld(input.worldId);
    const slots = this.slots();
    const projects = new ProjectRepository(this.db(), this.now);
    const current = slots.get(world.id, input.slot);
    if (current === undefined) throw new CommandError('not_found', SLOT_EMPTY_MESSAGE);
    if (current.target.id !== input.expectedTargetId) throw this.occupied(current, projects);
    return this.summary(slots.clear(world.id, input.slot, current.revision), projects);
  }

  /**
   * A project must be in this world and not trashed; an archived project may be pinned (user
   * decision 2026-11-22, as for placement). Services are checked against the fixed list by the
   * contract and again by the repository.
   */
  private assertPinnable(world: World, target: HotbarTarget): void {
    if (target.type !== 'project') return;
    // Same `not_found` for an unknown project, another world's and another profile's (ADR-0020).
    const project = this.projects.get(world.id, target.id);
    if (project.status === 'trashed') {
      throw new CommandError('invalid_transition', TRASHED_PROJECT_PIN_REFUSAL);
    }
  }

  // Asked for on every call, so a profile switch (M1-8) is picked up immediately.
  private db() {
    return this.active.current().db;
  }

  private slots(): HotbarRepository {
    return new HotbarRepository(this.db(), this.now);
  }

  private world(worldId: string): World {
    const world = new WorldRepository(this.db()).get(worldId);
    if (world === undefined) throw new RepositoryError('not_found', 'No world with that ID.');
    return world;
  }

  /** The world must exist and not be archived (F5, #59). */
  private mutableWorld(worldId: string): World {
    const world = this.world(worldId);
    if (world.archivedAt !== null) {
      throw new CommandError('invalid_transition', ARCHIVED_WORLD_HOTBAR_REFUSAL);
    }
    return world;
  }

  private occupied(current: HotbarSlot, projects: ProjectRepository): CommandError {
    const conflict: HotbarSlotConflict = {
      slot: current.slot,
      occupant: { target: current.target, projectStatus: statusOf(current, projects) },
    };
    return new CommandError('slot_occupied', SLOT_OCCUPIED_MESSAGE, undefined, {
      hotbar: conflict,
    });
  }

  private summary(slot: HotbarSlot, projects: ProjectRepository): HotbarSlotSummary {
    return {
      worldId: slot.worldId,
      slot: slot.slot,
      target: slot.target,
      projectStatus: statusOf(slot, projects),
      createdAt: slot.createdAt,
      updatedAt: slot.updatedAt,
      revision: slot.revision,
    };
  }
}

function sameTarget(a: HotbarTarget, b: HotbarTarget): boolean {
  return a.type === b.type && a.id === b.id;
}

function statusOf(
  slot: HotbarSlot,
  projects: ProjectRepository,
): HotbarSlotSummary['projectStatus'] {
  if (slot.target.type !== 'project') return null;
  // Scoped to the slot's world as well as the composite FK (#69 security L1): a pin can never
  // report another world's project, even if a later rebuild lost the FK.
  const project = projects.get(slot.target.id);
  return project?.worldId === slot.worldId ? project.status : null;
}
