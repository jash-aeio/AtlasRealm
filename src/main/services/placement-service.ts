// Application service for building placements (M2-3 #68, ADR-0025). The `placement.*` IPC
// handlers call this; it checks the world, the project and the rules, then lets
// PlacementRepository make the change. Repository errors pass through and the handlers map them.
//
// The handler decides, not the preview (UI_SPEC §17.2): every create and move runs the shared
// placement rules (M2-1) again, against placements read from the database in the same
// synchronous call as the write, with footprints from the trusted manifest. Nothing can slip in
// between the check and the write on the single writer connection (lesson 024).
//
// A placement represents a project and is never the project (PRODUCT_RULES §3.1): nothing here
// writes to `projects`. Archive and trash remove the building from ProjectService, inside the
// same transaction as the status change.
import type { PlacementRefusal } from '../../common/contracts/ipc-result';
import type { PlacementSummary } from '../../common/contracts/placement';
import {
  checkPlacement,
  type OccupiedPlacement,
  type PlacementRotation,
  type PlacementWorld,
} from '../../common/world/placement-rules';
import { CommandError } from '../ipc/router';
import type { ActiveProfile } from '../profiles/active-profile';
import { type Placement, PlacementRepository } from '../storage/repositories/placement-repository';
import { ProjectRepository } from '../storage/repositories/project-repository';
import { RepositoryError } from '../storage/repositories/repository-support';
import { type World, WorldRepository } from '../storage/repositories/world-repository';
import type { BuildingAppearances } from '../world/building-appearances';
import type { ProjectService } from './project-service';

/** The one reason every placement change gives while its world is archived (F5, #59). */
export const ARCHIVED_WORLD_PLACEMENT_REFUSAL =
  'This world is archived. Restore it before changing its buildings.';

/** Why move and remove refuse a service structure for now (ADR-0025). */
export const SERVICE_BUILDING_REFUSAL = "Service buildings can't be changed yet.";

/** Fixed, user-safe text per rules answer. The details travel in `placement`. */
export const PLACEMENT_REFUSAL_MESSAGES: Record<PlacementRefusal['reason'], string> = {
  out_of_bounds: 'The building does not fit inside the world there.',
  reserved: 'Those tiles are reserved.',
  overlaps: 'Another building is in the way.',
};

interface Spot {
  readonly tileX: number;
  readonly tileY: number;
  readonly rotation: PlacementRotation;
}

