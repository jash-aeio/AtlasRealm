// `runtime.workerStatus` and `runtime.workerCheck`: M0 spike commands (issue #9). They let the
// UI (and E2E tests) see the worker process: its state, an echo round-trip and a cancelled
// slow count. No product meaning; replaced by real run status in M4.
import { z } from 'zod';

import { WorkerErrorCode } from './worker-protocol';

/** Takes no payload. Anything sent along (even `{}`) is rejected. */
export const WorkerStatusInput = z.undefined();

export const DEFAULT_CANCEL_AFTER_MS = 100;

/**
 * Optional: how long the slow count runs before the check cancels it (default 100 ms). Tests
 * use a longer window to crash the worker while the count is in flight.
 */
export const WorkerCheckInput = z
  .strictObject({ cancelAfterMs: z.int().min(10).max(5_000) })
  .optional();
export type WorkerCheckInput = z.infer<typeof WorkerCheckInput>;

export const WorkerStatusOutput = z.strictObject({
  state: z.enum(['starting', 'running', 'crashed', 'stopped']),
  pid: z.int().positive().nullable(),
  crashCount: z.int().nonnegative(),
  lastExitCode: z.int().nullable(),
  pendingRequests: z.int().nonnegative(),
  staleRepliesDropped: z.int().nonnegative(),
  checkedAt: z.iso.datetime(),
});
export type WorkerStatusOutput = z.infer<typeof WorkerStatusOutput>;

/** 'ok' or the worker error code the step ended with. */
const Outcome = z.union([z.literal('ok'), WorkerErrorCode]);

export const WorkerCheckOutput = z.strictObject({
  echo: z.strictObject({
    outcome: Outcome,
    roundTripMs: z.number().nonnegative(),
    workerPid: z.int().positive().nullable(),
  }),
  cancel: z.strictObject({
    /** Expected: 'cancelled'. */
    outcome: Outcome,
    cancelledAfterMs: z.int().nonnegative(),
    /** Requests the worker still had running after the cancel; expected 0. */
    activeAfterCancel: z.int().nonnegative().nullable(),
  }),
  status: WorkerStatusOutput,
});
export type WorkerCheckOutput = z.infer<typeof WorkerCheckOutput>;
