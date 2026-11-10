import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  WORKER_MAX_MESSAGE_BYTES,
  type MainToWorker,
  type WorkerToMain,
} from '../../src/common/contracts/worker-protocol';
import {
  WorkerBridge,
  type WorkerSpawner,
  type WorkerTransport,
} from '../../src/main/runtime-bridge/worker-bridge';
import {
  createDispatcher,
  createSpikeHandlers,
  type Dispatcher,
} from '../../src/worker/dispatcher';

// The bridge (main side) and the dispatcher (worker side) joined by an in-memory transport.
// Messages are delivered on a later tick and copied with structuredClone, like a real
// MessagePort, so nothing can rely on synchronous delivery or shared objects.

const FAKE_PID = 4242;

interface FakeWorker {
  readonly transport: WorkerTransport;
  readonly dispatcher: Dispatcher;
  readonly sent: MainToWorker[];
  /** Sends a raw message to main as if the worker had posted it. */
  emit(raw: unknown): void;
  /** Simulates the process ending (crash or kill). */
  exit(code: number): void;
  killed: boolean;
}

function fakeSpawner(options: { onStep?: () => void; connect?: boolean } = {}): {
  spawn: WorkerSpawner;
  workers: FakeWorker[];
} {
  const workers: FakeWorker[] = [];
  const spawn: WorkerSpawner = () => {
    let toMain: ((raw: unknown) => void) | undefined;
    let onExit: ((code: number) => void) | undefined;
    let alive = true;
    const deliver = (raw: unknown): void => {
      const copy = structuredClone(raw);
      setImmediate(() => {
        if (alive) toMain?.(copy);
      });
    };
    const handlers = createSpikeHandlers(FAKE_PID, { onStep: options.onStep });
    const dispatcher = createDispatcher(deliver, handlers);
    const worker: FakeWorker = {
      sent: [],
      dispatcher,
      killed: false,
      // Bypasses the 'alive' gate on purpose: the bridge itself must ignore stale workers.
      emit(raw) {
        const copy = structuredClone(raw);
        setImmediate(() => toMain?.(copy));
      },
      exit(code) {
        if (!alive) return;
        alive = false;
        setImmediate(() => onExit?.(code));
      },
      transport: {
        post(message) {
          worker.sent.push(message);
          const copy = structuredClone(message);
          setImmediate(() => {
            if (alive && options.connect !== false) dispatcher.handle(copy);
          });
        },
        onMessage(listener) {
          toMain = listener;
        },
        onExit(listener) {
          onExit = listener;
        },
        kill() {
          worker.killed = true;
          worker.exit(1);
        },
      },
    };
    workers.push(worker);
    if (options.connect !== false) deliver({ kind: 'ready', pid: FAKE_PID });
    return worker.transport;
  };
  return { spawn, workers };
}

