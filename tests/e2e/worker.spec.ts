import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  _electron as electron,
  type ElectronApplication,
  expect,
  type Page,
  test,
} from '@playwright/test';

import type { WorkerStatusOutput } from '../../src/common/contracts/runtime-worker';

// M0-6 (#9): the built app forks a real utility process. These tests drive it through the
// spike IPC commands and the "Worker check (M0 spike)" panel, then kill the process from
// outside to prove a crash is detected, reported and recovered from.

const SERVICE_NAME = 'Atlas Realm worker'; // utility-transport.ts WORKER_SERVICE_NAME

let userDataDir: string;
let app: ElectronApplication;
let page: Page;

const cleanEnv = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== 'ELECTRON_RENDERER_URL',
    ),
  );

test.beforeEach(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'atlas-e2e-worker-'));
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env: cleanEnv() });
  page = await app.firstWindow();
});

test.afterEach(async () => {
  await app.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

async function workerStatus(): Promise<WorkerStatusOutput> {
  const result = await page.evaluate(() => window.atlas.runtime.workerStatus());
  if (!result.ok) throw new Error(`workerStatus failed: ${result.error.code}`);
  return result.data;
}

async function runningWorkerPid(): Promise<number> {
  await expect.poll(async () => (await workerStatus()).state).toBe('running');
  const { pid } = await workerStatus();
  if (pid === null) throw new Error('running worker has no pid');
  return pid;
}

/** Utility processes Electron reports for our worker's service name. */
async function workerMetrics(): Promise<number[]> {
  return app.evaluate(
    ({ app: electronApp }, name) =>
      electronApp
        .getAppMetrics()
        .filter((m) => m.type === 'Utility' && m.name === name)
        .map((m) => m.pid),
    SERVICE_NAME,
  );
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0: existence check only
    return true;
  } catch {
    return false;
  }
}

test('main spawns the worker at startup as a separate utility process', async () => {
  const pid = await runningWorkerPid();
  expect(await workerMetrics()).toEqual([pid]);
  const mainPid = await app.evaluate(() => process.pid);
  expect(pid).not.toBe(mainPid);
  await expect(page.getByTestId('worker-status')).toContainText(
    `Worker running · pid ${String(pid)}`,
  );
});

test('worker check: echo round-trip, and an in-flight slow count is really cancelled', async () => {
  const pid = await runningWorkerPid();
  await page.getByRole('button', { name: 'Run worker check' }).click();
  await expect(page.getByTestId('worker-check')).toContainText(
    'slow count cancelled after 100 ms, 0 still running',
  );
  await expect(page.getByTestId('worker-check')).toContainText('echo ok in');

  const started = Date.now();
  const result = await page.evaluate(() => window.atlas.runtime.workerCheck());
  // A cancel that didn't work would take ~10 s (1000 steps of 10 ms).
  expect(Date.now() - started).toBeLessThan(3_000);
  expect(result).toMatchObject({
    ok: true,
    data: {
      echo: { outcome: 'ok', workerPid: pid },
      cancel: { outcome: 'cancelled', activeAfterCancel: 0 },
      status: { state: 'running', crashCount: 0 },
    },
  });
  // The worker's own late "cancelled" replies were dropped, not delivered (one per check).
  expect((await workerStatus()).staleRepliesDropped).toBe(2);
});

test('a killed worker is reported as crashed, the app keeps working, and the next check recovers', async () => {
  const pid = await runningWorkerPid();
  process.kill(pid); // from outside, like a crash: main didn't ask for it

  await expect.poll(async () => (await workerStatus()).state).toBe('crashed');
  const crashed = await workerStatus();
  expect(crashed).toMatchObject({ pid: null, crashCount: 1 });
  expect(crashed.lastExitCode).not.toBeNull();
  expect(crashed.lastExitCode).not.toBe(0);
  expect(await workerMetrics()).toEqual([]);

  // The rest of the app is unaffected.
  const ping = await page.evaluate(() => window.atlas.app.ping({ message: 'still here' }));
  expect(ping.ok).toBe(true);

  await page.getByRole('button', { name: 'Refresh worker status' }).click();
  await expect(page.getByTestId('worker-status')).toContainText('Worker crashed');
  await expect(page.getByTestId('worker-status')).toContainText('crashes 1');

  // The next request starts a fresh worker. The crash stays in the record.
  await page.getByRole('button', { name: 'Run worker check' }).click();
  await expect(page.getByTestId('worker-check')).toContainText('0 still running');
  const recovered = await workerStatus();
  expect(recovered).toMatchObject({ state: 'running', crashCount: 1 });
  expect(recovered.pid).not.toBe(pid);
  expect(await workerMetrics()).toEqual([recovered.pid]);
});

test('a crash during an in-flight request fails it with worker_crashed instead of hanging', async () => {
  const pid = await runningWorkerPid();
  // The check echoes, then keeps a slow count in flight for 3 s before it would cancel it.
  const check = page.evaluate(() => window.atlas.runtime.workerCheck({ cancelAfterMs: 3_000 }));
  // Let the echo finish so the slow count is the request in flight, then kill the worker.
  await expect.poll(async () => (await workerStatus()).pendingRequests).toBe(1);
  await page.waitForTimeout(300);
  expect((await workerStatus()).pendingRequests).toBe(1);
  const killedAt = Date.now();
  process.kill(pid);
  const result = await check;
  // It ended because the crash was detected, well before the 3 s cancel would have fired.
  expect(Date.now() - killedAt).toBeLessThan(2_000);
  if (!result.ok) throw new Error(`workerCheck failed: ${result.error.code}`);
  expect(result.data.echo.outcome).toBe('ok');
  expect(result.data.cancel.outcome).toBe('worker_crashed');
  expect(result.data.status.crashCount).toBe(1);
});

test('quitting the app stops the worker process', async () => {
  const pid = await runningWorkerPid();
  expect(isAlive(pid)).toBe(true);
  await app.close();
  await expect.poll(() => isAlive(pid), { timeout: 5_000 }).toBe(false);
  // afterEach closes again; relaunch so it has something to close.
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env: cleanEnv() });
  page = await app.firstWindow();
});
