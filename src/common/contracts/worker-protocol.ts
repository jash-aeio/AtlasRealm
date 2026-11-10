// Messages between the main process and the trusted worker (ARCHITECTURE §7.2, issue #9).
// Both sides validate every message with these schemas and refuse anything over the size
// limit. Each request carries a random ID; the reply, or a cancel, refers to that ID, so
// replies can arrive in any order and still reach the right caller.
//
// The worker runs only our own code. It's a separate process for robustness (a crash or a
// busy loop can't freeze the main process), not a security sandbox (§7.2).
import { z } from 'zod';

/** Largest message either side accepts, measured as UTF-8 JSON (see json-size.ts). */
export const WORKER_MAX_MESSAGE_BYTES = 256 * 1024;

/** Random UUID per request, made by the main side with crypto.randomUUID(). */
export const RequestId = z.uuid();
export type RequestId = z.infer<typeof RequestId>;

export type WorkerErrorCode =
  | 'cancelled' // the caller cancelled; any later reply is dropped
  | 'timeout' // no reply in time; the worker was told to stop
  | 'worker_crashed' // the worker process ended while the request was pending
  | 'worker_stopped' // the app stopped the worker on purpose (quit)
  | 'invalid_message' // a message failed the envelope schema (or reused an active ID)
  | 'message_too_large'
  | 'unknown_method'
  | 'invalid_payload' // failed the method's input or output schema
  | 'internal_error'; // the method threw; details stay in the worker's log

export const WorkerErrorCode = z.enum([
  'cancelled',
  'timeout',
  'worker_crashed',
  'worker_stopped',
  'invalid_message',
  'message_too_large',
  'unknown_method',
  'invalid_payload',
  'internal_error',
]) satisfies z.ZodType<WorkerErrorCode>;

export const WorkerError = z.strictObject({
  code: WorkerErrorCode,
  message: z.string().max(500),
});
export type WorkerError = z.infer<typeof WorkerError>;

export type WorkerResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: WorkerError };

// ---- Methods ------------------------------------------------------------------------------
// M0 spike methods only. They prove the plumbing and have no product meaning; real
// orchestration methods replace them in M4.

export const WORKER_METHODS = {
  /** Replies at once. `activeRequests` lets tests see that cancelled work really stopped. */
  'spike.echo': {
    input: z.strictObject({ text: z.string().max(1000) }),
    output: z.strictObject({
      text: z.string(),
      pid: z.int().positive(),
      activeRequests: z.int().nonnegative(),
    }),
  },
  /** Counts to `to`, waiting `stepMs` between steps: slow, cancellable work. */
  'spike.slowCount': {
    input: z.strictObject({
      to: z.int().min(1).max(10_000),
      stepMs: z.int().min(0).max(1000),
    }),
    output: z.strictObject({ counted: z.int().nonnegative() }),
  },
} as const satisfies Record<string, { input: z.ZodType; output: z.ZodType }>;

export type WorkerMethod = keyof typeof WORKER_METHODS;
export type WorkerInput<M extends WorkerMethod> = z.input<(typeof WORKER_METHODS)[M]['input']>;
export type WorkerOutput<M extends WorkerMethod> = z.output<(typeof WORKER_METHODS)[M]['output']>;

export function isWorkerMethod(name: string): name is WorkerMethod {
  return Object.hasOwn(WORKER_METHODS, name);
}

// ---- Envelopes ----------------------------------------------------------------------------
// The method name is checked against WORKER_METHODS separately, so an unknown method gets
// its own error code instead of a generic schema failure.

export const MainToWorker = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('request'),
    id: RequestId,
    method: z.string().max(100),
    payload: z.unknown(),
  }),
  z.strictObject({ kind: z.literal('cancel'), id: RequestId }),
]);
export type MainToWorker = z.infer<typeof MainToWorker>;

export const WorkerToMain = z.discriminatedUnion('kind', [
  /** Sent once when the worker is connected and listening. */
  z.strictObject({ kind: z.literal('ready'), pid: z.int().positive() }),
  z.strictObject({ kind: z.literal('result'), id: RequestId, data: z.unknown() }),
  /** `id` is null when the worker couldn't read the ID of the message it refuses. */
  z.strictObject({ kind: z.literal('error'), id: RequestId.nullable(), error: WorkerError }),
]);
export type WorkerToMain = z.infer<typeof WorkerToMain>;
