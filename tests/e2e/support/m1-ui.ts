// UI steps and file checks shared by the M1 acceptance tests (M1-11, #38): the dev build
// (tests/e2e/m1-acceptance.spec.ts) and the packaged build (tests/e2e-packaged). They drive
// the same screens a user sees; IPC calls are used only to read back what was saved.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, type Locator, type Page } from '@playwright/test';

import type { ProjectSummary } from '../../../src/common/contracts/project';

export const screen = (page: Page, name: string): Locator =>
  page.locator(`main[data-screen="${name}"]`);
export const item = (page: Page, name: string): Locator =>
  page.getByRole('listitem', { name, exact: true });
export const projectsMessage = (page: Page): Locator => page.getByTestId('projects-message');
export const filter = (page: Page, name: string): Locator =>
  page.getByRole('group', { name: 'Show projects' }).getByRole('button', { name, exact: true });

/** First launch through the real UI (M1-9): continue as the profile, skip the avatar, name a world. */
export async function onboardThroughUi(
  page: Page,
  profileName: string,
  worldName: string,
): Promise<void> {
  await expect(screen(page, 'onboarding')).toBeVisible();
  await page.getByRole('button', { name: `Continue as ${profileName}` }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByLabel('World name').fill(worldName);
  await page.getByRole('button', { name: 'Create world' }).click();
  await expect(screen(page, 'main')).toBeVisible();
  await expect(page.getByTestId('world-name')).toHaveText(worldName);
}

export async function createProjectThroughUi(page: Page, name: string, goal = ''): Promise<void> {
  await page.getByRole('button', { name: 'New project' }).click();
  const form = page.getByRole('form', { name: 'New project' });
  await form.getByLabel('Project name').fill(name);
  if (goal !== '') await form.getByLabel('Goal (optional)').fill(goal);
  await form.getByRole('button', { name: 'Create project' }).click();
  await expect(projectsMessage(page)).toHaveText(`Created “${name}”.`);
}

export async function renameThroughUi(page: Page, from: string, to: string): Promise<void> {
  await item(page, from).getByRole('button', { name: 'Rename' }).click();
  await item(page, from).getByLabel(`New name for ${from}`).fill(to);
  await page.keyboard.press('Enter');
  await expect(projectsMessage(page)).toHaveText(`Renamed to “${to}”.`);
}

export async function editGoalThroughUi(page: Page, name: string, goal: string): Promise<void> {
  const row = item(page, name);
  await row.getByRole('button', { name: 'Edit goal' }).click();
  await row.getByLabel(`Goal of ${name}`).fill(goal);
  await row.getByRole('button', { name: 'Save goal' }).click();
  await expect(row.getByTestId('project-goal')).toHaveText(goal);
}

/** Opens a lifecycle confirmation on a row and confirms it. */
async function confirmAction(
  page: Page,
  name: string,
  button: string,
  dialogName: string,
  confirm: string,
): Promise<void> {
  await item(page, name).getByRole('button', { name: button, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: dialogName });
  await dialog.getByRole('button', { name: confirm }).click();
  await expect(dialog).toBeHidden();
}

/**
 * Every lifecycle change the UI offers, from Active: archive → restore → trash → restore from
 * trash → archive → trash. Ends with the project in the trash, shown under the Trash filter.
 */
export async function runEveryLifecycleChange(page: Page, name: string): Promise<void> {
  await filter(page, 'Active').click();
  await confirmAction(page, name, 'Archive', `Archive “${name}”?`, 'Archive project');
  await filter(page, 'Archived').click();
  await confirmAction(page, name, 'Restore', `Restore “${name}”?`, 'Restore project');
  await filter(page, 'Active').click();
  await confirmAction(page, name, 'Move to trash', `Move “${name}” to the trash?`, 'Move to trash');
  await filter(page, 'Trash').click();
  await confirmAction(
    page,
    name,
    'Restore from trash',
    `Restore “${name}” from the trash?`,
    'Restore project',
  );
  await filter(page, 'Active').click();
  await confirmAction(page, name, 'Archive', `Archive “${name}”?`, 'Archive project');
  await filter(page, 'Archived').click();
  await confirmAction(page, name, 'Move to trash', `Move “${name}” to the trash?`, 'Move to trash');
  await filter(page, 'Trash').click();
  await expect(item(page, name).getByTestId('project-status')).toHaveText('In trash');
}

export async function onlyWorldId(page: Page): Promise<string> {
  const result = await page.evaluate(() => window.atlas.world.list());
  if (!result.ok) throw new Error(`world.list failed: ${result.error.code}`);
  expect(result.data.worlds).toHaveLength(1);
  const world = result.data.worlds[0];
  if (world === undefined) throw new Error('no world');
  return world.id;
}

/** Every project of the world in one status (one page is plenty in these tests). */
export async function listProjects(
  page: Page,
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

export async function activeProfileId(page: Page): Promise<string> {
  const result = await page.evaluate(() => window.atlas.profile.list());
  if (!result.ok) throw new Error(`profile.list failed: ${result.error.code}`);
  return result.data.activeProfileId;
}

export interface ExternalFixtures {
  readonly files: readonly string[];
  readonly folders: readonly string[];
}

/**
 * Writes "external" files outside the profile folder: next to it in profiles/, and beside it
 * in userData, one binary with a non-ASCII path. Two folders are named `projectName`, so a
 * delete that went by project name would hit them.
 */
export function writeExternalFixtures(userData: string, projectName: string): ExternalFixtures {
  const nextToProfile = join(userData, 'profiles', projectName);
  const besideUserData = join(userData, projectName);
  const unicodeDir = join(userData, 'Ünïcødé bilder 图');
  const folders = [nextToProfile, besideUserData, unicodeDir];
  for (const dir of folders) mkdirSync(dir);
  const contents: [string, string | Buffer][] = [
    [join(nextToProfile, 'notes.md'), '# Notes\nKeep me.\n'],
    [join(besideUserData, 'plan.txt'), 'Plan: do not delete.\r\n'],
    [
      join(unicodeDir, 'karte 地图.bin'),
      Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 31) % 256)),
    ],
  ];
  for (const [file, data] of contents) writeFileSync(file, data);
  return { files: contents.map(([file]) => file), folders };
}

/** sha256, size and modification time of each file, plus the listing of each folder. */
export function snapshotFixtures({ files, folders }: ExternalFixtures): unknown {
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
