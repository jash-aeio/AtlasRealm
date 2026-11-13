// Picks and opens the profile at startup (ADR-0014, ADR-0017):
// - index present: open the last-used profile;
// - no index, M0 folder `profiles/default/` present: adopt it as "Default" (keeps its DB);
// - no index, no folder: create "Default" with a new UUID.
// The database is opened (and migrated) before a new index is written, so a failed first
// launch leaves no index behind and the next launch simply tries again.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { type AppDatabase, openAppDatabase, profilePaths } from '../app-database';
import { LEGACY_PROFILE_ID, newProfileId, type ProfileId, toProfileId } from './profile-id';
import {
  PROFILES_INDEX_SCHEMA_VERSION,
  type ProfilesIndex,
  readProfilesIndex,
  writeProfilesIndex,
} from './profiles-index';

export const DEFAULT_PROFILE_NAME = 'Default';

/**
 * The index lists a profile whose database is gone. Creating an empty one would look like
 * lost data (OFFLINE_AND_RECOVERY §19), so startup stops and reports it instead.
 */
export class ProfileDataMissingError extends Error {
  override readonly name = 'ProfileDataMissingError';
  constructor() {
    super('The last-used profile has no database file.');
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
  // Throws ProfilesIndexCorruptError for an unusable index; that file is never replaced here.
  const read = readProfilesIndex(userDataDir);
  if (read.kind === 'ok') return openIndexedProfile(userDataDir, read.index);

  const legacyId = toProfileId(LEGACY_PROFILE_ID);
  const adopt = existsSync(join(userDataDir, 'profiles', LEGACY_PROFILE_ID));
  const profileId = adopt ? legacyId : newProfileId();
  const opened = await openAppDatabase(userDataDir, profileId);
  try {
    writeProfilesIndex(userDataDir, firstIndex(profileId));
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
  if (!existsSync(profilePaths(userDataDir, profileId).databaseFile)) {
    throw new ProfileDataMissingError();
  }
  const opened = await openAppDatabase(userDataDir, profileId);
  return { ...opened, profileId, displayName: entry.displayName, source: 'index' };
}

function firstIndex(profileId: ProfileId): ProfilesIndex {
  return {
    schemaVersion: PROFILES_INDEX_SCHEMA_VERSION,
    profiles: [{ id: profileId, displayName: DEFAULT_PROFILE_NAME }],
    lastUsedProfileId: profileId,
  };
}
