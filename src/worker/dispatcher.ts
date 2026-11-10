// The worker's message handling, with no Electron imports so it is unit-tested directly.
// src/worker/index.ts connects it to the real MessagePort.
//
// Per message: size check → envelope schema → method lookup → input schema → handler.
// Each running request gets its own AbortController. A `cancel` aborts it and forgets it
// at once, so the worker never reports a cancelled request as still active.
import { setTimeout as delay } from 'node:timers/promises';

import { jsonByteLength } from '../common/contracts/json-size';
import {
  isWorkerMethod,
  MainToWorker,
  WORKER_MAX_MESSAGE_BYTES,
  WORKER_METHODS,
  type RequestId,
  type WorkerError,
  type WorkerInput,
  type WorkerMethod,
  type WorkerOutput,
  type WorkerToMain,
} from '../common/contracts/worker-protocol';

export interface HandlerContext {
  /** Aborted when main cancels the request (or times it out). Handlers must honour it. */
  readonly signal: AbortSignal;
  readonly activeRequests: () => number;
}

export type MethodHandler<M extends WorkerMethod> = (
  input: WorkerInput<M>,
  context: HandlerContext,
) => Promise<WorkerOutput<M>>;

export type MethodHandlers = { readonly [M in WorkerMethod]: MethodHandler<M> };

/**
 * M0 spike methods (see worker-protocol.ts). `onStep` lets tests watch the counting loop
 * really stop after a cancel; the worker entry doesn't pass it.
 */
export function createSpikeHandlers(
  pid: number,
  hooks: { readonly onStep?: () => void } = {},
): MethodHandlers {
  return {
    'spike.echo': (input, { activeRequests }) =>
      // The echo itself is active while it runs; report the *other* requests.
      Promise.resolve({ text: input.text, pid, activeRequests: activeRequests() - 1 }),
    'spike.slowCount': async (input, { signal }) => {
      let counted = 0;
      while (counted < input.to) {
        // Rejects with an AbortError as soon as the signal fires, even mid-wait.
        await delay(input.stepMs, undefined, { signal });
        counted += 1;
        hooks.onStep?.();
      }
      return { counted };
    },
  };
}

export interface Dispatcher {
  handle(raw: unknown): void;
  activeRequests(): number;
}

export function createDispatcher(
  post: (message: WorkerToMain) => void,
  handlers: MethodHandlers,
): Dispatcher {
  const active = new Map<RequestId, AbortController>();

  function reply(message: WorkerToMain): void {
    // Our own replies obey the same limit; an oversized result becomes an error reply.
    const size = jsonByteLength(message);
    if (message.kind === 'result' && (size === undefined || size > WORKER_MAX_MESSAGE_BYTES)) {
      post(failure(message.id, 'message_too_large', 'Result is too large to send.'));
      return;
    }
    post(message);
  }

  async function run(id: RequestId, method: WorkerMethod, payload: unknown): Promise<void> {
    const { input } = WORKER_METHODS[method];
    const parsed = input.safeParse(payload);
    if (!parsed.success) {
      reply(failure(id, 'invalid_payload', `Invalid ${method} payload.`));
      return;
    }
    const controller = new AbortController();
    active.set(id, controller);
    const context: HandlerContext = {
      signal: controller.signal,
      activeRequests: () => active.size,
    };
    try {
      // The cast is safe: `handlers[method]` and `parsed.data` belong to the same method.
      const handler = handlers[method] as MethodHandler<WorkerMethod>;
      const data = await handler(parsed.data, context);
      if (controller.signal.aborted) return; // main has already moved on
      reply({ kind: 'result', id, data });
    } catch (error) {
      if (controller.signal.aborted) {
        reply(failure(id, 'cancelled', 'Request was cancelled.'));
        return;
      }
      console.error(`[worker] ${method} failed`, error);
      reply(failure(id, 'internal_error', 'The worker method failed. The error was logged.'));
    } finally {
      // Only remove our own entry; a cancel may have removed it already.
      if (active.get(id) === controller) active.delete(id);
    }
  }

  return {
    handle(raw) {
      const size = jsonByteLength(raw);
      if (size === undefined || size > WORKER_MAX_MESSAGE_BYTES) {
        reply(failure(null, 'message_too_large', 'Message refused: too large or not plain data.'));
        return;
      }
      const parsed = MainToWorker.safeParse(raw);
      if (!parsed.success) {
        reply(failure(null, 'invalid_message', 'Message refused: invalid envelope.'));
        return;
      }
      const message = parsed.data;
      if (message.kind === 'cancel') {
        // Unknown IDs are fine: the request may have finished just before the cancel arrived.
        active.get(message.id)?.abort();
        active.delete(message.id);
        return;
      }
      if (active.has(message.id)) {
        reply(failure(message.id, 'invalid_message', 'Request ID is already in use.'));
        return;
      }
      if (!isWorkerMethod(message.method)) {
        reply(failure(message.id, 'unknown_method', 'Unknown worker method.'));
        return;
      }
      void run(message.id, message.method, message.payload);
    },
    activeRequests: () => active.size,
  };
}

function failure(id: RequestId | null, code: WorkerError['code'], message: string): WorkerToMain {
  return { kind: 'error', id, error: { code, message } };
}
