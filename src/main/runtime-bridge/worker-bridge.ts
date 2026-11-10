// Main-process side of the worker channel (ARCHITECTURE §7.2, issue #9).
//
// - Every request gets a random ID and an entry in `pending`; the reply settles that entry.
// - Cancel (AbortSignal) or timeout settles the entry at once and tells the worker to stop.
//   A reply that arrives later finds no entry and is dropped (WORKFLOW_ENGINE §12.7:
//   stale responses can't restart cancelled work).
// - If the worker process ends on its own, every pending request fails with
//   `worker_crashed`, and the crash is logged and kept in `status()`. Nothing is retried
//   automatically: the work may have been half done (PRODUCT_RULES: never blindly repeat).
//   The next request starts a fresh worker.
//
// Electron stays out of this file: the process is reached through a WorkerTransport, so the
// logic is unit-tested with an in-memory transport. utility-transport.ts is the real one.
import { randomUUID } from 'node:crypto';

import { jsonByteLength } from '../../common/contracts/json-size';
import {
  WORKER_MAX_MESSAGE_BYTES,
  WORKER_METHODS,
  WorkerToMain,
  type MainToWorker,
  type RequestId,
  type WorkerError,
  type WorkerErrorCode,
  type WorkerInput,
  type WorkerMethod,
  type WorkerOutput,
  type WorkerResult,
} from '../../common/contracts/worker-protocol';

/** A running worker process, as the bridge sees it. */
export interface WorkerTransport {
  post(message: MainToWorker): void;
  onMessage(listener: (raw: unknown) => void): void;
  /** Called once when the process has ended, for any reason. */
  onExit(listener: (code: number) => void): void;
  kill(): void;
}

export type WorkerSpawner = () => WorkerTransport;

export type WorkerState = 'starting' | 'running' | 'crashed' | 'stopped';

export interface WorkerStatus {
  readonly state: WorkerState;
  /** Reported by the worker in its `ready` message. */
  readonly pid: number | null;
  /** How many times a worker ended without being asked to. */
  readonly crashCount: number;
  readonly lastExitCode: number | null;
  /** Requests sent and not yet settled. */
  readonly pendingRequests: number;
  /** Replies that arrived after their request was cancelled, timed out or never existed. */
  readonly staleRepliesDropped: number;
}

export interface RequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 30_000;

interface Pending {
  readonly method: WorkerMethod;
  readonly settle: (result: WorkerResult<unknown>) => void;
}

export class WorkerBridge {
  readonly #spawn: WorkerSpawner;
  readonly #pending = new Map<RequestId, Pending>();
  #transport: WorkerTransport | undefined;
  #state: WorkerState = 'stopped';
  #pid: number | null = null;
  #crashCount = 0;
  #lastExitCode: number | null = null;
  #staleRepliesDropped = 0;
  /** Set by stop(): the app is quitting, so no worker may start again. */
  #stopped = false;

  constructor(spawn: WorkerSpawner) {
    this.#spawn = spawn;
  }

