// IPC contracts for user-made links between projects (M2-11 #76, ADR-0029, GRAPH_MODEL §30.4).
//
// A link is descriptive only: it never changes permissions, scheduling or files. Every type is
// directed, and the source → target order is the direction, so A → B and B → A are different
// links. Both ends must be projects of the named world (ADR-0020).
import { z } from 'zod';

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
