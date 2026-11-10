import { setTimeout as delay } from 'node:timers/promises';

import { Channels } from '../../../common/contracts/channels';
import {
  DEFAULT_CANCEL_AFTER_MS,
  WorkerCheckInput,
  WorkerCheckOutput,
  WorkerStatusInput,
  WorkerStatusOutput,
} from '../../../common/contracts/runtime-worker';
import type { WorkerResult } from '../../../common/contracts/worker-protocol';
import type { WorkerBridge } from '../../runtime-bridge/worker-bridge';
import type { CommandDefinition, CommandHandler } from '../router';

export const runtimeWorkerStatusCommand = {
  channel: Channels.runtimeWorkerStatus,
  input: WorkerStatusInput,
  output: WorkerStatusOutput,
} satisfies CommandDefinition<typeof WorkerStatusInput, typeof WorkerStatusOutput>;

export const runtimeWorkerCheckCommand = {
  channel: Channels.runtimeWorkerCheck,
  input: WorkerCheckInput,
  output: WorkerCheckOutput,
} satisfies CommandDefinition<typeof WorkerCheckInput, typeof WorkerCheckOutput>;

const STEP_TIMEOUT_MS = 5_000;

function outcome(result: WorkerResult<unknown>): WorkerCheckOutput['echo']['outcome'] {
  return result.ok ? 'ok' : result.error.code;
}

function statusNow(bridge: WorkerBridge): WorkerStatusOutput {
  return { ...bridge.status(), checkedAt: new Date().toISOString() };
}

/** M0 spike: read-only view of the worker's state. */
export function createWorkerStatusHandler(
  bridge: WorkerBridge,
): CommandHandler<typeof WorkerStatusInput, typeof WorkerStatusOutput> {
  return () => statusNow(bridge);
}

/**
 * M0 spike: exercises the real worker. Echo → start a slow count → cancel it → echo again to
 * read how many requests the worker still has running. If the worker had crashed, the first
 * echo starts a fresh one.
 */
export function createWorkerCheckHandler(
  bridge: WorkerBridge,
): CommandHandler<typeof WorkerCheckInput, typeof WorkerCheckOutput> {
  return async (input) => {
    const cancelAfterMs = input?.cancelAfterMs ?? DEFAULT_CANCEL_AFTER_MS;
    const started = performance.now();
    const echo = await bridge.request(
      'spike.echo',
      { text: 'check' },
      { timeoutMs: STEP_TIMEOUT_MS },
    );
    const roundTripMs = performance.now() - started;

    const controller = new AbortController();
    const slow = bridge.request(
      'spike.slowCount',
      // 1000 steps of 10 ms: ~10 s if the cancel didn't work, so a broken cancel is obvious.
      { to: 1000, stepMs: 10 },
      { signal: controller.signal, timeoutMs: 15_000 },
    );
    // Stop waiting early if the count already ended (e.g. the worker crashed).
    await Promise.race([delay(cancelAfterMs), slow]);
    controller.abort(); // no effect if it already ended
    const cancelled = await slow;

    const after = await bridge.request(
      'spike.echo',
      { text: 'after cancel' },
      { timeoutMs: STEP_TIMEOUT_MS },
    );

    return {
      echo: {
        outcome: outcome(echo),
        roundTripMs,
        workerPid: echo.ok ? echo.data.pid : null,
      },
      cancel: {
        outcome: outcome(cancelled),
        cancelledAfterMs: cancelAfterMs,
        activeAfterCancel: after.ok ? after.data.activeRequests : null,
      },
      status: statusNow(bridge),
    };
  };
}
