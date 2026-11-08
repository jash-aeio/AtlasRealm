// Command router core: every IPC command passes these checks, in this order, before
// any handler code runs (ARCHITECTURE.md §7.2, §16.1):
//   1. sender check: the request comes from our own UI's main frame
//   2. schema check: the payload matches the command's Zod input schema. This runs before
//      measuring size because it fails fast on wrong shapes (e.g. a 50 MB typed array)
//      without serializing them
//   3. size check: the validated payload is bounded
// Nothing here imports Electron at runtime, so it is unit-tested with fake senders.
import type { z } from 'zod';

import type { Channel } from '../../common/contracts/channels';
import type { IpcError, IpcErrorCode, IpcResult } from '../../common/contracts/ipc-result';

/** Largest accepted payload, measured as UTF-8 JSON. Generous for commands, tiny for abuse. */
export const MAX_PAYLOAD_BYTES = 64 * 1024;

export interface CommandDefinition<I extends z.ZodType, O extends z.ZodType> {
  readonly channel: Channel;
  readonly input: I;
  readonly output: O;
}

/** The part of Electron's IpcMainInvokeEvent the router needs (structurally compatible). */
export interface InvokeSender {
  readonly senderFrame: { readonly url: string; readonly parent: unknown } | null;
}

export type SenderCheck = (sender: InvokeSender) => boolean;

export type CommandHandler<I extends z.ZodType, O extends z.ZodType> = (
  input: z.output<I>,
) => z.input<O> | Promise<z.input<O>>;

/**
 * Returns a sender check that only trusts the main frame of the page we loaded ourselves.
 * Dev server URLs match by origin. Built `file://` pages must be exactly our index.html on
 * this machine: a UNC URL (file://server/...) has a host and is rejected even if its path matches.
 */
export function trustRendererEntry(entryUrl: string): SenderCheck {
  const entry = new URL(entryUrl);
  return ({ senderFrame }) => {
    if (senderFrame === null || senderFrame.parent !== null) return false;
    let url: URL;
    try {
      url = new URL(senderFrame.url);
    } catch {
      return false;
    }
    if (entry.protocol === 'file:') {
      return url.protocol === 'file:' && url.host === entry.host && url.pathname === entry.pathname;
    }
    return url.origin === entry.origin;
  };
}

function payloadBytes(raw: unknown): number | undefined {
  // No argument at all. (JSON.stringify(undefined) returns undefined, despite its types.)
  if (raw === undefined) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(raw), 'utf8');
  } catch {
    return undefined; // not JSON-serializable (e.g. BigInt): treat as invalid
  }
}

export function createCommandHandler<I extends z.ZodType, O extends z.ZodType>(
  definition: CommandDefinition<I, O>,
  handler: CommandHandler<I, O>,
  isTrustedSender: SenderCheck,
): (event: InvokeSender, raw: unknown) => Promise<IpcResult<z.output<O>>> {
  return async (event, raw) => {
    if (!isTrustedSender(event)) {
      return fail('forbidden_sender', 'Request rejected: unknown sender.');
    }

    const parsed = definition.input.safeParse(raw);
    if (!parsed.success) {
      return fail('invalid_payload', `Request rejected: invalid ${definition.channel} payload.`);
    }

    const size = payloadBytes(parsed.data);
    if (size === undefined) {
      return fail('invalid_payload', 'Request rejected: payload is not plain data.');
    }
    if (size > MAX_PAYLOAD_BYTES) {
      return fail('payload_too_large', 'Request rejected: payload is too large.');
    }

    try {
      // Validate our own output too, so a handler bug can't break the contract silently.
      const data = definition.output.parse(await handler(parsed.data));
      return { ok: true, data };
    } catch (error) {
      // Details stay in the main process. Never log the payload: later commands may carry
      // user content or secrets.
      console.error(`[ipc] ${definition.channel} handler failed`, error);
      return fail('internal_error', 'Something went wrong. The error was logged.');
    }
  };
}

function fail(code: IpcErrorCode, message: string): { ok: false; error: IpcError } {
  return { ok: false, error: { code, message } };
}
