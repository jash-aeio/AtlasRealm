// IPC contracts for worlds (M1-6 #33, ARCHITECTURE §16.1). Worlds belong to the active
// profile's database, so a world ID from another profile is simply unknown here (`not_found`).
import { z } from 'zod';

import { DisplayName, Revision, Timestamp } from './display-name';

/** At most this many worlds (archived ones included) per profile, so lists stay bounded. */
export const MAX_WORLDS = 100;

/**
 * Bundled world themes (ADR-0019). Only themes the app can draw are accepted on input; new
 * themes extend this list.
 */
export const WorldTheme = z.enum(['meadow']);
export type WorldTheme = z.infer<typeof WorldTheme>;
export const DEFAULT_WORLD_THEME: WorldTheme = 'meadow';

/** Lowercase UUID, the only form the app generates. */
export const WorldId = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

export const WorldSummary = z.strictObject({
  id: WorldId,
  name: DisplayName,
  // A plain slug on output: one world with an unknown theme must not fail the whole list.
  themeId: z
    .string()
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  gridWidth: z.int().min(16).max(256),
  gridHeight: z.int().min(16).max(256),
  archivedAt: Timestamp.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  revision: Revision,
});
export type WorldSummary = z.infer<typeof WorldSummary>;

export const WorldOutput = z.strictObject({ world: WorldSummary });
export type WorldOutput = z.infer<typeof WorldOutput>;

// ---- world.create ----------------------------------------------------------------------

export const WorldCreateInput = z.strictObject({
  name: DisplayName,
  themeId: WorldTheme.default(DEFAULT_WORLD_THEME),
});
export type WorldCreateInput = z.input<typeof WorldCreateInput>;

// ---- world.list ------------------------------------------------------------------------

/** No payload lists active worlds; `{ includeArchived: true }` adds archived ones. */
export const WorldListInput = z.strictObject({ includeArchived: z.boolean() }).optional();
export type WorldListInput = z.input<typeof WorldListInput>;

export const WorldListOutput = z.strictObject({
  worlds: z.array(WorldSummary).max(MAX_WORLDS),
});
export type WorldListOutput = z.infer<typeof WorldListOutput>;

// ---- world.rename ----------------------------------------------------------------------

export const WorldRenameInput = z.strictObject({
  worldId: WorldId,
  expectedRevision: Revision,
  name: DisplayName,
});
export type WorldRenameInput = z.infer<typeof WorldRenameInput>;
