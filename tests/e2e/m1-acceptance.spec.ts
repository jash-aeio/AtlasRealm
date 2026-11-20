import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  _electron as electron,
  type ElectronApplication,
  expect,
  type Page,
  test,
} from '@playwright/test';

import {
  activeProfileId,
  createProjectThroughUi,
  editGoalThroughUi,
  item,
  listProjects,
  onboardThroughUi,
  onlyWorldId,
  renameThroughUi,
  runEveryLifecycleChange,
  screen,
  snapshotFixtures,
  writeExternalFixtures,
} from './support/m1-ui';
import { openDeveloperSpikes } from './support/onboarding';

// M1-11 (#38): the M1 Checks (ROADMAP_SPEC M1) proven end to end in the real built app,
// through the UI a user sees. The packaged build repeats the offline, identity and external
// file checks in tests/e2e-packaged/packaged.spec.ts.

const cleanEnv = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== 'ELECTRON_RENDERER_URL',
    ),
  );

let userDataDir: string;
let app: ElectronApplication;
let page: Page;

async function expectAppReady(): Promise<void> {
  await expect(
    page.locator('main[data-screen="onboarding"], main[data-screen="main"]'),
  ).toBeVisible();
}

async function launch(): Promise<void> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env: cleanEnv() });
  page = await app.firstWindow();
  await expectAppReady();
}

test.beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'atlas-e2e-m1-'));
});

test.afterEach(async () => {
  await app.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

/** Requests the page CSP (connect-src 'self') refused before they became requests. */
let cspRefusals: string[] = [];

/**
 * Takes the network away from the whole app (main process and renderer) and records every
 * attempt to reach it, then reloads so the page starts again under those rules. A request
 * that the CSP refuses never reaches the session, so CSP console errors are recorded too.
 */
async function goOffline(): Promise<void> {
  cspRefusals = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) cspRefusals.push(message.text());
  });
  await app.evaluate(({ session }) => {
    const attempts: string[] = [];
    (globalThis as unknown as { __netAttempts: string[] }).__netAttempts = attempts;
    session.defaultSession.enableNetworkEmulation({ offline: true });
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (details, callback) => {
        attempts.push(details.url);
        callback({ cancel: true });
      },
    );
  });
  await page.reload();
  await expectAppReady();
}

async function networkAttempts(): Promise<string[]> {
  const fromSession = await app.evaluate(
    () => (globalThis as unknown as { __netAttempts: string[] }).__netAttempts,
  );
  return [...fromSession, ...cspRefusals];
}

/** Positive control: one deliberate attempt from main and one from the page are both recorded. */
async function expectRecorderWorks(): Promise<void> {
  await app.evaluate(({ net }) => net.fetch('https://example.invalid/main').catch(() => undefined));
  await page.evaluate(() => fetch('https://example.invalid/page').catch(() => undefined));
  await expect
    .poll(async () => {
      const attempts = await networkAttempts();
      return ['example.invalid/main', 'example.invalid/page'].map((url) =>
        attempts.some((attempt) => attempt.includes(url)),
      );
    })
    .toEqual([true, true]);
}

/** The worker pid exactly as the Developer spikes panel shows it to the user. */
async function workerPidShown(): Promise<number> {
  await openDeveloperSpikes(page);
  const status = page.getByTestId('worker-status');
  await expect(status).toContainText('Worker running · pid');
  const match = /pid (\d+)/.exec(await status.innerText());
  if (match?.[1] === undefined) throw new Error('worker panel shows no pid');
  return Number(match[1]);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0: existence check only
    return true;
  } catch {
    return false;
  }
}

async function switchProfileInSettings(displayName: string): Promise<void> {
  const settings = page.getByRole('button', { name: 'Settings' });
  // Settings may already be open (it replaces that button with "Back to world").
  if (await settings.isVisible()) await settings.click();
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: `Switch to ${displayName}` }).click(),
  ]);
  await expectAppReady();
}

test('Check: a project is created and reopened fully offline, across a restart', async () => {
  await launch();
  await goOffline();
  await onboardThroughUi(page, 'Default', 'Offline Vale');
  await createProjectThroughUi(page, 'Field notes', 'Write up the survey');
  expect(await networkAttempts()).toEqual([]);
  await app.close();

  // Offline again from the very first page of the second run.
  await launch();
  await goOffline();
  await expect(screen(page, 'main')).toBeVisible();
  const notes = item(page, 'Field notes');
  await expect(notes.getByTestId('project-status')).toHaveText('Active');
  await expect(notes.getByTestId('project-goal')).toHaveText('Write up the survey');

  // Reopened, not just listed: it can still be changed, and the change is saved.
  await editGoalThroughUi(page, 'Field notes', 'Survey written up');
  const [saved] = await listProjects(page, await onlyWorldId(page));
  expect(saved).toMatchObject({ name: 'Field notes', goal: 'Survey written up' });
  expect(await networkAttempts()).toEqual([]);
  await expectRecorderWorks();
});

