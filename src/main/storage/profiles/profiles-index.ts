// `userData/profiles-index.json`: the minimal list of local profiles (DATA_MODEL §9.1).
// It holds IDs, display names, the last-used profile and a schema version, and nothing else:
// all real profile data lives in that profile's own database.
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

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
 * The index exists but can't be used. The app reports this and leaves the file exactly as
 * it is: replacing it would silently forget every profile except the one we'd recreate.
 * `newer_version` means a newer app wrote it (for example after a downgrade); it is not damaged.
 */
export type ProfilesIndexProblem =
  'unreadable' | 'invalid_json' | 'invalid_shape' | 'newer_version';

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
  if (isNewerVersion(json)) throw new ProfilesIndexCorruptError('newer_version');
  const parsed = ProfilesIndexSchema.safeParse(json);
  if (!parsed.success)
    throw new ProfilesIndexCorruptError('invalid_shape', { cause: parsed.error });
  return { kind: 'ok', index: parsed.data };
}

function isNewerVersion(json: unknown): boolean {
  if (typeof json !== 'object' || json === null || !('schemaVersion' in json)) return false;
  const version = json.schemaVersion;
  return Number.isSafeInteger(version) && (version as number) > PROFILES_INDEX_SCHEMA_VERSION;
}

/** Temp files are `profiles-index.json.<12 hex>.tmp`, next to the index. */
const TEMP_FILE = /^profiles-index\.json\.[0-9a-f]{12}\.tmp$/;

/**
 * Removes temp files left by a write that crashed before its rename. Only exact temp-file
 * names are touched; the index itself is never deleted. Best effort: failures are ignored.
 */
export function removeStaleIndexTempFiles(userDataDir: string): void {
  let names: string[];
  try {
    names = readdirSync(userDataDir);
  } catch {
    return;
  }
  for (const name of names.filter((entry) => TEMP_FILE.test(entry))) {
    try {
      rmSync(join(userDataDir, name), { force: true });
    } catch {
      // A locked leftover is harmless; the next start tries again.
    }
  }
}

/** Windows errors while antivirus or the search indexer briefly holds the target open. */
const TRANSIENT_RENAME_ERRORS = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_ATTEMPTS = 5;
const RENAME_RETRY_MS = 100;

/**
 * Writes the index atomically: the full content goes to a temp file in the same folder, is
 * flushed to disk, then renamed over the real file. A rename within one folder is
 * all-or-nothing, so a crash leaves either the old index or the new one, never a torn file.
 * On Windows a rename can fail briefly while another program has the file open, so it is
 * retried a few times (about half a second in all).
 */
export async function writeProfilesIndex(userDataDir: string, index: ProfilesIndex): Promise<void> {
  // Validate on the way out too, so a bug can't write a file the next launch would refuse.
  const content = `${JSON.stringify(ProfilesIndexSchema.parse(index), null, 2)}\n`;
  const target = profilesIndexPath(userDataDir);
  const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    const file = await open(temp, 'wx'); // wx: fail rather than reuse an existing file
    try {
      await file.writeFile(content, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await renameWithRetry(temp, target);
  } catch (error) {
    // Cleanup must never replace the real error in the log.
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (attempt >= RENAME_ATTEMPTS || !TRANSIENT_RENAME_ERRORS.has(code)) throw error;
      await delay(RENAME_RETRY_MS);
    }
  }
}
