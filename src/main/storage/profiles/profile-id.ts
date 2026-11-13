// Profile IDs are the only thing ever used to build a profile folder path (ADR-0014), so this
// module is the single gate between untrusted text (the index file, later IPC input) and paths.
import { randomUUID } from 'node:crypto';

import { z } from 'zod';

/**
 * The M0 placeholder folder `profiles/default/`, adopted as the profile "Default" (ADR-0014).
 * A permanently allowed legacy ID; new profiles always get a UUID (ADR-0017).
 */
export const LEGACY_PROFILE_ID = 'default';

/**
 * `default` or a lowercase UUID. Both contain only `[0-9a-z-]`, so a valid ID can never hold
 * a path separator, `..`, a drive letter or a reserved Windows name.
 */
export const PROFILE_ID_PATTERN =
  /^(?:default|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/**
 * A branded string: TypeScript only accepts a `ProfileId` that came out of this schema (or
 * `toProfileId`), so a raw string from a file can't reach a path builder by accident.
 */
export const ProfileIdSchema = z.string().regex(PROFILE_ID_PATTERN).brand<'ProfileId'>();
export type ProfileId = z.infer<typeof ProfileIdSchema>;

export class InvalidProfileIdError extends Error {
  override readonly name = 'InvalidProfileIdError';
  constructor() {
    // The rejected value is left out on purpose: it is untrusted and could be anything.
    super('Profile ID must be "default" or a lowercase UUID.');
  }
}

/** Validates a profile ID at runtime. Throws InvalidProfileIdError when it doesn't match. */
export function toProfileId(value: unknown): ProfileId {
  const parsed = ProfileIdSchema.safeParse(value);
  if (!parsed.success) throw new InvalidProfileIdError();
  return parsed.data;
}

/** A fresh, collision-resistant ID for a new profile (DATA_MODEL §9.2). */
export function newProfileId(): ProfileId {
  return toProfileId(randomUUID());
}
