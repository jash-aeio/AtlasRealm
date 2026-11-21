// IPC contracts for building placements (M2-3 #68, ARCHITECTURE §16.1, ADR-0025).
//
// A placement is where a project's building stands in a world. It represents the project and is
// never the project (PRODUCT_RULES §3.1): removing it leaves the project untouched.
// Every call names the world, like the project commands (ADR-0020). The handler runs the shared
// placement rules (M2-1) again on placements it reads itself; the preview is only a hint.
// No footprint or appearance is ever taken from the renderer: the main process looks the
// footprint up in the bundled asset manifest (#66 security L2).
import { z } from 'zod';

import { PLACEMENT_ROTATIONS } from '../world/placement-rules';
import { SERVICE_KINDS } from '../world/service-kinds';
import { Revision, Timestamp } from './display-name';
import { MAX_PROJECTS_PER_WORLD, ProjectId, ProjectStatus } from './project';
import { WorldId } from './world';

/** The largest tile index any world can have (grid max 256). Matches migration 5. */
export const PLACEMENT_TILE_MAX = 255;

/** A world holds at most one building per project, plus one per service structure. */
export const MAX_PLACEMENTS_PER_WORLD = MAX_PROJECTS_PER_WORLD + SERVICE_KINDS.length;

/** Lowercase UUID, the only form the app generates. */
export const PlacementId = WorldId;

/**
 * A tile index. Whether the building fits inside *this* world is the placement rules' question,
 * answered as `placement_blocked` / `out_of_bounds`.
 */
export const PlacementTile = z.int().min(0).max(PLACEMENT_TILE_MAX);

/** Quarter turns only, checked here before any rule runs (#66 security L1). */
export const PlacementRotation = z.literal(PLACEMENT_ROTATIONS);

export const PlacementTarget = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('project'), id: ProjectId }),
  z.strictObject({ type: z.literal('service'), id: z.enum(SERVICE_KINDS) }),
]);

export const PlacementSummary = z.strictObject({
  id: PlacementId,
  worldId: WorldId,
  target: PlacementTarget,
  /**
   * The project's status, so the world can draw an archived project's building differently
   * (user decision 2026-11-21). null for a service structure.
   */
  projectStatus: ProjectStatus.nullable(),
  // Plain bounded string on output: one row with unusual stored text must not fail the list.
  appearanceId: z.string().max(100),
  /**
   * The tiles it covers before rotation, from the manifest. An appearance that no longer
   * resolves reports the fail-closed 4×4 the collision checks use.
   */
  footprint: z.strictObject({
    columns: z.int().min(1).max(16),
    rows: z.int().min(1).max(16),
  }),
  tileX: PlacementTile,
  tileY: PlacementTile,
  rotation: PlacementRotation,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  revision: Revision,
});
export type PlacementSummary = z.infer<typeof PlacementSummary>;

export const PlacementOutput = z.strictObject({ placement: PlacementSummary });
export type PlacementOutput = z.infer<typeof PlacementOutput>;

/** Where the building should stand: anchor tile (north corner, ADR-0024) and rotation. */
const Spot = { tileX: PlacementTile, tileY: PlacementTile, rotation: PlacementRotation } as const;
/** A change to one placement, based on the revision the caller last read. */
const PlacementChange = {
  worldId: WorldId,
  placementId: PlacementId,
  expectedRevision: Revision,
} as const;

// ---- placement.list --------------------------------------------------------------------

/** Every building in one world, oldest first. Bounded by MAX_PLACEMENTS_PER_WORLD, not paged. */
export const PlacementListInput = z.strictObject({ worldId: WorldId });
export type PlacementListInput = z.infer<typeof PlacementListInput>;

export const PlacementListOutput = z.strictObject({
  placements: z.array(PlacementSummary).max(MAX_PLACEMENTS_PER_WORLD),
});
export type PlacementListOutput = z.infer<typeof PlacementListOutput>;

// ---- placement.create ------------------------------------------------------------------

/** Places a project's building. The appearance is the bundled default (ADR-0025). */
export const PlacementCreateInput = z.strictObject({
  worldId: WorldId,
  projectId: ProjectId,
  ...Spot,
});
export type PlacementCreateInput = z.infer<typeof PlacementCreateInput>;

// ---- placement.move --------------------------------------------------------------------

/** Moves or turns a building. The project's ID, name and files never change (§22.2 #4). */
export const PlacementMoveInput = z.strictObject({ ...PlacementChange, ...Spot });
export type PlacementMoveInput = z.infer<typeof PlacementMoveInput>;

// ---- placement.remove ------------------------------------------------------------------

/** Removes a building. The project becomes unplaced and stays readable (§22.2 #3). */
export const PlacementRemoveInput = z.strictObject(PlacementChange);
export type PlacementRemoveInput = z.infer<typeof PlacementRemoveInput>;
