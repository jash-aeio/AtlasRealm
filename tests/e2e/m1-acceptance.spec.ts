import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  _electron as electron,
  type ElectronApplication,
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test';

import type { ProjectSummary } from '../../src/common/contracts/project';
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

async function launch(): Promise<void> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env: cleanEnv() });
  page = await app.firstWindow();
  await expect(
    page.locator('main[data-screen="onboarding"], main[data-screen="main"]'),
  ).toBeVisible();
}

test.beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'atlas-e2e-m1-'));
});

test.afterEach(async () => {
  await app.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

const screen = (name: string): Locator => page.locator(`main[data-screen="${name}"]`);
const item = (name: string): Locator => page.getByRole('listitem', { name, exact: true });
const message = (): Locator => page.getByTestId('projects-message');
const filter = (name: string): Locator =>
  page.getByRole('group', { name: 'Show projects' }).getByRole('button', { name, exact: true });

/**
 * Takes the network away from the whole app (main process and renderer) and records every
 * attempt to reach it, then reloads so the page starts again under those rules.
 */
async function goOffline(): Promise<void> {
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
  await expect(
    page.locator('main[data-screen="onboarding"], main[data-screen="main"]'),
  ).toBeVisible();
}

function networkAttempts(): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { __netAttempts: string[] }).__netAttempts);
}

/** First launch through the real UI (M1-9): continue as the profile, skip the avatar, name a world. */
async function onboardThroughUi(profileName: string, worldName: string): Promise<void> {
  await expect(screen('onboarding')).toBeVisible();
  await page.getByRole('button', { name: `Continue as ${profileName}` }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByLabel('World name').fill(worldName);
  await page.getByRole('button', { name: 'Create world' }).click();
  await expect(screen('main')).toBeVisible();
  await expect(page.getByTestId('world-name')).toHaveText(worldName);
}

async function createProjectThroughUi(name: string, goal = ''): Promise<void> {
  await page.getByRole('button', { name: 'New project' }).click();
  const form = page.getByRole('form', { name: 'New project' });
  await form.getByLabel('Project name').fill(name);
  if (goal !== '') await form.getByLabel('Goal (optional)').fill(goal);
  await form.getByRole('button', { name: 'Create project' }).click();
  await expect(message()).toHaveText(`Created “${name}”.`);
}

async function renameThroughUi(from: string, to: string): Promise<void> {
  await item(from).getByRole('button', { name: 'Rename' }).click();
  await item(from).getByLabel(`New name for ${from}`).fill(to);
  await page.keyboard.press('Enter');
  await expect(message()).toHaveText(`Renamed to “${to}”.`);
}

/** Opens a lifecycle confirmation on a row and confirms it. */
async function confirmAction(
  name: string,
  button: string,
  dialogName: string,
  confirm: string,
): Promise<void> {
  await item(name).getByRole('button', { name: button, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: dialogName });
  await dialog.getByRole('button', { name: confirm }).click();
  await expect(dialog).toBeHidden();
}

async function onlyWorldId(): Promise<string> {
  const result = await page.evaluate(() => window.atlas.world.list());
  if (!result.ok) throw new Error(`world.list failed: ${result.error.code}`);
  expect(result.data.worlds).toHaveLength(1);
  const world = result.data.worlds[0];
  if (world === undefined) throw new Error('no world');
  return world.id;
}

/** Every project of the world in one status (one page is plenty here). */
async function projects(
  worldId: string,
  status: ProjectSummary['status'] = 'active',
): Promise<ProjectSummary[]> {
  const result = await page.evaluate(
    ({ worldId, status }) => window.atlas.project.list({ worldId, status }),
    { worldId, status },
  );
  if (!result.ok) throw new Error(`project.list failed: ${result.error.code}`);
  expect(result.data.nextCursor).toBeNull();
  return result.data.projects;
}

async function activeProfileId(): Promise<string> {
  const result = await page.evaluate(() => window.atlas.profile.list());
  if (!result.ok) throw new Error(`profile.list failed: ${result.error.code}`);
  return result.data.activeProfileId;
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

test('Check: a project is created and reopened fully offline, across a restart', async () => {
  await launch();
  await goOffline();
  await onboardThroughUi('Default', 'Offline Vale');
  await createProjectThroughUi('Field notes', 'Write up the survey');
  expect(await networkAttempts()).toEqual([]);
  await app.close();

  // Offline again from the very first page of the second run.
  await launch();
  await goOffline();
  await expect(screen('main')).toBeVisible();
  const notes = item('Field notes');
  await expect(notes.getByTestId('project-status')).toHaveText('Active');
  await expect(notes.getByTestId('project-goal')).toHaveText('Write up the survey');

  // Reopened, not just listed: it can still be changed, and the change is saved.
  await notes.getByRole('button', { name: 'Edit goal' }).click();
  await notes.getByLabel('Goal of Field notes').fill('Survey written up');
  await notes.getByRole('button', { name: 'Save goal' }).click();
  await expect(notes.getByTestId('project-goal')).toHaveText('Survey written up');
  const [saved] = await projects(await onlyWorldId());
  expect(saved).toMatchObject({ name: 'Field notes', goal: 'Survey written up' });
  expect(await networkAttempts()).toEqual([]);
});

test('Check: a rename keeps the project identity across a restart', async () => {
  await launch();
  await onboardThroughUi('Default', 'Name Vale');
  await createProjectThroughUi('Draft');
  const worldId = await onlyWorldId();
  const [before] = await projects(worldId);
  if (before === undefined) throw new Error('no project');

  await renameThroughUi('Draft', 'Final draft');
  await app.close();
  await launch();
  await expect(item('Final draft')).toBeVisible();
  await expect(item('Draft')).toHaveCount(0);

  // The same record under a new name: one project, same ID and creation time, one revision on.
  const after = await projects(worldId);
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
  await onboardThroughUi('Default', 'Realm A');
  await createProjectThroughUi('Secret A', 'Only profile A may see this');
  const worldA = await onlyWorldId();
  const [secret] = await projects(worldA);
  if (secret === undefined) throw new Error('no project');
  const profileA = await activeProfileId();
  const pidA = await workerPidShown();

  // Settings: create profile B and switch to it, as a user would.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('New profile name').fill('Work');
  await page.getByRole('button', { name: 'Create profile' }).click();
  // The open spike panels have status outputs of their own, so find this one by its text.
  await expect(
    page.getByRole('status').filter({ hasText: 'Created “Work”. Use Switch to open it.' }),
  ).toBeVisible();
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Switch to Work' }).click(),
  ]);

  // B has its own first launch: none of A's world came along.
  await onboardThroughUi('Work', 'Realm B');
  expect(await activeProfileId()).not.toBe(profileA);
  await expect(page.getByTestId('projects-summary')).toHaveText(
    'No active projects in this world yet.',
  );
  await page.getByLabel('Search projects').fill('Secret');
  await expect(page.getByTestId('projects-summary')).toHaveText(
    'No active projects match “Secret”.',
  );
  for (const status of ['archived', 'trashed'] as const) {
    expect(await projects(await onlyWorldId(), status)).toEqual([]);
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
  await page.getByRole('button', { name: 'Settings' }).click();
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Switch to Default' }).click(),
  ]);
  await expect(screen('main')).toBeVisible();
  await expect(item('Secret A').getByTestId('project-goal')).toHaveText(
    'Only profile A may see this',
  );
  expect(await projects(worldA)).toEqual([secret]);
});

