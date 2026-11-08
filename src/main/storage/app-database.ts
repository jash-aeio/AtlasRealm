// Opens the profile database at startup: resolve the path, open, migrate, record the launch.
// Takes the userData folder as a plain string so it runs (and is tested) without Electron.
import { join } from 'node:path';

import { type Database, openDatabase } from './database';
import { migrate, type MigrationReport } from './migrate';
import { MIGRATIONS } from './migrations';
import { type AppLaunchRecord, AppMetaRepository } from './repositories/app-meta-repository';

/**
 * Profile folder name until real profiles exist (DATA_MODEL §9.1 layout:
 * `profiles/<profile-id>/app.sqlite`). A stable key, never a display name.
 */
export const DEFAULT_PROFILE_ID = 'default';

export interface ProfilePaths {
  readonly profileDir: string;
  readonly databaseFile: string;
  readonly backupDir: string;
}

export function profilePaths(userDataDir: string, profileId = DEFAULT_PROFILE_ID): ProfilePaths {
  const profileDir = join(userDataDir, 'profiles', profileId);
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

/** Opens and migrates the profile database. On failure the connection is closed again. */
export async function openAppDatabase(userDataDir: string): Promise<AppDatabase> {
  const paths = profilePaths(userDataDir);
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
