// Finds the app's profile database from outside the app, the way startup does: through
// userData/profiles-index.json. A fresh install's profile has a random UUID (ADR-0017), so
// tests can't hard-code `profiles/default/`.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROFILE_ID = /^(?:default|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/**
 * Path of the last-used profile's app.sqlite, or undefined while there is no index yet. The
 * app writes the index only after that database has been opened and migrated.
 */
export function lastUsedDatabaseFile(userData: string): string | undefined {
  const indexFile = join(userData, 'profiles-index.json');
  if (!existsSync(indexFile)) return undefined;
  const index = JSON.parse(readFileSync(indexFile, 'utf8')) as { lastUsedProfileId?: unknown };
  const id = index.lastUsedProfileId;
  if (typeof id !== 'string' || !PROFILE_ID.test(id)) {
    throw new Error('profiles-index.json has no valid lastUsedProfileId');
  }
  return join(userData, 'profiles', id, 'app.sqlite');
}

/** True once the app has written any profile data (the index or a profile folder). */
export function hasProfileData(userData: string): boolean {
  return (
    existsSync(join(userData, 'profiles-index.json')) || existsSync(join(userData, 'profiles'))
  );
}

/** Like lastUsedDatabaseFile, but fails the test when the app hasn't created one. */
export function requireDatabaseFile(userData: string): string {
  const file = lastUsedDatabaseFile(userData);
  if (file === undefined || !existsSync(file)) throw new Error('no profile database was created');
  return file;
}
