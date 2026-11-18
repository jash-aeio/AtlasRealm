import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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
import { openDeveloperSpikes } from './support/onboarding';

// M1-8 (#35): profile switching in the real built app. A switch reloads the window (no renderer
// state survives), the new profile shows none of the old one's data, the worker is a fresh
// process, the choice survives a restart, and a failed switch changes nothing.

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

async function launch(): Promise<void> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env: cleanEnv() });
  page = await app.firstWindow();
  await expectAppReady();
}

/** The app has read its profile and shows first launch or the main screen (M1-9). */
async function expectAppReady(): Promise<void> {
  await expect(
    page.locator('main[data-screen="onboarding"], main[data-screen="main"]'),
  ).toBeVisible();
}

test.beforeEach(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'atlas-e2e-profiles-'));
  await launch();
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

function workerMetrics(): Promise<number[]> {
  return app.evaluate(
    ({ app: electronApp }, name) =>
      electronApp
        .getAppMetrics()
        .filter((m) => m.type === 'Utility' && m.name === name)
        .map((m) => m.pid),
    SERVICE_NAME,
  );
}

async function activeProfileId(): Promise<string> {
  const result = await page.evaluate(() => window.atlas.profile.list());
  if (!result.ok) throw new Error(`profile.list failed: ${result.error.code}`);
  return result.data.activeProfileId;
}

async function worldNames(): Promise<string[]> {
  const result = await page.evaluate(() => window.atlas.world.list());
  if (!result.ok) throw new Error(`world.list failed: ${result.error.code}`);
  return result.data.worlds.map((w) => w.name);
}

async function createProfile(displayName: string): Promise<string> {
  const result = await page.evaluate(
    (name) => window.atlas.profile.create({ displayName: name }),
    displayName,
  );
  if (!result.ok) throw new Error(`profile.create failed: ${result.error.code}`);
  return result.data.profile.id;
}

/** Leaves a mark in the page's memory; a reload wipes it. */
async function markPage(): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { beforeSwitch?: boolean }).beforeSwitch = true;
  });
}

function pageIsMarked(): Promise<boolean> {
  return page.evaluate(
    () => (window as unknown as { beforeSwitch?: boolean }).beforeSwitch === true,
  );
}

/**
 * Switches and waits for the reload. The reply may or may not reach the page before it
 * reloads, so the evaluate is allowed to fail with a destroyed context; the state checks after
 * it are what count.
 */
async function switchAndWaitForReload(profileId: string): Promise<void> {
  await Promise.all([
    page.waitForEvent('load'),
    page
      .evaluate((id) => window.atlas.profile.switch({ profileId: id }), profileId)
      .then((result) => {
        expect(result).toEqual({ ok: true, data: { activeProfileId: profileId, reloading: true } });
      })
      .catch((error: unknown) => {
        if (!String(error).includes('context was destroyed')) throw error;
      }),
  ]);
  await expectAppReady();
}

test('switching reloads the window, isolates data, restarts the worker and survives a restart', async () => {
  const profileA = await activeProfileId();
  await page.evaluate(() => window.atlas.world.create({ name: 'Home A' }));
  const profileB = await createProfile('Work');
  const oldPid = await runningWorkerPid();
  await markPage();

  await switchAndWaitForReload(profileB);

  // A fresh page: nothing from before the switch survived in renderer memory.
  expect(await pageIsMarked()).toBe(false);
  expect(await activeProfileId()).toBe(profileB);
  expect(await worldNames()).toEqual([]);

  // A new worker process; the old one is gone.
  await expect.poll(async () => (await workerStatus()).pid).not.toBe(oldPid);
  const newPid = await runningWorkerPid();
  await expect.poll(workerMetrics).toEqual([newPid]);

  // The choice survives a restart, and switching back shows A's data again.
  await app.close();
  await launch();
  expect(await activeProfileId()).toBe(profileB);
  expect(await worldNames()).toEqual([]);
  await switchAndWaitForReload(profileA);
  expect(await worldNames()).toEqual(['Home A']);

  // After the switches, the worker panel (under Developer spikes, which A's world unlocks
  // without creating anything) shows the real, refreshed state.
  await openDeveloperSpikes(page);
  const currentPid = await runningWorkerPid();
  await page.getByRole('button', { name: 'Refresh worker status' }).click();
  await expect(page.getByTestId('worker-status')).toContainText(
    `Worker running · pid ${String(currentPid)}`,
  );
  expect(await worldNames()).toEqual(['Home A']);
});

test('a switch to a profile that cannot be opened changes nothing and does not reload', async () => {
  const profileA = await activeProfileId();
  await page.evaluate(() => window.atlas.world.create({ name: 'Home A' }));
  const broken = await createProfile('Broken');
  const databaseFile = join(userDataDir, 'profiles', broken, 'app.sqlite');
  rmSync(databaseFile);
  const pid = await runningWorkerPid();
  await markPage();

  const result = await page.evaluate(
    (id) => window.atlas.profile.switch({ profileId: id }),
    broken,
  );
  expect(result).toMatchObject({ ok: false, error: { code: 'profile_unavailable' } });

  expect(await pageIsMarked()).toBe(true);
  expect(await activeProfileId()).toBe(profileA);
  expect(await worldNames()).toEqual(['Home A']);
  expect((await workerStatus()).pid).toBe(pid);
  // No empty database was created in place of the missing one.
  expect(existsSync(databaseFile)).toBe(false);
});
