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
  db: Database,
): CommandHandler<typeof LaunchInfoInput, typeof LaunchInfoOutput> {
  const meta = new AppMetaRepository(db);
  return () => {
    const launch = meta.readLaunch();
    // Startup records a launch before any window exists, so this only fails on a real bug.
    // The router turns the throw into a logged internal_error.
    if (launch === undefined) throw new Error('No launch has been recorded');
    return { ...launch, schemaVersion: readSchemaVersion(db) };
  };
}
