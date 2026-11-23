// IPC contracts for user-made links between projects (M2-11 #76, ADR-0029, GRAPH_MODEL §30.4).
//
// A link is descriptive only: it never changes permissions, scheduling or files. Every type is
// directed, and the source → target order is the direction, so A → B and B → A are different
// links. Both ends must be projects of the named world (ADR-0020).
import { z } from 'zod';

import { Revision, Timestamp } from './display-name';
import { ProjectId } from './project';
import { WorldId } from './world';

/**
 * At most this many links per world, hidden links of trashed projects included, so the graph
 * query stays fast on the main process (user decision 2026-11-23, #76 security review).
 */
export const MAX_RELATIONS_PER_WORLD = 5000;

/** The Project Relationships preset's verbs (§30.3). Matches migration 6's CHECK. */
export const RELATION_TYPES = ['depends_on', 'supports', 'references'] as const;
export const RelationType = z.enum(RELATION_TYPES);
export type RelationType = z.infer<typeof RelationType>;

/** Who made the link. Only `user` exists so far (parsed, execution, ai_proposed come later). */
export const RELATION_ORIGINS = ['user'] as const;
export const RelationOrigin = z.enum(RELATION_ORIGINS);
export type RelationOrigin = z.infer<typeof RelationOrigin>;

export const CONFIRMATION_STATES = ['proposed', 'confirmed', 'rejected'] as const;
export const ConfirmationState = z.enum(CONFIRMATION_STATES);
export type ConfirmationState = z.infer<typeof ConfirmationState>;

/** Lowercase UUID, like every other app-generated ID. */
export const RelationId = WorldId;

export const RelationSummary = z.strictObject({
  id: RelationId,
  worldId: WorldId,
  sourceProjectId: ProjectId,
  targetProjectId: ProjectId,
  type: RelationType,
  origin: RelationOrigin,
  confirmationState: ConfirmationState,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  revision: Revision,
});
export type RelationSummary = z.infer<typeof RelationSummary>;

export const RelationOutput = z.strictObject({ relation: RelationSummary });
export type RelationOutput = z.infer<typeof RelationOutput>;

// ---- relation.create -------------------------------------------------------------------

/**
 * Links `sourceProjectId` → `targetProjectId`. Both must be projects of `worldId`, not trashed
 * (archived is fine). A self-link is refused here; a duplicate of the same source, target and
 * type is `already_exists`.
 */
export const RelationCreateInput = z
  .strictObject({
    worldId: WorldId,
    sourceProjectId: ProjectId,
    targetProjectId: ProjectId,
    type: RelationType,
  })
  .refine((input) => input.sourceProjectId !== input.targetProjectId, {
    message: 'A project cannot be linked to itself.',
    path: ['targetProjectId'],
  });
export type RelationCreateInput = z.infer<typeof RelationCreateInput>;

// ---- relation.remove -------------------------------------------------------------------

/**
 * Removes the link only, if it still has `expectedRevision`; both projects are untouched
 * (GRAPH_MODEL §30.5). Returns the removed link, for undo.
 */
export const RelationRemoveInput = z.strictObject({
  worldId: WorldId,
  relationId: RelationId,
  expectedRevision: Revision,
});
export type RelationRemoveInput = z.infer<typeof RelationRemoveInput>;