export class PlacementService {
  constructor(
    private readonly active: ActiveProfile,
    private readonly projects: ProjectService,
    private readonly appearances: BuildingAppearances,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Every building in a world, oldest first. Works in an archived world (reads always do). */
  list(worldId: string): PlacementSummary[] {
    this.world(worldId);
    const projects = new ProjectRepository(this.db(), this.now);
    return this.placements()
      .listByWorld(worldId)
      .map((placement) => this.summary(placement, projects));
  }

  /**
   * Places a project's building with the default appearance. The project must be in this
   * world and not trashed; an archived project may be placed (user decision 2026-11-21).
   */
  create(input: { readonly worldId: string; readonly projectId: string } & Spot): PlacementSummary {
    const world = this.mutableWorld(input.worldId);
    // Same `not_found` for an unknown project, another world's and another profile's (ADR-0020).
    const project = this.projects.get(input.worldId, input.projectId);
    if (project.status === 'trashed') {
      throw new CommandError(
        'invalid_transition',
        'A project in the trash cannot be placed. Restore it first.',
      );
    }
    const placements = this.placements();
    // Checked before the rules, so "already placed" isn't reported as overlapping itself. The
    // repository and the UNIQUE index check again.
    if (placements.findByProject(project.id) !== undefined) {
      throw new CommandError(
        'already_exists',
        'This project already has a building. Move it instead.',
      );
    }
    const appearanceId = this.appearances.defaultId;
    this.check(world, placements, { ...input, appearanceId });
    const created = placements.create({
      worldId: world.id,
      target: { type: 'project', id: project.id },
      appearanceId,
      tileX: input.tileX,
      tileY: input.tileY,
      rotation: input.rotation,
    });
    return this.summary(created, new ProjectRepository(this.db(), this.now));
  }

  /** Moves or turns a building. Its target and appearance stay; the project is untouched. */
  move(
    input: {
      readonly worldId: string;
      readonly placementId: string;
      readonly expectedRevision: number;
    } & Spot,
  ): PlacementSummary {
    const world = this.mutableWorld(input.worldId);
    const placements = this.placements();
    const placement = this.projectBuilding(placements, world, input.placementId);
    // A stale caller first hears that its view is out of date, before any rules answer
    // computed from tiles it hasn't seen. The guarded write checks the revision again.
    if (placement.revision !== input.expectedRevision) {
      throw new RepositoryError('revision_conflict', 'Building changed.', placement.revision);
    }
    this.check(world, placements, {
      ...input,
      appearanceId: placement.appearanceId,
      placementId: placement.id,
    });
    const moved = placements.move(world.id, placement.id, input.expectedRevision, {
      tileX: input.tileX,
      tileY: input.tileY,
      rotation: input.rotation,
    });
    return this.summary(moved, new ProjectRepository(this.db(), this.now));
  }

  /**
   * Removes a building. Its project becomes unplaced and stays readable (§22.2 #3). Returns
   * what was removed, for undo (M2-8).
   */
  remove(input: {
    readonly worldId: string;
    readonly placementId: string;
    readonly expectedRevision: number;
  }): PlacementSummary {
    const world = this.mutableWorld(input.worldId);
    const placements = this.placements();
    this.projectBuilding(placements, world, input.placementId);
    const projects = new ProjectRepository(this.db(), this.now);
    const removed = placements.remove(world.id, input.placementId, input.expectedRevision);
    return this.summary(removed, projects);
  }

  /**
   * The placement, which must be in this world and stand for a project. Service structures
   * can't be moved or removed yet (default deny, user decision 2026-11-21, #68 security L2):
   * nothing can put one back over IPC. The issue that seeds them decides how they may change.
   */
  private projectBuilding(placements: PlacementRepository, world: World, id: string): Placement {
    const placement = placements.get(id);
    if (placement?.worldId !== world.id) {
      throw new RepositoryError('not_found', 'No building with that ID in this world.');
    }
    if (placement.target.type !== 'project') {
      throw new CommandError('invalid_transition', SERVICE_BUILDING_REFUSAL);
    }
    return placement;
  }

  // Asked for on every call, so a profile switch (M1-8) is picked up immediately.
  private db() {
    return this.active.current().db;
  }

  private placements(): PlacementRepository {
    return new PlacementRepository(this.db(), this.now);
  }

  private world(worldId: string): World {
    const world = new WorldRepository(this.db()).get(worldId);
    if (world === undefined) throw new RepositoryError('not_found', 'No world with that ID.');
    return world;
  }

  /** The world must exist and not be archived (F5, #59; #67 security handoff). */
  private mutableWorld(worldId: string): World {
    const world = this.world(worldId);
    if (world.archivedAt !== null) {
      throw new CommandError('invalid_transition', ARCHIVED_WORLD_PLACEMENT_REFUSAL);
    }
    return world;
  }

  /**
   * Runs the shared rules against this world's stored buildings. The candidate's footprint is
   * looked up from its appearance in the manifest, never taken from the request.
   */
  private check(
    world: World,
    placements: PlacementRepository,
    candidate: Spot & { readonly appearanceId: string; readonly placementId?: string },
  ): void {
    const rulesWorld: PlacementWorld = {
      gridWidth: world.gridWidth,
      gridHeight: world.gridHeight,
      // Nothing defines reserved areas yet (no spec entry, no table); see placement-rules.ts.
      reserved: [],
    };
    const occupied: OccupiedPlacement[] = placements.listByWorld(world.id).map((other) => ({
      id: other.id,
      tileX: other.tileX,
      tileY: other.tileY,
      rotation: other.rotation,
      footprint: this.appearances.footprintOf(other.appearanceId),
    }));
    const result = checkPlacement(rulesWorld, occupied, {
      tileX: candidate.tileX,
      tileY: candidate.tileY,
      rotation: candidate.rotation,
      footprint: this.appearances.footprintOf(candidate.appearanceId),
      ...(candidate.placementId === undefined ? {} : { placementId: candidate.placementId }),
    });
    switch (result.kind) {
      case 'ok':
        return;
      case 'invalid_rotation':
        // The contract only lets quarter turns through, so this is a bug, not user input.
        throw new CommandError('invalid_payload', 'Rotation must be 0, 90, 180 or 270.');
      case 'out_of_bounds':
      case 'reserved':
        throw this.blocked({ reason: result.kind, blockingIds: [] });
      case 'overlaps':
        throw this.blocked({ reason: 'overlaps', blockingIds: result.blockingIds });
    }
  }

  private blocked(refusal: PlacementRefusal): CommandError {
    return new CommandError(
      'placement_blocked',
      PLACEMENT_REFUSAL_MESSAGES[refusal.reason],
      undefined,
      { placement: refusal },
    );
  }

  private summary(placement: Placement, projects: ProjectRepository): PlacementSummary {
    const project =
      placement.target.type === 'project' ? projects.get(placement.target.id) : undefined;
    return {
      id: placement.id,
      worldId: placement.worldId,
      target: placement.target,
      projectStatus: project?.status ?? null,
      projectName: project?.name ?? null,
      appearanceId: placement.appearanceId,
      footprint: this.appearances.footprintOf(placement.appearanceId),
      tileX: placement.tileX,
      tileY: placement.tileY,
      rotation: placement.rotation,
      createdAt: placement.createdAt,
      updatedAt: placement.updatedAt,
      revision: placement.revision,
    };
  }
}
