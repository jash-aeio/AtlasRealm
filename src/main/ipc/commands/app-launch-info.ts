import { LaunchInfoInput, LaunchInfoOutput } from '../../../common/contracts/app-launch-info';
import { Channels } from '../../../common/contracts/channels';
import type { Database } from '../../storage/database';
import { readSchemaVersion } from '../../storage/migrate';
import { AppMetaRepository } from '../../storage/repositories/app-meta-repository';
import type { CommandDefinition, CommandHandler } from '../router';

export const appLaunchInfoCommand = {
  channel: Channels.appLaunchInfo,
  input: LaunchInfoInput,
  output: LaunchInfoOutput,
} satisfies CommandDefinition<typeof LaunchInfoInput, typeof LaunchInfoOutput>;

/**
 * M0 spike handler: reads the launch facts from the database on every call (no cached copy),
 * so what the UI shows is what is really stored. Read-only.
 */
export function createLaunchInfoHandler(
  /** The active profile's database, asked on every call so a profile switch is followed. */
  database: () => Database,
): CommandHandler<typeof LaunchInfoInput, typeof LaunchInfoOutput> {
  return () => {
    const db = database();
    const launch = new AppMetaRepository(db).readLaunch();
    // Startup records a launch before any window exists, so this only fails on a real bug.
    // The router turns the throw into a logged internal_error.
    if (launch === undefined) throw new Error('No launch has been recorded');
    return { ...launch, schemaVersion: readSchemaVersion(db) };
  };
}
