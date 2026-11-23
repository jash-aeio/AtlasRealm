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

// M2-9 (#74): the library (UI_SPEC §6.3) in the real built app. E and the bottom-bar button
// toggle it, its tabs are labelled and keyboard-usable, the Projects tab filters by status and
// by "On map" across more than ten projects, and every critical project action works from the
// list with the world view hidden (M2 Check: all critical actions remain available in list view).

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
  userDataDir = mkdtempSync(join(tmpdir(), 'atlas-e2e-library-'));
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env: cleanEnv() });
  page = await app.firstWindow();
  await finishOnboarding(page);
});

test.afterEach(async () => {
  await app.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

interface Seed {
  readonly name: string;
  /** Gives the project a building at this tile. */
  readonly tile?: { readonly x: number; readonly y: number };
  readonly archived?: boolean;
}

/** Creates projects (and buildings) behind the UI's back, then reloads so the UI reads them. */
async function seed(projects: readonly Seed[]): Promise<void> {
  await page.evaluate(async (seeds) => {
    const must = <T>(result: { ok: true; data: T } | { ok: false; error: { code: string } }): T => {
      if (!result.ok) throw new Error(result.error.code);
      return result.data;
    };
    const worldId = must(await window.atlas.world.list()).worlds[0]?.id ?? '';
    for (const s of seeds) {
      const { project } = must(
        await window.atlas.project.create({
          worldId,
          templateId: 'builtin.generic',
          templateVersion: '1.0.0',
          name: s.name,
        }),
      );
      // Archiving removes a building (ADR-0025), so archive first; archived projects can be placed.
      if (s.archived === true) {
        must(
          await window.atlas.project.archive({
            worldId,
            projectId: project.id,
            expectedRevision: project.revision,
          }),
        );
      }
      if (s.tile !== undefined) {
        must(
          await window.atlas.placement.create({
            worldId,
            projectId: project.id,
            tileX: s.tile.x,
            tileY: s.tile.y,
            rotation: 0,
          }),
        );
      }
    }
  }, projects);
  await page.reload();
  await expect(page.locator('main[data-screen="main"]')).toBeVisible();
}

const libraryButton = (): Locator =>
  page.locator('.bottom-bar').getByRole('button', { name: /^Library/ });
const panel = (): Locator => page.getByTestId('entrance-panel');
const tab = (name: string): Locator => panel().getByRole('tab', { name, exact: true });
const statusFilter = (name: string): Locator =>
  panel().getByRole('group', { name: 'Show projects' }).getByRole('button', { name, exact: true });
const mapFilter = (name: string): Locator =>
  panel().getByRole('group', { name: 'On map' }).getByRole('button', { name, exact: true });
const item = (name: string): Locator => panel().getByRole('listitem', { name, exact: true });
const summary = (): Locator => panel().getByTestId('projects-summary');
const message = (): Locator => panel().getByTestId('projects-message');

async function openLibrary(): Promise<void> {
  await libraryButton().click();
  await expect(panel().getByRole('heading', { name: 'Library' })).toBeFocused();
}

/** Confirms the dialog that `button` on the row opens. */
async function confirmAction(row: Locator, button: string, confirm: string): Promise<void> {
  await row.getByRole('button', { name: button, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: confirm, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('E and the Library button toggle it; its tabs are labelled and keyboard-usable', async () => {
  await expect(libraryButton()).toHaveAttribute('aria-keyshortcuts', 'E');
  await openLibrary();
  await expect(libraryButton()).toHaveAttribute('aria-pressed', 'true');
  await expect(panel().getByRole('tablist', { name: 'Library sections' })).toBeVisible();
  await expect(panel().getByRole('tab')).toHaveText([
    'Projects',
    'Agents',
    'Skills',
    'Tools',
    'Workflows',
    'Building Appearances',
  ]);
  await expect(tab('Projects')).toHaveAttribute('aria-selected', 'true');
  await expect(summary()).toHaveText('No active projects in this world yet.');

  // Typing E in the search field types it; it doesn't close the library.
  const search = panel().getByLabel('Search projects');
  await search.fill('');
  await search.press('e');
  await expect(search).toHaveValue('e');
  await expect(libraryButton()).toHaveAttribute('aria-pressed', 'true');
  await search.fill('');

  // Tab reaches only the selected tab; arrows, Home and End move and select.
  await tab('Projects').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab('Agents')).toBeFocused();
  await expect(tab('Agents')).toHaveAttribute('aria-selected', 'true');
  await expect(tab('Projects')).toHaveAttribute('tabindex', '-1');
  await expect(panel().getByRole('tabpanel', { name: 'Agents' })).toBeVisible();
  for (const name of ['Agents', 'Skills', 'Tools', 'Workflows']) {
    await expect(tab(name)).toBeFocused();
    await expect(panel().getByTestId('library-planned')).toHaveText('Planned for M3');
    await page.keyboard.press('ArrowRight');
  }
  await expect(tab('Building Appearances')).toBeFocused();
  // The bundled appearance is listed, and labelled as placeholder art.
  const appearances = panel().getByRole('list', { name: 'Bundled building appearances' });
  const appearance = appearances.getByRole('listitem', { name: 'placeholder.building.2x2' });
  await expect(appearance.getByTestId('appearance-placeholder')).toHaveText('Placeholder art');
  await expect(appearance.getByTestId('appearance-default')).toHaveText('Default');
  await expect(appearance).toContainText('Footprint: 2 × 2 tiles');
  await expect(panel().getByTestId('library-planned')).toHaveText(
    'Choosing an appearance: Planned for M3',
  );
  await page.keyboard.press('ArrowRight');
  await expect(tab('Projects')).toBeFocused();
  await page.keyboard.press('End');
  await expect(tab('Building Appearances')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tab('Projects')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tab('Building Appearances')).toBeFocused();

  // E closes it (focus is on a tab, not in a field) and E opens it again on the same tab.
  await page.keyboard.press('e');
  await expect(panel()).toHaveCount(0);
  await expect(libraryButton()).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('e');
  await expect(panel().getByRole('heading', { name: 'Library' })).toBeFocused();
  await expect(tab('Building Appearances')).toHaveAttribute('aria-selected', 'true');
  // The button closes it too.
  await libraryButton().click();
  await expect(panel()).toHaveCount(0);
});

test('Projects tab: more than ten projects, paged, filtered by status and by On map', async () => {
  test.setTimeout(60_000);
  const seeds: Seed[] = Array.from({ length: 55 }, (_, i) => ({
    name: `Project ${String(i + 1).padStart(2, '0')}`,
  }));
  seeds.push(
    { name: 'Mill', tile: { x: 10, y: 10 } },
    { name: 'Tower', tile: { x: 20, y: 20 } },
    { name: 'Old barn', archived: true },
    { name: 'Old placed barn', tile: { x: 30, y: 30 }, archived: true },
  );
  await seed(seeds);
  await openLibrary();

  // 57 active projects: the first page holds 50, Load more brings the rest.
  await expect(summary()).toHaveText('Showing 50 active projects. More are available below.');
  await panel().getByRole('button', { name: 'Load more projects' }).click();
  await expect(summary()).toHaveText('Showing 57 active projects.');

  // Not placed: every project without a building, across all pages, with no Load more.
  await mapFilter('Not placed').click();
  await expect(mapFilter('Not placed')).toHaveAttribute('aria-pressed', 'true');
  await expect(summary()).toHaveText('Showing 55 active projects not placed.');
  await expect(item('Mill')).toHaveCount(0);
  await expect(item('Project 55').getByTestId('project-not-placed')).toHaveText('Not placed');
  await expect(panel().getByRole('button', { name: 'Load more projects' })).toHaveCount(0);

  await mapFilter('Placed').click();
  await expect(summary()).toHaveText('Showing 2 active projects on the map.');
  await expect(panel().getByRole('listitem')).toHaveCount(2);
  await expect(item('Mill')).toBeVisible();
  await expect(item('Tower')).toBeVisible();

  // The map filter combines with the status filter and the search.
  await statusFilter('Archived').click();
  await expect(summary()).toHaveText('Showing 1 archived project on the map.');
  await expect(item('Old placed barn')).toBeVisible();
  await mapFilter('Not placed').click();
  await expect(item('Old barn')).toBeVisible();
  await expect(item('Old placed barn')).toHaveCount(0);
  await statusFilter('Active').click();
  await panel().getByLabel('Search projects').fill('project 1');
  await expect(summary()).toHaveText('10 active projects not placed match “project 1”.');
  await panel().getByLabel('Search projects').fill('');

  await statusFilter('Trash').click();
  await expect(summary()).toHaveText('No trashed projects not placed.');
  await mapFilter('All').click();
  await expect(summary()).toHaveText('The trash is empty.');

  // Keyboard alone: the filters are buttons in the Tab order.
  await mapFilter('Placed').focus();
  await page.keyboard.press('Tab');
  await expect(mapFilter('Not placed')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(mapFilter('Not placed')).toHaveAttribute('aria-pressed', 'true');
});

test('with the world view hidden, every critical project action works from the library', async () => {
  test.setTimeout(60_000);
  await seed([{ name: 'Alpha', tile: { x: 30, y: 30 } }, { name: 'Beta' }]);

  await page.getByRole('button', { name: 'Hide world view' }).click();
  await expect(page.getByTestId('world-hidden')).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show world view' })).toBeVisible();

  await openLibrary();

  // Open shows the project's details; E brings the library back.
  await item('Beta').getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByTestId('project-details')).toContainText('Beta');
  await page.keyboard.press('e');
  await expect(tab('Projects')).toHaveAttribute('aria-selected', 'true');

  // Rename.
  await item('Beta').getByRole('button', { name: 'Rename' }).click();
  await panel().getByLabel('New name for Beta').fill('Bravo');
  await panel().getByRole('button', { name: 'Save name' }).click();
  await expect(message()).toHaveText('Renamed to “Bravo”.');

  // Auto-place and remove from map need no canvas.
  await item('Bravo').getByRole('button', { name: 'Auto-place' }).click();
  await expect(message()).toHaveText(/^Placed “Bravo” at tile \d+, \d+, the nearest free spot\.$/);
  await expect(item('Bravo').getByTestId('project-not-placed')).toHaveCount(0);
  await confirmAction(item('Bravo'), 'Remove from map', 'Remove from map');
  await expect(message()).toContainText('Removed the building of “Bravo” from the map.');
  await expect(item('Bravo').getByTestId('project-not-placed')).toHaveText('Not placed');

  // Archive and restore.
  await confirmAction(item('Alpha'), 'Archive', 'Archive project');
  await expect(message()).toContainText('Archived “Alpha”.');
  await statusFilter('Archived').click();
  await confirmAction(item('Alpha'), 'Restore', 'Restore project');
  await expect(message()).toContainText('Restored “Alpha”.');

  // Trash and restore from trash.
  await statusFilter('Active').click();
  await confirmAction(item('Alpha'), 'Move to trash', 'Move to trash');
  await expect(message()).toContainText('Moved “Alpha” to the trash.');
  await statusFilter('Trash').click();
  await confirmAction(item('Alpha'), 'Restore from trash', 'Restore project');
  await expect(message()).toContainText('Restored “Alpha” from the trash.');

  // All of that happened with the world hidden.
  await expect(page.getByTestId('world-hidden')).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);

  // Placing by hand needs the map, so "Place on map" shows the world again.
  await statusFilter('Active').click();
  await item('Bravo').getByRole('button', { name: 'Place on map' }).click();
  await expect(page.getByTestId('world-hidden')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Place here' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('placement-message')).toHaveText(/Placed “Bravo” at tile/);

  // Every project is still there: nothing was lost on the way.
  const names = await page.evaluate(async () => {
    const worlds = await window.atlas.world.list();
    if (!worlds.ok) throw new Error(worlds.error.code);
    const worldId = worlds.data.worlds[0]?.id ?? '';
    const list = await window.atlas.project.list({ worldId, status: 'active' });
    if (!list.ok) throw new Error(list.error.code);
    return list.data.projects.map((p) => p.name).sort();
  });
  expect(names).toEqual(['Alpha', 'Bravo']);
});
