// `app.ping`: an M0 spike command that proves the validated IPC round-trip (issue #5).
// It has no product meaning and will be removed or replaced once real commands exist.
import { z } from 'zod';

export const PING_MESSAGE_MAX_LENGTH = 200;

/**
 * What the renderer may send. Trim runs first, so "   " becomes "" and fails min(1).
 * strictObject rejects unknown keys instead of silently dropping them, so a malformed or
 * forged request fails loudly rather than half-succeeding.
 */
export const PingInput = z.strictObject({
  message: z.string().trim().min(1).max(PING_MESSAGE_MAX_LENGTH),
});
export type PingInput = z.infer<typeof PingInput>;

/** What the main process sends back. */
export const PingOutput = z.strictObject({
  reply: z.string(),
  receivedAt: z.iso.datetime(),
});
export type PingOutput = z.infer<typeof PingOutput>;
