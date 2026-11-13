// Opens a profile database: resolve the path, open, migrate, record the launch.
// Takes the userData folder as a plain string so it runs (and is tested) without Electron.
import { join } from 'node:path';

import { type Database, openDatabase } from './database';
import { migrate, type MigrationReport, readSchemaVersion } from './migrate';
import { MIGRATIONS } from './migrations';
import { type ProfileId, toProfileId } from './profiles/profile-id';
import { type AppLaunchRecord, AppMetaRepository } from './repositories/app-meta-repository';

export interface ProfilePaths {
  readonly profileDir: string;
  readonly databaseFile: string;
  readonly backupDir: string;
}

/**
 * DATA_MODEL §9.1 layout: `profiles/<profile-id>/app.sqlite`. The ID is checked again here
 * even though the type says it is valid: this is the one place that turns an ID into a path.
 */
export function profilePaths(userDataDir: string, profileId: ProfileId): ProfilePaths {
  const profileDir = join(userDataDir, 'profiles', toProfileId(profileId));
  return {
    profileDir,
    databaseFile: join(profileDir, 'app.sqlite'),
    backupDir: join(profileDir, 'backups'),
  };
}

export interface AppDatabase {
  readonly db: Database;
  readonly migration: MigrationReport;
  readonly launch: AppLaunchRecord;
}

/**
 * A profile that should have data has no database (or only a brand-new empty one). Creating
 * and using an empty one would look like lost data (OFFLINE_AND_RECOVERY §19), so startup
 * stops and reports it instead.
 */
export class ProfileDataMissingError extends Error {
  override readonly name = 'ProfileDataMissingError';
  constructor() {
    super('The profile has no database file.');
  }
}

export interface OpenAppDatabaseOptions {
  /**
   * The profile already has data. Opening still creates a file if it vanished at the last
   * moment (SQLite has no "don't create" flag), so an unmigrated (version 0) database is
   * refused with ProfileDataMissingError instead of being migrated and used.
   */
  readonly requireExisting?: boolean;
}

/** Opens and migrates a profile's database. On failure the connection is closed again. */
export async function openAppDatabase(
  userDataDir: string,
  profileId: ProfileId,
  options: OpenAppDatabaseOptions = {},
): Promise<AppDatabase> {
  const paths = profilePaths(userDataDir, profileId);
  const db = openDatabase(paths.databaseFile);
  try {
    if (options.requireExisting === true && readSchemaVersion(db) === 0) {
      throw new ProfileDataMissingError();
    }
    const migration = await migrate(db, MIGRATIONS, { backupDir: paths.backupDir });
    const launch = new AppMetaRepository(db).recordLaunch();
    return { db, migration, launch };
  } catch (error) {
    db.close();
    throw error;
  }
}
