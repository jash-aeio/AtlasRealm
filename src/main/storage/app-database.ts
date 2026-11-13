// Opens a profile database: resolve the path, open, migrate, record the launch.
// Takes the userData folder as a plain string so it runs (and is tested) without Electron.
import { join } from 'node:path';

import { type Database, openDatabase } from './database';
import { migrate, type MigrationReport } from './migrate';
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

/** Opens and migrates a profile's database. On failure the connection is closed again. */
export async function openAppDatabase(
  userDataDir: string,
  profileId: ProfileId,
): Promise<AppDatabase> {
  const paths = profilePaths(userDataDir, profileId);
  const db = openDatabase(paths.databaseFile);
  try {
    const migration = await migrate(db, MIGRATIONS, { backupDir: paths.backupDir });
    const launch = new AppMetaRepository(db).recordLaunch();
    return { db, migration, launch };
  } catch (error) {
    db.close();
    throw error;
  }
}