/** sha256, size and modification time of each file, plus the listing of each folder. */
function snapshot(files: readonly string[], folders: readonly string[]): unknown {
  return {
    files: files.map((file) => {
      const stat = statSync(file);
      return {
        file,
        sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      };
    }),
    folders: folders.map((folder) => ({ folder, entries: readdirSync(folder).sort() })),
  };
}

test('Check: archive and trash never touch files outside the profile folder', async () => {
  await launch();
  await onboardThroughUi('Default', 'File Vale');
  const profileDir = join(userDataDir, 'profiles', await activeProfileId());
  expect(statSync(profileDir).isDirectory()).toBe(true);

  // "External" files next to the profile folder. One folder is named exactly like the project,
  // so a delete that went by name would hit it.
  const nextToProfile = join(userDataDir, 'profiles', 'External Project');
  const besideUserData = join(userDataDir, 'External Project');
  const unicodeDir = join(userDataDir, 'Ünïcødé bilder 图');
  for (const dir of [nextToProfile, besideUserData, unicodeDir]) mkdirSync(dir);
  const files = [
    join(nextToProfile, 'notes.md'),
    join(besideUserData, 'plan.txt'),
    join(unicodeDir, 'karte 地图.bin'),
  ];
  writeFileSync(files[0] ?? '', '# Notes\nKeep me.\n');
  writeFileSync(files[1] ?? '', 'Plan: do not delete.\r\n');
  writeFileSync(
    files[2] ?? '',
    Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 31) % 256)),
  );
  const folders = [nextToProfile, besideUserData, unicodeDir];
  const before = snapshot(files, folders);

  // Every lifecycle change the UI offers: archive → restore → trash → restore → archive → trash.
  const name = 'External Project';
  await createProjectThroughUi(name);
  await confirmAction(name, 'Archive', `Archive “${name}”?`, 'Archive project');
  await filter('Archived').click();
  await confirmAction(name, 'Restore', `Restore “${name}”?`, 'Restore project');
  await filter('Active').click();
  await confirmAction(name, 'Move to trash', `Move “${name}” to the trash?`, 'Move to trash');
  await filter('Trash').click();
  await confirmAction(
    name,
    'Restore from trash',
    `Restore “${name}” from the trash?`,
    'Restore project',
  );
  await filter('Active').click();
  await confirmAction(name, 'Archive', `Archive “${name}”?`, 'Archive project');
  await filter('Archived').click();
  await confirmAction(name, 'Move to trash', `Move “${name}” to the trash?`, 'Move to trash');
  await filter('Trash').click();
  await expect(item(name).getByTestId('project-status')).toHaveText('In trash');

  // Quit so nothing is still pending, then compare byte for byte.
  await app.close();
  expect(snapshot(files, folders)).toEqual(before);

  // The project itself is only trashed (recoverable), not deleted.
  await launch();
  const [trashed] = await projects(await onlyWorldId(), 'trashed');
  expect(trashed).toMatchObject({ name, status: 'trashed' });
  expect(snapshot(files, folders)).toEqual(before);
});