test('Check: a rename keeps the project identity across a restart', async () => {
  await launch();
  await onboardThroughUi(page, 'Default', 'Name Vale');
  await createProjectThroughUi(page, 'Draft');
  const worldId = await onlyWorldId(page);
  const [before] = await listProjects(page, worldId);
  if (before === undefined) throw new Error('no project');

  await renameThroughUi(page, 'Draft', 'Final draft');
  await app.close();
  await launch();
  await expect(item(page, 'Final draft')).toBeVisible();
  await expect(item(page, 'Draft')).toHaveCount(0);

  // The same record under a new name: one project, same ID and creation time, one revision on.
  const after = await listProjects(page, worldId);
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({
    id: before.id,
    worldId,
    name: 'Final draft',
    createdAt: before.createdAt,
    templateId: before.templateId,
    revision: before.revision + 1,
  });
  const got = await page.evaluate((ref) => window.atlas.project.get(ref), {
    worldId,
    projectId: before.id,
  });
  expect(got).toMatchObject({
    ok: true,
    data: { project: { id: before.id, name: 'Final draft' } },
  });
});

test('Check: profiles are isolated through the UI, and a switch visibly replaces the worker', async () => {
  await launch();
  await onboardThroughUi(page, 'Default', 'Realm A');
  await createProjectThroughUi(page, 'Secret A', 'Only profile A may see this');
  const worldA = await onlyWorldId(page);
  const [secret] = await listProjects(page, worldA);
  if (secret === undefined) throw new Error('no project');
  const profileA = await activeProfileId(page);
  const pidA = await workerPidShown();

  // Settings: create profile B and switch to it, as a user would.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('New profile name').fill('Work');
  await page.getByRole('button', { name: 'Create profile' }).click();
  // The open spike panels have status outputs of their own, so find this one by its text.
  await expect(
    page.getByRole('status').filter({ hasText: 'Created “Work”. Use Switch to open it.' }),
  ).toBeVisible();
  await switchProfileInSettings('Work');

  // B has its own first launch: none of A's world came along.
  await onboardThroughUi(page, 'Work', 'Realm B');
  expect(await activeProfileId(page)).not.toBe(profileA);
  await expect(page.getByTestId('projects-summary')).toHaveText(
    'No active projects in this world yet.',
  );
  await page.getByLabel('Search projects').fill('Secret');
  await expect(page.getByTestId('projects-summary')).toHaveText(
    'No active projects match “Secret”.',
  );
  const worldB = await onlyWorldId(page);
  for (const status of ['archived', 'trashed'] as const) {
    expect(await listProjects(page, worldB, status)).toEqual([]);
  }

  // Through the application services (§22.2 #23): A's exact IDs get nothing from B.
  const forged = await page.evaluate(
    async ({ worldId, projectId, revision }) => ({
      get: await window.atlas.project.get({ worldId, projectId }),
      list: await window.atlas.project.list({ worldId }),
      rename: await window.atlas.project.rename({
        worldId,
        projectId,
        expectedRevision: revision,
        name: 'Taken over',
      }),
      trash: await window.atlas.project.trash({ worldId, projectId, expectedRevision: revision }),
      create: await window.atlas.project.create({
        worldId,
        templateId: 'builtin.generic',
        templateVersion: '1.0.0',
        name: 'Planted',
      }),
    }),
    { worldId: worldA, projectId: secret.id, revision: secret.revision },
  );
  for (const result of Object.values(forged)) {
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  }

  // The worker panel shows a new process, and the old one has really exited.
  const pidB = await workerPidShown();
  expect(pidB).not.toBe(pidA);
  await expect.poll(() => isAlive(pidA), { timeout: 5_000 }).toBe(false);

  // Back to A: its project is untouched by everything B tried.
  await switchProfileInSettings('Default');
  await expect(screen(page, 'main')).toBeVisible();
  await expect(item(page, 'Secret A').getByTestId('project-goal')).toHaveText(
    'Only profile A may see this',
  );
  expect(await listProjects(page, worldA)).toEqual([secret]);
});

test('Check: archive and trash never touch files outside the profile folder', async () => {
  await launch();
  await onboardThroughUi(page, 'Default', 'File Vale');
  const profileDir = join(userDataDir, 'profiles', await activeProfileId(page));
  expect(statSync(profileDir).isDirectory()).toBe(true);

  const name = 'External Project';
  const fixtures = writeExternalFixtures(userDataDir, name);
  const before = snapshotFixtures(fixtures);

  await createProjectThroughUi(page, name);
  await runEveryLifecycleChange(page, name);

  // Quit so nothing is still pending, then compare byte for byte.
  await app.close();
  expect(snapshotFixtures(fixtures)).toEqual(before);

  // The project itself is only trashed (recoverable), not deleted.
  await launch();
  const [trashed] = await listProjects(page, await onlyWorldId(page), 'trashed');
  expect(trashed).toMatchObject({ name, status: 'trashed' });
  expect(snapshotFixtures(fixtures)).toEqual(before);
});
