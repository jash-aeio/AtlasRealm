// `userData/profiles-index.json`: the minimal list of local profiles (DATA_MODEL §9.1).
// It holds IDs, display names, the last-used profile and a schema version, and nothing else:
// all real profile data lives in that profile's own database.
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { normalizeName } from '../repositories/repository-support';
import { ProfileIdSchema } from './profile-id';

export const PROFILES_INDEX_FILE = 'profiles-index.json';
export const PROFILES_INDEX_SCHEMA_VERSION = 1;

/** Same rules as every other display name (trimmed, 1–80 chars, no control characters). */
function isCleanName(value: string): boolean {
  try {
    return normalizeName(value, 'Profile name') === value;
  } catch {
    return false;
  }
}

const ProfileEntrySchema = z.strictObject({
  id: ProfileIdSchema,
  displayName: z.string().refine(isCleanName, 'Invalid profile name.'),
});

export const ProfilesIndexSchema = z
  .strictObject({
    schemaVersion: z.literal(PROFILES_INDEX_SCHEMA_VERSION),
    profiles: z.array(ProfileEntrySchema).min(1),
    lastUsedProfileId: ProfileIdSchema,
  })
  .superRefine((index, ctx) => {
    const ids = index.profiles.map((profile) => profile.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'Profile IDs must be unique.', input: ids });
    }
    if (!ids.includes(index.lastUsedProfileId)) {
      ctx.addIssue({
        code: 'custom',
        message: 'The last-used profile is not in the list.',
        input: index.lastUsedProfileId,
      });
    }
  });

export type ProfilesIndex = z.infer<typeof ProfilesIndexSchema>;
export type ProfileEntry = ProfilesIndex['profiles'][number];

/**
 * The index exists but can't be trusted. The app reports this and leaves the file exactly as
 * it is: replacing it would silently forget every profile except the one we'd recreate.
 */
export type ProfilesIndexProblem = 'unreadable' | 'invalid_json' | 'invalid_shape';

export class ProfilesIndexCorruptError extends Error {
  override readonly name = 'ProfilesIndexCorruptError';
  readonly reason: ProfilesIndexProblem;
  constructor(reason: ProfilesIndexProblem, options?: ErrorOptions) {
    super(`The profiles index could not be used (${reason}).`, options);
    this.reason = reason;
  }
}

export function profilesIndexPath(userDataDir: string): string {
  return join(userDataDir, PROFILES_INDEX_FILE);
}

export type ReadProfilesIndexResult =
  { readonly kind: 'missing' } | { readonly kind: 'ok'; readonly index: ProfilesIndex };

/** Reads and validates the index. Never writes, renames or deletes it. */
export function readProfilesIndex(userDataDir: string): ReadProfilesIndexResult {
  let raw: string;
  try {
    raw = readFileSync(profilesIndexPath(userDataDir), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    throw new ProfilesIndexCorruptError('unreadable', { cause: error });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new ProfilesIndexCorruptError('invalid_json', { cause: error });
  }
  const parsed = ProfilesIndexSchema.safeParse(json);
  if (!parsed.success)
    throw new ProfilesIndexCorruptError('invalid_shape', { cause: parsed.error });
  return { kind: 'ok', index: parsed.data };
}

/**
 * Writes the index atomically: the full content goes to a temp file in the same folder, is
 * flushed to disk, then renamed over the real file. A rename within one folder is
 * all-or-nothing, so a crash leaves either the old index or the new one, never a torn file.
 */
export function writeProfilesIndex(userDataDir: string, index: ProfilesIndex): void {
  // Validate on the way out too, so a bug can't write a file the next launch would refuse.
  const content = `${JSON.stringify(ProfilesIndexSchema.parse(index), null, 2)}\n`;
  const target = profilesIndexPath(userDataDir);
  const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    const fd = openSync(temp, 'wx'); // wx: fail rather than reuse an existing file
    try {
      writeSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, target);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}