  /**
   * Starts a worker if none is running. Called at startup and before each request. Does
   * nothing after stop(), so a request racing the app's quit can't fork a new process.
   */
  start(): void {
    if (this.#stopped || this.#transport !== undefined) return;
    const transport = this.#spawn();
    this.#transport = transport;
    this.#state = 'starting';
    this.#pid = null;
    transport.onMessage((raw) => {
      // Ignore late messages from a worker we've already replaced.
      if (this.#transport === transport) this.#receive(raw);
    });
    transport.onExit((code) => {
      this.#exited(transport, code);
    });
  }

  /**
   * Stops the worker on purpose (app quit) for good. Pending and later requests fail with
   * `worker_stopped`; it is not a crash.
   */
  stop(): void {
    this.#stopped = true;
    this.#state = 'stopped';
    const transport = this.#transport;
    if (transport === undefined) return;
    this.#transport = undefined;
    this.#failAll('worker_stopped', 'The worker was stopped.');
    transport.kill();
  }

  status(): WorkerStatus {
    return {
      state: this.#state,
      pid: this.#pid,
      crashCount: this.#crashCount,
      lastExitCode: this.#lastExitCode,
      pendingRequests: this.#pending.size,
      staleRepliesDropped: this.#staleRepliesDropped,
    };
  }

  request<M extends WorkerMethod>(
    method: M,
    input: WorkerInput<M>,
    options: RequestOptions = {},
  ): Promise<WorkerResult<WorkerOutput<M>>> {
    const { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
    if (signal?.aborted === true)
      return Promise.resolve(failure('cancelled', 'Request was cancelled.'));

    // Validate on our side too, so a bad call fails here with a clear code, before any
    // message is sent. The worker validates again: each side checks what it receives.
    const parsed = WORKER_METHODS[method].input.safeParse(input);
    if (!parsed.success)
      return Promise.resolve(failure('invalid_payload', `Invalid ${method} payload.`));

    const id = randomUUID();
    const message: MainToWorker = { kind: 'request', id, method, payload: parsed.data };
    const size = jsonByteLength(message);
    if (size === undefined || size > WORKER_MAX_MESSAGE_BYTES) {
      return Promise.resolve(failure('message_too_large', 'Request is too large to send.'));
    }

    this.start();
    const transport = this.#transport;
    if (transport === undefined) {
      return Promise.resolve(failure('worker_stopped', 'The worker was stopped.'));
    }

    return new Promise((resolve) => {
      const onAbort = (): void => {
        this.#abandon(id, 'cancelled', 'Request was cancelled.');
      };
      const timer = setTimeout(() => {
        this.#abandon(id, 'timeout', `No reply within ${String(timeoutMs)} ms.`);
      }, timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });

      this.#pending.set(id, {
        method,
        settle: (result) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          resolve(result as WorkerResult<WorkerOutput<M>>);
        },
      });
      transport.post(message);
    });
  }

  /** Settles a request locally and tells the worker to stop working on it. */
  #abandon(id: RequestId, code: WorkerErrorCode, text: string): void {
    const pending = this.#pending.get(id);
    if (pending === undefined) return;
    this.#pending.delete(id);
    this.#transport?.post({ kind: 'cancel', id });
    pending.settle(failure(code, text));
  }

  #receive(raw: unknown): void {
    const size = jsonByteLength(raw);
    if (size === undefined || size > WORKER_MAX_MESSAGE_BYTES) {
      // We can't trust anything in it, including its ID. The caller will time out.
      console.error('[runtime] worker message refused: too large or not plain data');
      return;
    }
    const parsed = WorkerToMain.safeParse(raw);
    if (!parsed.success) {
      console.error('[runtime] worker message refused: invalid envelope');
      return;
    }
    const message = parsed.data;
    if (message.kind === 'ready') {
      this.#state = 'running';
      this.#pid = message.pid;
      return;
    }
    const { id } = message;
    if (id === null) {
      // The worker refused something it couldn't attribute. That's a bug on our side.
      if (message.kind === 'error') {
        console.error(`[runtime] worker refused a message: ${message.error.code}`);
      }
      return;
    }
    const pending = this.#pending.get(id);
    if (pending === undefined) {
      this.#staleRepliesDropped += 1;
      return;
    }
    this.#pending.delete(id);
    if (message.kind === 'error') {
      pending.settle({ ok: false, error: message.error });
      return;
    }
    // A worker result is checked like any other input before main relies on it.
    const output = WORKER_METHODS[pending.method].output.safeParse(message.data);
    pending.settle(
      output.success
        ? { ok: true, data: output.data }
        : failure('invalid_payload', `The worker's ${pending.method} result was invalid.`),
    );
  }

  #exited(transport: WorkerTransport, code: number): void {
    if (this.#transport !== transport) return; // stopped on purpose, or already replaced
    this.#transport = undefined;
    this.#state = 'crashed';
    this.#pid = null;
    this.#crashCount += 1;
    this.#lastExitCode = code;
    console.error(
      `[runtime] worker exited unexpectedly (code ${String(code)}); ` +
        `${String(this.#pending.size)} pending request(s) failed`,
    );
    this.#failAll(
      'worker_crashed',
      'The worker stopped unexpectedly. The request was not retried.',
    );
  }

  #failAll(code: WorkerErrorCode, text: string): void {
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const entry of pending) entry.settle(failure(code, text));
  }
}

function failure(code: WorkerErrorCode, message: string): { ok: false; error: WorkerError } {
  return { ok: false, error: { code, message } };
}
