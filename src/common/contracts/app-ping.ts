// `app.ping`: an M0 spike command that proves the validated IPC round-trip (issue #5).
// It has no product meaning and will be removed or replaced once real commands exist.
import { z } from 'zod';

/**
 * What the renderer may send.
 *
 * TODO(you): make this schema enforce the rules in tests/integration/app-ping-contract.test.ts
 * (the `describe.skip` block), then remove the `.skip`. Hints:
 * - `z.strictObject({...})` rejects keys you didn't list (z.object would silently drop them).
 * - String helpers chain: `z.string().trim().min(n).max(n)`. Order matters: trim first, so
 *   "   " becomes "" and then fails `min(1)`.
 * - Export the limit as a constant (e.g. PING_MESSAGE_MAX_LENGTH) so tests don't repeat 200.
 * Ask yourself: what should happen to leading/trailing spaces, and why reject extra keys?
 */
export const PingInput = z.strictObject({
  message: z.string(),
});
export type PingInput = z.infer<typeof PingInput>;

/** What the main process sends back. */
export const PingOutput = z.strictObject({
  reply: z.string(),
  receivedAt: z.iso.datetime(),
});
export type PingOutput = z.infer<typeof PingOutput>;