function worker(workers: FakeWorker[], index = 0): FakeWorker {
  const found = workers[index];
  if (found === undefined) throw new Error(`No worker #${String(index)}`);
  return found;
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('worker messaging: request/response', () => {
  it('starts a worker and reports it running once it says ready', async () => {
    const { spawn } = fakeSpawner();
    const bridge = new WorkerBridge(spawn);
    expect(bridge.status().state).toBe('stopped');
    bridge.start();
    expect(bridge.status().state).toBe('starting');
    await tick();
    expect(bridge.status()).toMatchObject({ state: 'running', pid: FAKE_PID, crashCount: 0 });
  });

  it('round-trips a request with a fresh UUID per request', async () => {
    const { spawn, workers } = fakeSpawner();
    const bridge = new WorkerBridge(spawn);
    const [a, b] = await Promise.all([
      bridge.request('spike.echo', { text: 'one' }),
      bridge.request('spike.echo', { text: 'two' }),
    ]);
    expect(a).toEqual({ ok: true, data: { text: 'one', pid: FAKE_PID, activeRequests: 0 } });
    expect(b).toMatchObject({ ok: true, data: { text: 'two' } });
    const ids = worker(workers).sent.map((m) => m.id);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('matches replies to requests by ID when they arrive out of order', async () => {
    const { spawn } = fakeSpawner();
    const bridge = new WorkerBridge(spawn);
    const slow = bridge.request('spike.slowCount', { to: 3, stepMs: 5 });
    const fast = bridge.request('spike.echo', { text: 'fast' });
    const order: string[] = [];
    await Promise.all([
      slow.then((r) => order.push(r.ok ? `slow:${String(r.data.counted)}` : 'slow:err')),
      fast.then((r) => order.push(r.ok ? `fast:${r.data.text}` : 'fast:err')),
    ]);
    expect(order).toEqual(['fast:fast', 'slow:3']);
    expect(bridge.pendingCount()).toBe(0);
  });
});

describe('worker messaging: validation and size limits', () => {
  it('refuses an invalid payload on the main side without sending anything', async () => {
    const { spawn, workers } = fakeSpawner();
    const bridge = new WorkerBridge(spawn);
    // @ts-expect-error: deliberately wrong shape
    const result = await bridge.request('spike.slowCount', { to: 'many', stepMs: 1 });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
    expect(workers).toHaveLength(0);
  });

  it('worker refuses oversized, malformed and unknown-method messages with clear codes', async () => {
    const replies: WorkerToMain[] = [];
    const dispatcher = createDispatcher((m) => replies.push(m), createSpikeHandlers(FAKE_PID));
    const id = '0b8f0f0e-6b4e-4a8e-9d55-1f6f2b3c4d5e';

    dispatcher.handle({
      kind: 'request',
      id,
      method: 'spike.echo',
      payload: { text: 'x'.repeat(WORKER_MAX_MESSAGE_BYTES) },
    });
    dispatcher.handle({ kind: 'request', id: 'not-a-uuid', method: 'spike.echo', payload: {} });
    dispatcher.handle({ kind: 'request', id, method: 'spike.echo', payload: {}, extra: true });
    dispatcher.handle({ kind: 'request', id, method: 'fs.readFile', payload: {} });
    dispatcher.handle({ kind: 'request', id, method: 'spike.echo', payload: { text: 1 } });
    dispatcher.handle({ kind: 'request', id, method: 'spike.echo', payload: { n: 1n } });
    dispatcher.handle({ kind: 'request', id, method: 'toString', payload: {} });
    await tick();

    expect(replies.map((r) => (r.kind === 'error' ? [r.id, r.error.code] : r.kind))).toEqual([
      [null, 'message_too_large'],
      [null, 'invalid_message'],
      [null, 'invalid_message'],
      [id, 'unknown_method'],
      [id, 'invalid_payload'],
      [null, 'message_too_large'], // BigInt isn't plain JSON data
      [id, 'unknown_method'], // inherited Object.prototype names aren't methods
    ]);
  });

  it('main refuses a malformed, oversized or wrong-shaped reply from the worker', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { spawn, workers } = fakeSpawner({ connect: false });
    const bridge = new WorkerBridge(spawn);
    const pending = bridge.request('spike.echo', { text: 'hi' }, { timeoutMs: 50 });
    await tick();
    const w = worker(workers);
    const id = w.sent[0]?.id;
    w.emit({ kind: 'result', id, data: 'x'.repeat(WORKER_MAX_MESSAGE_BYTES) });
    w.emit({ kind: 'result', id: 'nope', data: {} });
    w.emit({ kind: 'result', id, data: { text: 'hi', pid: -1, activeRequests: 0 } });
    expect(await pending).toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('too large'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('invalid envelope'));
  });

  it('worker refuses a request that reuses an active ID', () => {
    const replies: WorkerToMain[] = [];
    const dispatcher = createDispatcher((m) => replies.push(m), createSpikeHandlers(FAKE_PID));
    const id = '0b8f0f0e-6b4e-4a8e-9d55-1f6f2b3c4d5e';
    dispatcher.handle({
      kind: 'request',
      id,
      method: 'spike.slowCount',
      payload: { to: 100, stepMs: 10 },
    });
    dispatcher.handle({ kind: 'request', id, method: 'spike.echo', payload: { text: 'dup' } });
    expect(replies).toEqual([
      {
        kind: 'error',
        id,
        error: { code: 'invalid_message', message: 'Request ID is already in use.' },
      },
    ]);
    dispatcher.handle({ kind: 'cancel', id });
    expect(dispatcher.activeRequests()).toBe(0);
  });
});

describe('worker messaging: cancellation', () => {
  it('cancels in-flight work: the caller settles at once and the worker stops counting', async () => {
    let steps = 0;
    const { spawn, workers } = fakeSpawner({ onStep: () => (steps += 1) });
    const bridge = new WorkerBridge(spawn);
    const controller = new AbortController();
    const pending = bridge.request(
      'spike.slowCount',
      { to: 1000, stepMs: 5 },
      { signal: controller.signal },
    );
    await new Promise((r) => setTimeout(r, 30));
    const stepsAtCancel = steps;
    expect(stepsAtCancel).toBeGreaterThan(0); // it really was running
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(bridge.pendingCount()).toBe(0);

    await new Promise((r) => setTimeout(r, 40));
    expect(steps).toBeLessThanOrEqual(stepsAtCancel + 1); // at most the step already under way
    expect(worker(workers).dispatcher.activeRequests()).toBe(0);
    expect(worker(workers).sent.map((m) => m.kind)).toEqual(['request', 'cancel']);

    // The worker's own "cancelled" reply arrived after we'd settled, so it was dropped.
    expect(bridge.status().staleRepliesDropped).toBe(1);
    // And the worker is still usable.
    const echo = await bridge.request('spike.echo', { text: 'after' });
    expect(echo).toMatchObject({ ok: true, data: { activeRequests: 0 } });
  });

  it('an already-aborted signal never sends the request', async () => {
    const { spawn, workers } = fakeSpawner();
    const bridge = new WorkerBridge(spawn);
    const result = await bridge.request(
      'spike.echo',
      { text: 'x' },
      { signal: AbortSignal.abort() },
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(workers).toHaveLength(0);
  });

  it('a late result for a cancelled request is dropped, not delivered', async () => {
    const { spawn, workers } = fakeSpawner({ connect: false });
    const bridge = new WorkerBridge(spawn);
    const controller = new AbortController();
    const pending = bridge.request('spike.echo', { text: 'x' }, { signal: controller.signal });
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    const w = worker(workers);
    w.emit({ kind: 'result', id: w.sent[0]?.id, data: { text: 'x', pid: 1, activeRequests: 0 } });
    await tick();
    expect(bridge.status().staleRepliesDropped).toBe(1);
  });

  it('times out a request with no reply and tells the worker to stop', async () => {
    const { spawn, workers } = fakeSpawner({ connect: false });
    const bridge = new WorkerBridge(spawn);
    const result = await bridge.request('spike.echo', { text: 'x' }, { timeoutMs: 20 });
    expect(result).toMatchObject({ ok: false, error: { code: 'timeout' } });
    expect(worker(workers).sent.map((m) => m.kind)).toEqual(['request', 'cancel']);
    expect(bridge.pendingCount()).toBe(0);
  });
});

describe('worker messaging: crash detection', () => {
  it('fails every pending request, reports the crash and does not retry', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { spawn, workers } = fakeSpawner();
    const bridge = new WorkerBridge(spawn);
    const a = bridge.request('spike.slowCount', { to: 1000, stepMs: 5 });
    const b = bridge.request('spike.slowCount', { to: 1000, stepMs: 5 });
    await new Promise((r) => setTimeout(r, 15));
    worker(workers).exit(3221225477); // Windows access violation exit code

    expect(await a).toMatchObject({ ok: false, error: { code: 'worker_crashed' } });
    expect(await b).toMatchObject({ ok: false, error: { code: 'worker_crashed' } });
    expect(bridge.status()).toEqual({
      state: 'crashed',
      pid: null,
      crashCount: 1,
      lastExitCode: 3221225477,
      staleRepliesDropped: 0,
    });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('exited unexpectedly'));
    // Not retried: the crashed worker received exactly the two original requests.
    expect(worker(workers).sent).toHaveLength(2);
    expect(workers).toHaveLength(1);
  });

  it('the next request starts a fresh worker after a crash', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { spawn, workers } = fakeSpawner();
    const bridge = new WorkerBridge(spawn);
    bridge.start();
    await tick();
    worker(workers).exit(1);
    await tick();
    expect(bridge.status().state).toBe('crashed');

    const result = await bridge.request('spike.echo', { text: 'again' });
    expect(result.ok).toBe(true);
    expect(workers).toHaveLength(2);
    expect(bridge.status()).toMatchObject({ state: 'running', crashCount: 1, lastExitCode: 1 });
  });

  it('ignores messages from a worker that has been replaced', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { spawn, workers } = fakeSpawner({ connect: false });
    const bridge = new WorkerBridge(spawn);
    bridge.start();
    worker(workers).exit(1);
    await tick();
    bridge.start();
    worker(workers, 1).emit({ kind: 'ready', pid: 2 });
    // Arrives after the new worker's message: the bridge must still ignore it.
    worker(workers).emit({ kind: 'ready', pid: 1 });
    await tick();
    expect(bridge.status().pid).toBe(2);
  });

  it('a deliberate stop is not counted as a crash', async () => {
    const { spawn, workers } = fakeSpawner({ connect: false });
    const bridge = new WorkerBridge(spawn);
    const pending = bridge.request('spike.echo', { text: 'x' });
    bridge.stop();
    expect(await pending).toMatchObject({ ok: false, error: { code: 'worker_stopped' } });
    await tick();
    expect(worker(workers).killed).toBe(true);
    expect(bridge.status()).toMatchObject({ state: 'stopped', crashCount: 0 });
  });
});
