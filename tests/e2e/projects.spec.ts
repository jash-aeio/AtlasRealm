import { mkdtempSync, rmSync } from 'node:fs';
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

import { finishOnboarding } from './support/onboarding';

// M1-10 (#37): the conventional project list in the real built app. Create from a template,
// rename, edit the goal, archive / restore, trash / restore with confirmations that say what
// does not happen, search and paging, stale-revision handling, and keyboard-only use.

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
  await finishOnboarding(page);
}

test.beforeEach(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'atlas-e2e-projects-'));
  await launch();
});

test.afterEach(async () => {
  await app.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

async function worldId(): Promise<string> {
  const result = await page.evaluate(() => window.atlas.world.list());
  if (!result.ok) throw new Error(`world.list failed: ${result.error.code}`);
  const world = result.data.worlds[0];
  if (world === undefined) throw new Error('no world');
  return world.id;
}

/** Creates projects behind the UI's back, the way another window or a script would. */
async function createProjects(names: readonly string[], goal = ''): Promise<void> {
  const id = await worldId();
  await page.evaluate(
    async ({ id, names, goal }) => {
      for (const name of names) {
        const result = await window.atlas.project.create({
          worldId: id,
          templateId: 'builtin.generic',
          templateVersion: '1.0.0',
          name,
          goal,
        });
        if (!result.ok) throw new Error(result.error.code);
      }
    },
    { id, names, goal },
  );
}

const filter = (name: string): Locator =>
  page.getByRole('group', { name: 'Show projects' }).getByRole('button', { name, exact: true });
const item = (name: string): Locator => page.getByRole('listitem', { name, exact: true });
const summary = (): Locator => page.getByTestId('projects-summary');
const message = (): Locator => page.getByTestId('projects-message');

/** Presses Tab until `target` has focus: proves it is reachable by keyboard alone. */
async function tabTo(target: Locator, maxPresses = 60): Promise<void> {
  for (let i = 0; i < maxPresses; i++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`could not reach ${target.toString()} with Tab`);
}

test('creates a project from a template by keyboard alone, and it survives a restart', async () => {
  await expect(summary()).toHaveText('No active projects in this world yet.');

  await tabTo(page.getByRole('button', { name: 'New project' }));
  await page.keyboard.press('Enter');
  const form = page.getByRole('form', { name: 'New project' });
  await expect(form).toBeVisible();

  // Real template metadata from resources/project-templates, not placeholder text.
  const generic = form.getByRole('radio', { name: /Generic Project/ });
  await expect(generic).toBeChecked();
  await expect(form).toContainText('For any work without a specialized template');
  await expect(form).toContainText('Template metadata only');
  await expect(form).toContainText('Will also ask for (in a later update): Requirements');
  const campaign = form.getByRole('radio', { name: /Content Campaign/ });
  await expect(campaign).toBeVisible();

  // Arrow keys move between radio buttons; pick Content Campaign.
  await generic.focus();
  await page.keyboard.press('ArrowDown');
  await expect(campaign).toBeChecked();

  await tabTo(form.getByLabel('Project name'));
  await page.keyboard.type('Spring newsletter');
  await page.keyboard.press('Tab');
  await expect(form.getByLabel('Goal (optional)')).toBeFocused();
  await page.keyboard.type('Three posts for April');
  await tabTo(form.getByRole('button', { name: 'Create project' }));
  await page.keyboard.press('Enter');

  await expect(form).toBeHidden();
  await expect(message()).toHaveText('Created “Spring newsletter”.');
  await expect(page.getByRole('button', { name: 'New project' })).toBeFocused();
  const created = item('Spring newsletter');
  await expect(created.getByTestId('project-status')).toHaveText('Active');
  await expect(created).toContainText('Template: Content Campaign');
  await expect(created.getByTestId('project-goal')).toHaveText('Three posts for April');

  // An invalid name is caught before anything is sent.
  await page.getByRole('button', { name: 'New project' }).click();
  await form.getByRole('button', { name: 'Create project' }).click();
  await expect(form.getByRole('alert')).toHaveText('Enter a name.');
  await page.keyboard.press('Escape');
  await expect(form).toBeHidden();

  await app.close();
  await launch();
  await expect(item('Spring newsletter')).toBeVisible();
  await expect(summary()).toHaveText('Showing 1 active project.');
});

test('a project with no building still appears, and can be renamed and given a goal', async () => {
  // Made through the API: nothing in the world represents it.
  await createProjects(['Alpha']);
  await page.reload();
  const alpha = item('Alpha');
  await expect(alpha.getByTestId('project-goal')).toHaveText('No goal yet.');

  await alpha.getByRole('button', { name: 'Rename' }).click();
  const nameField = alpha.getByLabel('New name for Alpha');
  await expect(nameField).toBeFocused();
  await nameField.fill('Alpha Prime');
  await page.keyboard.press('Enter');
  await expect(message()).toHaveText('Renamed to “Alpha Prime”.');
  const prime = item('Alpha Prime');
  await expect(prime.getByRole('button', { name: 'Rename' })).toBeFocused();

  await prime.getByRole('button', { name: 'Edit goal' }).click();
  await prime.getByLabel('Goal of Alpha Prime').fill('Ship the first draft');
  await prime.getByRole('button', { name: 'Save goal' }).click();
  await expect(prime.getByTestId('project-goal')).toHaveText('Ship the first draft');

  // Escape closes the editor without saving.
  await prime.getByRole('button', { name: 'Edit goal' }).click();
  await prime.getByLabel('Goal of Alpha Prime').fill('Not saved');
  await page.keyboard.press('Escape');
  await expect(prime.getByTestId('project-goal')).toHaveText('Ship the first draft');
});

test('archive, restore, trash and restore from trash say what does not happen', async () => {
  await createProjects(['Beta']);
  await page.reload();

  // Escape cancels and puts focus back on the button that opened the dialog.
  const archiveButton = item('Beta').getByRole('button', { name: 'Archive' });
  await archiveButton.click();
  let dialog = page.getByRole('dialog', { name: 'Archive “Beta”?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(archiveButton).toBeFocused();
  await expect(item('Beta').getByTestId('project-status')).toHaveText('Active');

  // Archive.
  await archiveButton.click();
  await expect(dialog).toContainText('No files are moved or deleted.');
  await expect(dialog).toContainText('Nothing is deleted');
  await expect(dialog).toContainText('No AI runs exist yet, so there is nothing to stop.');
  await dialog.getByRole('button', { name: 'Archive project' }).click();
  await expect(dialog).toBeHidden();
  await expect(message()).toContainText('Archived “Beta”. Find it under Archived.');
  await expect(message()).toContainText('Run handling arrives in a later update.');
  await expect(item('Beta')).toBeHidden();
  // The row is gone, so focus lands on the list heading rather than nowhere.
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeFocused();

  await filter('Archived').click();
  await expect(filter('Archived')).toHaveAttribute('aria-pressed', 'true');
  await expect(item('Beta').getByTestId('project-status')).toHaveText('Archived');

  // Trash it from Archived, then restore it: it goes back to Archived.
  await item('Beta').getByRole('button', { name: 'Move to trash' }).click();
  dialog = page.getByRole('dialog', { name: 'Move “Beta” to the trash?' });
  await expect(dialog).toContainText('Nothing is permanently deleted');
  await expect(dialog).toContainText('No files are moved or deleted.');
  await dialog.getByRole('button', { name: 'Move to trash' }).click();
  await expect(summary()).toHaveText('No archived projects.');

  await filter('Trash').click();
  const trashed = item('Beta');
  await expect(trashed.getByTestId('project-status')).toHaveText('In trash');
  // A trashed project can't be edited.
  await expect(trashed.getByRole('button', { name: 'Rename' })).toHaveCount(0);
  await trashed.getByRole('button', { name: 'Restore from trash' }).click();
  dialog = page.getByRole('dialog', { name: 'Restore “Beta” from the trash?' });
  await expect(dialog).toContainText('Archived if it was archived before');
  await dialog.getByRole('button', { name: 'Restore project' }).click();
  await expect(summary()).toHaveText('The trash is empty.');

  await filter('Archived').click();
  await item('Beta').getByRole('button', { name: 'Restore' }).click();
  await page
    .getByRole('dialog', { name: 'Restore “Beta”?' })
    .getByRole('button', { name: 'Restore project' })
    .click();
  await filter('Active').click();
  await expect(item('Beta').getByTestId('project-status')).toHaveText('Active');
});

test('pages with Load more, and search finds projects that are not loaded yet', async () => {
  const names = Array.from({ length: 60 }, (_, i) => `Project ${String(i + 1).padStart(2, '0')}`);
  await createProjects(names);
  await createProjects(['Zeta newsletter'], 'Quarterly community update');
  await page.reload();

  await expect(summary()).toHaveText('Showing 50 active projects. More are available below.');
  await expect(item('Zeta newsletter')).toBeHidden();

  // Search by goal reaches past the first page.
  const search = page.getByLabel('Search projects');
  await search.fill('community');
  await expect(summary()).toHaveText('1 active project matches “community”.');
  await expect(item('Zeta newsletter')).toBeVisible();
  await search.fill('nothing like this');
  await expect(summary()).toHaveText('No active projects match “nothing like this”.');
  await search.fill('');
  await expect(summary()).toHaveText('Showing 61 active projects.');

  // A fresh list pages with Load more.
  await page.reload();
  await page.getByRole('button', { name: 'Load more projects' }).click();
  await expect(summary()).toHaveText('Showing 61 active projects.');
  await expect(page.getByRole('button', { name: 'Load more projects' })).toHaveCount(0);
});

test('a project changed elsewhere shows a clear reload message', async () => {
  await createProjects(['Gamma']);
  await page.reload();
  await expect(item('Gamma')).toBeVisible();

  // Rename it behind the UI's back, so the list holds an old revision.
  const id = await worldId();
  await page.evaluate(async (worldId) => {
    const list = await window.atlas.project.list({ worldId });
    if (!list.ok) throw new Error(list.error.code);
    const gamma = list.data.projects[0];
    if (gamma === undefined) throw new Error('no project');
    const renamed = await window.atlas.project.rename({
      worldId,
      projectId: gamma.id,
      expectedRevision: gamma.revision,
      name: 'Gamma (renamed elsewhere)',
    });
    if (!renamed.ok) throw new Error(renamed.error.code);
  }, id);

  await item('Gamma').getByRole('button', { name: 'Archive' }).click();
  await page
    .getByRole('dialog', { name: 'Archive “Gamma”?' })
    .getByRole('button', { name: 'Archive project' })
    .click();

  await expect(page.getByTestId('projects-notice')).toContainText(
    'This project changed somewhere else, so the list was reloaded',
  );
  await expect(message()).toContainText('changed somewhere else');
  // Nothing was archived; the latest saved version is shown.
  const latest = item('Gamma (renamed elsewhere)');
  await expect(latest.getByTestId('project-status')).toHaveText('Active');
});
