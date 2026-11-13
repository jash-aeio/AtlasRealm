// Picks and opens the profile at startup (ADR-0014, ADR-0017):
// - index present: open the last-used profile;
// - no index, and the only profile data is the M0 `profiles/default/app.sqlite`: adopt it as
//   "Default" (keeps its DB and launch history);
// - no index and no profile data at all: create "Default" with a new UUID;
// - no index but other profile databases exist: stop (ProfilesIndexMissingError). Creating a
//   fresh profile would hide them, and guessing a new index is a recovery job (M7).
// The database is opened (and migrated) before a new index is written, so a failed first
// launch leaves no index behind and the next launch simply tries again.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  type AppDatabase,
  openAppDatabase,
  ProfileDataMissingError,
  profilePaths,
} from '../app-database';
import {
  LEGACY_PROFILE_ID,
  newProfileId,
  type ProfileId,
  ProfileIdSchema,
  toProfileId,
} from './profile-id';
import {
  PROFILES_INDEX_SCHEMA_VERSION,
  type ProfilesIndex,
  readProfilesIndex,
  removeStaleIndexTempFiles,
  writeProfilesIndex,
} from './profiles-index';

export const DEFAULT_PROFILE_NAME = 'Default';

/**
 * There is no index, but profile databases other than a lone M0 `default` exist (for example
 * the index was deleted or not restored). The app reports it and creates nothing.
 */
export class ProfilesIndexMissingError extends Error {
  override readonly name = 'ProfilesIndexMissingError';
  constructor() {
    super('The profiles index is missing, but profile data exists.');
  }
}

/** How this launch found its profile: from the index, adopted from M0, or newly created. */
export type StartupProfileSource = 'index' | 'adopted' | 'created';

export interface StartupProfile extends AppDatabase {
  readonly profileId: ProfileId;
  readonly displayName: string;
  readonly source: StartupProfileSource;
}

export async function openStartupProfile(userDataDir: string): Promise<StartupProfile> {
  removeStaleIndexTempFiles(userDataDir);
  // Throws ProfilesIndexCorruptError for an unusable index; that file is never replaced here.
  const read = readProfilesIndex(userDataDir);
  if (read.kind === 'ok') return openIndexedProfile(userDataDir, read.index);

  const found = existingProfileIds(userDataDir);
  const legacyFolder = existsSync(join(userDataDir, 'profiles', LEGACY_PROFILE_ID));
  const adopt = found.length === 1 && found[0] === LEGACY_PROFILE_ID;
  if (found.length > 0 && !adopt) throw new ProfilesIndexMissingError();
  // An M0 folder whose database is gone (maybe only backups/ is left) is not adopted silently.
  if (!adopt && legacyFolder) throw new ProfileDataMissingError();

  const profileId = adopt ? toProfileId(LEGACY_PROFILE_ID) : newProfileId();
  const opened = await openAppDatabase(userDataDir, profileId, { requireExisting: adopt });
  try {
    await writeProfilesIndex(userDataDir, firstIndex(profileId));
  } catch (error) {
    opened.db.close();
    throw error;
  }
  return {
    ...opened,
    profileId,
    displayName: DEFAULT_PROFILE_NAME,
    source: adopt ? 'adopted' : 'created',
  };
}

async function openIndexedProfile(
  userDataDir: string,
  index: ProfilesIndex,
): Promise<StartupProfile> {
  const profileId = index.lastUsedProfileId;
  // The schema guarantees the last-used ID is listed; find() is only for its display name.
  const entry = index.profiles.find((profile) => profile.id === profileId);
  if (entry === undefined) throw new Error('Validated profiles index lost its last-used entry.');
  // Checked first so a missing file usually isn't even created; requireExisting covers the
  // file vanishing between this check and the open.
  if (!existsSync(profilePaths(userDataDir, profileId).databaseFile)) {
    throw new ProfileDataMissingError();
  }
  const opened = await openAppDatabase(userDataDir, profileId, { requireExisting: true });
  return { ...opened, profileId, displayName: entry.displayName, source: 'index' };
}

/**
 * Profile folders that hold a database. Folders whose names aren't valid profile IDs are
 * ignored (and never turned into paths), as are folders without `app.sqlite`.
 */
function existingProfileIds(userDataDir: string): ProfileId[] {
  let names: string[];
  try {
    names = readdirSync(join(userDataDir, 'profiles'));
  } catch {
    return [];
  }
  return names
    .map((name) => ProfileIdSchema.safeParse(name))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data)
    .filter((id) => existsSync(profilePaths(userDataDir, id).databaseFile));
}

function firstIndex(profileId: ProfileId): ProfilesIndex {
  return {
    schemaVersion: PROFILES_INDEX_SCHEMA_VERSION,
    profiles: [{ id: profileId, displayName: DEFAULT_PROFILE_NAME }],
    lastUsedProfileId: profileId,
  };
}
