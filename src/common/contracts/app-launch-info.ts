// `app.launchInfo`: an M0 spike command (issue #10). It reads the launch facts stored in the
// local database so the UI can show that data survives a restart, also in the packaged app.
// It has no product meaning and will be removed once real project data exists.
import { z } from 'zod';

/** Takes no payload. Anything sent along (even `{}`) is rejected, not ignored. */
export const LaunchInfoInput = z.undefined();
export type LaunchInfoInput = z.infer<typeof LaunchInfoInput>;

export const LaunchInfoOutput = z.strictObject({
  launchCount: z.int().positive(),
  firstLaunchedAt: z.iso.datetime(),
  lastLaunchedAt: z.iso.datetime(),
  schemaVersion: z.int().nonnegative(),
});
export type LaunchInfoOutput = z.infer<typeof LaunchInfoOutput>;
