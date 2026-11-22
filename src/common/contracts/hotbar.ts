// IPC contracts for hotbar shortcuts (M2-4 #69, UI_SPEC §6.1–6.2, ADR-0026).
//
// Each world has ten slots. A slot points at a project or a service structure; it is a
// shortcut and never the thing itself (PRODUCT_RULES §3.1), so clearing a slot never changes
// its target. Filling a slot that already holds something is always an explicit choice: the
// caller names the occupant it expects in `replace`, or the command refuses with
// `slot_occupied` and the real occupant (§22.2 #2). Every call names the world (ADR-0020).
import { z } from 'zod';

import { SERVICE_KINDS } from '../world/service-kinds';
import { Revision, Timestamp } from './display-name';
import type { HotbarSlotConflict } from './ipc-result';
import { ProjectId, ProjectStatus } from './project';
import { WorldId } from './world';

/** Slots per world. Matches migration 5 and HotbarRepository. */
export const HOTBAR_SLOT_COUNT = 10;

/** 0-9. Slot 0 is key `1`, slot 8 is key `9`, slot 9 is key `0` (UI_SPEC §6.1). */
export const HotbarSlotIndex = z
  .int()
  .min(0)
  .max(HOTBAR_SLOT_COUNT - 1);

/** A project of this world, or one of the fixed sidebar services. Anything else is refused. */
export const HotbarTarget = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('project'), id: ProjectId }),
  z.strictObject({ type: z.literal('service'), id: z.enum(SERVICE_KINDS) }),
]);
export type HotbarTarget = z.infer<typeof HotbarTarget>;

/**
 * The ID of the target the caller believes is in the slot. Project IDs are UUIDs and service
 * kinds are fixed slugs, so the ID alone says which target it is.
 */
export const HotbarExpectedTargetId = z.union([ProjectId, z.enum(SERVICE_KINDS)]);

export const HotbarSlotSummary = z.strictObject({
  worldId: WorldId,
  slot: HotbarSlotIndex,
  target: HotbarTarget,
  /**
   * The pinned project's status, so an archived or trashed project's pin can be shown as such.
   * The pin stays when the project is archived or trashed. null for a service.
   */
  projectStatus: ProjectStatus.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  revision: Revision,
});
export type HotbarSlotSummary = z.infer<typeof HotbarSlotSummary>;

/**
 * The `hotbar` detail of a `slot_occupied` error. Error replies skip the command's output
 * schema, so the router parses this instead of copying it (#69 security L2). A plain (not
 * strict) object: anything else a service attached is dropped, not passed on.
 */
export const HotbarSlotConflictDetails = z.object({
  slot: HotbarSlotIndex,
  occupant: z.object({
    target: z.discriminatedUnion('type', [
      z.object({ type: z.literal('project'), id: ProjectId }),
      z.object({ type: z.literal('service'), id: z.enum(SERVICE_KINDS) }),
    ]),
    projectStatus: ProjectStatus.nullable(),
  }),
}) satisfies z.ZodType<HotbarSlotConflict>;

export const HotbarSlotOutput = z.strictObject({ slot: HotbarSlotSummary });
export type HotbarSlotOutput = z.infer<typeof HotbarSlotOutput>;

// ---- hotbar.list -----------------------------------------------------------------------

/** The world's filled slots, by slot number. Empty slots are absent. */
export const HotbarListInput = z.strictObject({ worldId: WorldId });
export type HotbarListInput = z.infer<typeof HotbarListInput>;

export const HotbarListOutput = z.strictObject({
  slots: z.array(HotbarSlotSummary).max(HOTBAR_SLOT_COUNT),
});
export type HotbarListOutput = z.infer<typeof HotbarListOutput>;

// ---- hotbar.assign ---------------------------------------------------------------------

/**
 * Pins a target to a slot. Without `replace` the slot must be empty (or already hold this
 * target). With `replace`, the slot's current target must have `expectedTargetId`; an empty
 * slot is simply filled, since nothing would be lost.
 */
export const HotbarAssignInput = z.strictObject({
  worldId: WorldId,
  slot: HotbarSlotIndex,
  target: HotbarTarget,
  replace: z.strictObject({ expectedTargetId: HotbarExpectedTargetId }).optional(),
});
export type HotbarAssignInput = z.infer<typeof HotbarAssignInput>;

// ---- hotbar.clear ----------------------------------------------------------------------

/**
 * Empties a slot, only if it still holds `expectedTargetId`. The target itself is untouched.
 * Returns what the slot held, for undo (M2-8).
 */
export const HotbarClearInput = z.strictObject({
  worldId: WorldId,
  slot: HotbarSlotIndex,
  expectedTargetId: HotbarExpectedTargetId,
});
export type HotbarClearInput = z.infer<typeof HotbarClearInput>;
