// Command router core: every IPC command passes these checks, in this order, before
// any handler code runs (ARCHITECTURE.md §7.2, §16.1):
//   1. sender check: the request comes from our own UI's main frame
//   2. plain-data gate: a bounded walk refuses binary and non-plain values and anything
//      clearly over the size limit. It runs before Zod because Zod's object check treats a
//      typed array as an object and lists every index as an unknown key: seconds of main-process
//      time for a 10 MB Uint8Array (#56). The walk stops after about MAX_PAYLOAD_BYTES steps.
//      It measures the payload as sent, so padding that a schema would .trim() away still
//      counts towards the limit
//   3. schema check: the payload matches the command's Zod input schema
//   4. size check: the exact UTF-8 JSON size of the validated payload is bounded
// Nothing here imports Electron at runtime, so it is unit-tested with fake senders.
import type { z } from 'zod';

import type { Channel } from '../../common/contracts/channels';
import type {
  HotbarSlotConflict,
  IpcError,
  IpcErrorCode,
  IpcResult,
  PlacementRefusal,
} from '../../common/contracts/ipc-result';
import { checkPlainJson, jsonByteLength } from '../../common/contracts/json-size';
import { isAppOrigin } from '../bootstrap/app-origin';

/**
 * At most this many blocking building IDs travel with a `placement_blocked` error. A 4×4
 * footprint can overlap at most 16 buildings; the cap only matters for a damaged world, and is
 * explicit because error replies skip output validation (#68 security L1).
 */
export const MAX_BLOCKING_IDS = 64;

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

/** Codes a handler may return on purpose. The router's own checks own the other codes. */
export type CommandErrorCode = Extract<
  IpcErrorCode,
  | 'invalid_payload'
  | 'not_found'
  | 'already_exists'
  | 'revision_conflict'
  | 'invalid_transition'
  | 'limit_reached'
  | 'placement_blocked'
  | 'slot_occupied'
  | 'profile_switching'
  | 'profile_unavailable'
>;

/** Extra, code-specific detail a CommandError may carry to the renderer. */
export interface CommandErrorDetails {
  /** Only for `placement_blocked`. */
  readonly placement?: PlacementRefusal;
  /** Only for `slot_occupied`. */
  readonly hotbar?: HotbarSlotConflict;
}

/**
 * Thrown by a handler (or the service it calls) to report an expected failure with a stable
 * code (ADR-0019). The message is shown to the user, so it must be fixed text: no paths, IDs
 * or payload content. Anything else a handler throws becomes `internal_error`.
 */
export class CommandError extends Error {
  override readonly name = 'CommandError';
  constructor(
    readonly code: CommandErrorCode,
    message: string,
    /** Only for `revision_conflict`. */
    readonly currentRevision?: number,
    readonly details: CommandErrorDetails = {},
  ) {
    super(message);
  }
}

export type CommandHandler<I extends z.ZodType, O extends z.ZodType> = (
  input: z.output<I>,
) => z.input<O> | Promise<z.input<O>>;

/**
 * Returns a sender check that only trusts the main frame of the page we loaded ourselves.
 * Builds load from our own `app://atlas` origin (issue #16) and the dev server from
 * http://localhost:<port>. Any other entry kind, including `file:`, is a programming error.
 */
export function trustRendererEntry(entryUrl: string): SenderCheck {
  const entry = new URL(entryUrl);
  const isAppEntry = isAppOrigin(entry);
  if (!isAppEntry && entry.protocol !== 'http:') {
    throw new Error(`Unsupported renderer entry scheme: ${entry.protocol}`);
  }
  return ({ senderFrame }) => {
    if (senderFrame === null || senderFrame.parent !== null) return false;
    let url: URL;
    try {
      url = new URL(senderFrame.url);
    } catch {
      return false;
    }
    // Not URL.origin: Node reports "null" for custom schemes, and "null" === "null" would
    // trust every custom-scheme page. The whole origin is trusted, not just index.html:
    // same-origin history.pushState can change the path anyway.
    if (isAppEntry) return isAppOrigin(url);
    return url.origin === entry.origin;
  };
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

    const gate = checkPlainJson(raw, MAX_PAYLOAD_BYTES);
    if (gate === 'not_plain') {
      return fail('invalid_payload', 'Request rejected: payload is not plain data.');
    }
    if (gate === 'too_large') {
      return fail('payload_too_large', 'Request rejected: payload is too large.');
    }

    const parsed = definition.input.safeParse(raw);
    if (!parsed.success) {
      return fail('invalid_payload', `Request rejected: invalid ${definition.channel} payload.`);
    }

    const size = jsonByteLength(parsed.data);
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
      if (error instanceof CommandError) {
        const { placement, hotbar } = error.details;
        return {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            ...(error.currentRevision === undefined
              ? {}
              : { currentRevision: error.currentRevision }),
            // Copied field by field, so nothing else a service attached can leak across.
            ...(placement === undefined
              ? {}
              : {
                  placement: {
                    reason: placement.reason,
                    blockingIds: placement.blockingIds.slice(0, MAX_BLOCKING_IDS),
                  },
                }),
            ...(hotbar === undefined
              ? {}
              : {
                  hotbar: {
                    slot: hotbar.slot,
                    occupant: {
                      target: { type: hotbar.occupant.target.type, id: hotbar.occupant.target.id },
                      projectStatus: hotbar.occupant.projectStatus,
                    },
                  },
                }),
          },
        };
      }
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
