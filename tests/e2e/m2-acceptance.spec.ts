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

import {
  createProjectThroughUi,
  editGoalThroughUi,
  projectsMessage,
  snapshotFixtures,
  writeExternalFixtures,
} from './support/m1-ui';
import {
  allProjects,
  entrancePanel,
  expectWorldMatchesSaved,
  libraryButton,
  libraryNames,
  openLibraryProjects,
  savedBuildings,
  savedPins,
  seedProjects,
  windowPointOf,
} from './support/m2-ui';
import { finishOnboarding } from './support/onboarding';

// M2-15 (#80): the M2 Checks and the Exit (ROADMAP_SPEC M2) proven end to end in the real
// built app, through the UI a user sees, with restarts. IPC calls only set up data, read back
// what was saved, or send forged commands on purpose. The packaged build repeats the Exit, the
// forged collision check and offline building art in tests/e2e-packaged/packaged.spec.ts.

/** A fixed window, so the tiles used below are on screen and the Realm Atlas is docked. */
const WINDOW = { width: 1400, height: 900 };

const cleanEnv = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== 'ELECTRON_RENDERER_URL',
    ),
  );

let userDataDir: string;
let app: ElectronApplication | null = null;
let page: Page;

async function launch(): Promise<void> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env: cleanEnv() });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
  }, WINDOW);
  await finishOnboarding(page);
  await expect(page.getByTestId('world-view')).toHaveAttribute('data-state', 'ready');
}

async function restart(): Promise<void> {
  await app?.close();
  app = null;
  await launch();
}

/** Reloads so the UI reads data that setup saved behind its back. */
async function reload(): Promise<void> {
  await page.reload();
  await finishOnboarding(page);
  await expect(page.getByTestId('world-view')).toHaveAttribute('data-state', 'ready');
}

test.beforeEach(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'atlas-e2e-m2-'));
  await launch();
});

test.afterEach(async () => {
  await app?.close();
  app = null;
  rmSync(userDataDir, { recursive: true, force: true });
});

const row = (name: string): Locator => page.getByRole('listitem', { name, exact: true });
const toolBar = (): Locator => page.getByTestId('placement-tool');
const toolMessage = (): Locator => page.getByTestId('placement-message');
const inspector = (): Locator => page.getByTestId('inspector');
const hotbarBar = (): Locator => page.getByRole('group', { name: 'Hotbar' });
const slotButton = (key: string): Locator =>
  hotbarBar().locator(`li[data-slot="${key}"] .hotbar-activate`);
const pinDialog = (): Locator => page.getByTestId('pin-dialog');
const historyMessage = (): Locator => page.getByTestId('placement-history-message');
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

/** Window point of a tile's centre (a 2 × 2 building anchored at x, y covers x..x+1). */
const tileCentre = (x: number, y: number) => windowPointOf(page, { gx: x + 0.5, gy: y + 0.5 });

async function hoverTile(x: number, y: number): Promise<void> {
  const point = await tileCentre(x, y);
  await page.mouse.move(point.x, point.y);
}

async function clickTile(x: number, y: number): Promise<void> {
  const point = await tileCentre(x, y);
  await page.mouse.click(point.x, point.y);
}

async function backToWorld(): Promise<void> {
  const panel = entrancePanel(page);
  if (await panel.isVisible()) await panel.getByRole('button', { name: 'Back to world' }).click();
  await expect(panel).toHaveCount(0);
}

async function openProjects(): Promise<void> {
  await page.locator('[data-entrance="projects"]').click();
  await expect(entrancePanel(page)).toBeVisible();
}

/** "Place on map" on a row, then a click on a free tile. */
async function placeThroughUi(name: string, x: number, y: number): Promise<void> {
  await row(name).getByRole('button', { name: 'Place on map' }).click();
  await expect(toolBar()).toHaveAttribute('data-mode', 'placing');
  await hoverTile(x, y);
  await expect(toolBar()).toHaveAttribute('data-fits', 'true');
  await clickTile(x, y);
  await expect(toolMessage()).toHaveText(
    new RegExp(`Placed “${name}” at tile ${String(x)}, ${String(y)}\\.`),
  );
}

async function pinThroughUi(name: string, key: string): Promise<void> {
  await row(name).getByRole('button', { name: 'Pin to hotbar' }).click();
  await pinDialog().locator(`button[data-slot="${key}"]`).click();
}

const buildingLines = async () =>
  (await savedBuildings(page)).map((b) => `${b.name}@${String(b.x)},${String(b.y)}`);

test('Check: create/cancel placement persists across a restart (§22.2 #1)', async () => {
  await createProjectThroughUi(page, 'Keeper', 'Stays unplaced');
  await createProjectThroughUi(page, 'Builder');

  // Cancel: the tool opens, the preview follows the pointer, Escape leaves without saving.
  await row('Keeper').getByRole('button', { name: 'Place on map' }).click();
  await expect(toolBar()).toBeVisible();
  await hoverTile(30, 30);
  await expect(toolBar()).toHaveAttribute('data-fits', 'true');
  await page.keyboard.press('Escape');
  await expect(toolBar()).toHaveCount(0);
  await expect(toolMessage()).toHaveText(/Placement cancelled\. Nothing was changed\./);
  expect(await buildingLines()).toEqual([]);

  // Create: a second project is placed for real.
  await openProjects();
  await placeThroughUi('Builder', 24, 24);
  const before = await allProjects(page);

  await restart();
  expect(await allProjects(page)).toEqual(before);
  expect(await buildingLines()).toEqual(['Builder@24,24']);
  // Found intact in the library: Keeper under Not placed, Builder under Placed.
  expect(await libraryNames(page, 'Active', 'Not placed')).toEqual(['Keeper']);
  expect(await libraryNames(page, 'Active', 'Placed')).toEqual(['Builder']);
  await libraryButton(page).click();
  expect(await expectWorldMatchesSaved(page)).toEqual({ placed: 1, unplaced: 1 });
});

test('Check: no silent slot replacement, through the UI and forged commands (§22.2 #2)', async () => {
  test.setTimeout(90_000);
  const names = KEYS.map((_, i) => `Project ${String(i + 1).padStart(2, '0')}`);
  const ids = await seedProjects(
    page,
    names.map((name) => ({ name })),
  );
  await reload();
  await openProjects();
  for (const [i, name] of names.entries()) {
    const key = KEYS[i] ?? '';
    await pinThroughUi(name, key);
    await expect(projectsMessage(page)).toHaveText(
      `Pinned “${name}” to slot ${key}. Press ${key} to go to it.`,
    );
  }

  // An eleventh project. Pinning it over slot 1 asks first and names the shortcut; Cancel keeps it.
  await createProjectThroughUi(page, 'Project 11');
  await pinThroughUi('Project 11', '1');
  await expect(pinDialog().getByTestId('pin-occupant')).toHaveText(
    'Slot 1 holds the shortcut “Project 01”.',
  );
  await pinDialog().getByRole('button', { name: 'Cancel' }).click();
  await page.keyboard.press('Escape');
  await expect(pinDialog()).toHaveCount(0);
  const pins = await savedPins(page);
  expect(pins).toEqual(Object.fromEntries(names.map((name, i) => [i, ids[name]])));

  // Forged commands: no `replace`, or a `replace` naming the wrong occupant, change nothing.
  const forged = await page.evaluate(
    async ({ first, second }) => {
      const worlds = await window.atlas.world.list();
      if (!worlds.ok) throw new Error(worlds.error.code);
      const worldId = worlds.data.worlds[0]?.id ?? '';
      const list = await window.atlas.project.list({ worldId });
      if (!list.ok) throw new Error(list.error.code);
      const eleventh = list.data.projects.find((p) => p.name === 'Project 11')?.id ?? '';
      const target = { type: 'project' as const, id: eleventh };
      const plain = await window.atlas.hotbar.assign({ worldId, slot: 0, target });
      const wrong = await window.atlas.hotbar.assign({
        worldId,
        slot: 0,
        target,
        replace: { expectedTargetId: second },
      });
      const describe = (r: typeof plain) =>
        r.ok
          ? 'ok'
          : `${r.error.code}:${r.error.hotbar?.occupant.target.id === first ? 'first' : '?'}`;
      return { plain: describe(plain), wrong: describe(wrong) };
    },
    { first: ids['Project 01'] ?? '', second: ids['Project 02'] ?? '' },
  );
  expect(forged).toEqual({ plain: 'slot_occupied:first', wrong: 'slot_occupied:first' });
  expect(await savedPins(page)).toEqual(pins);

  await restart();
  expect(await savedPins(page)).toEqual(pins);
  for (const [i, name] of names.entries()) {
    const key = KEYS[i] ?? '';
    await expect(slotButton(key)).toHaveAccessibleName(`Slot ${key}: ${name}`);
  }
  const saved = await allProjects(page);
  expect(saved.map((p) => `${p.name}:${p.status}`).sort()).toEqual(
    [...names, 'Project 11'].map((name) => `${name}:active`).sort(),
  );
});

test('Check: collisions are rechecked, through the UI and forged command input (§22.2 #5)', async () => {
  const ids = await seedProjects(page, [
    { name: 'Alpha', tile: { x: 30, y: 30 } },
    { name: 'Beta', tile: { x: 36, y: 30 } },
    { name: 'Gamma' },
  ]);
  await reload();
  const saved = await buildingLines();
  expect(saved).toEqual(['Alpha@30,30', 'Beta@36,30']);

  // UI, placing: the preview says it's blocked and a click there is refused.
  await openProjects();
  await row('Gamma').getByRole('button', { name: 'Place on map' }).click();
  await hoverTile(31, 31);
  await expect(toolBar()).toHaveAttribute('data-fits', 'false');
  await expect(page.getByTestId('placement-preview')).toHaveText(
    '✕ Blocked: another building is in the way',
  );
  await clickTile(31, 31);
  await expect(toolMessage()).toHaveText(/It can't stand there: another building is in the way/);
  await page.keyboard.press('Escape');
  await expect(toolBar()).toHaveCount(0);

  // UI, moving: dropping Beta onto Alpha is refused and Beta stays where it was saved.
  await clickTile(37, 31);
  await expect(inspector().getByRole('heading', { name: 'Beta' })).toBeVisible();
  await inspector().getByRole('button', { name: 'Move building' }).click();
  const from = await tileCentre(36, 30);
  const onto = await tileCentre(30, 30);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(onto.x, onto.y, { steps: 8 });
  await expect(page.getByTestId('placement-preview')).toHaveText(
    '✕ Blocked: another building is in the way',
  );
  await page.mouse.up();
  await expect(toolMessage()).toHaveText(/Not moved: another building is in the way/);
  await page.keyboard.press('Escape');
  expect(await buildingLines()).toEqual(saved);

  // Forged input straight to window.atlas.placement, with no preview involved. "Off the map"
  // is checked only here: the UI case above is an overlap, and the map's edge is off screen at
  // the default camera. The preview and the command share the same rules (placement-rules.ts).
  const outcomes = await page.evaluate(
    async ({ gamma, alpha }) => {
      const worlds = await window.atlas.world.list();
      if (!worlds.ok) throw new Error(worlds.error.code);
      const worldId = worlds.data.worlds[0]?.id ?? '';
      const list = await window.atlas.placement.list({ worldId });
      if (!list.ok) throw new Error(list.error.code);
      const alphaBuilding = list.data.placements.find((p) => p.target.id === alpha);
      const beta = list.data.placements.find((p) => p.target.id !== alpha);
      if (alphaBuilding === undefined || beta === undefined) throw new Error('missing building');
      const create = (extra: Record<string, unknown>) =>
        window.atlas.placement.create({
          worldId,
          projectId: gamma,
          tileX: 31,
          tileY: 31,
          rotation: 0,
          ...extra,
        } as never);
      const describe = (r: Awaited<ReturnType<typeof create>>) =>
        r.ok
          ? 'saved'
          : r.error.code === 'placement_blocked'
            ? `placement_blocked:${r.error.placement?.reason ?? '?'}:${
                r.error.placement?.blockingIds.includes(alphaBuilding.id) === true ? 'alpha' : '-'
              }`
            : r.error.code;
      return {
        overlap: describe(await create({})),
        // Inside the tile sanity range (0–255) but outside the 64 × 64 world.
        offMap: describe(await create({ tileX: 63, tileY: 10 })),
        farOffMap: describe(await create({ tileX: 200, tileY: 200 })),
        negative: describe(await create({ tileX: -1 })),
        notANumber: describe(await create({ tileX: Number.NaN })),
        huge: describe(await create({ tileX: 1e12 })),
        fractional: describe(await create({ tileX: 10.5 })),
        badRotation: describe(await create({ tileX: 10, tileY: 10, rotation: 45 })),
        smuggledFootprint: describe(
          await create({ tileX: 10, tileY: 10, footprint: { columns: 1, rows: 1 } }),
        ),
        smuggledAppearance: describe(
          await create({ tileX: 10, tileY: 10, appearanceId: 'placeholder.building.2x2' }),
        ),
        moveOnto: describe(
          await window.atlas.placement.move({
            worldId,
            placementId: beta.id,
            expectedRevision: beta.revision,
            tileX: 31,
            tileY: 30,
            rotation: 0,
          }),
        ),
      };
    },
    { gamma: ids['Gamma'] ?? '', alpha: ids['Alpha'] ?? '' },
  );
  expect(outcomes).toEqual({
    overlap: 'placement_blocked:overlaps:alpha',
    offMap: 'placement_blocked:out_of_bounds:-',
    farOffMap: 'placement_blocked:out_of_bounds:-',
    negative: 'invalid_payload',
    notANumber: 'invalid_payload',
    huge: 'invalid_payload',
    fractional: 'invalid_payload',
    badRotation: 'invalid_payload',
    smuggledFootprint: 'invalid_payload',
    smuggledAppearance: 'invalid_payload',
    moveOnto: 'placement_blocked:overlaps:alpha',
  });
  expect(await buildingLines()).toEqual(saved);
  await expect(page.getByTestId('world-view')).toHaveAttribute('data-buildings', '2');
});

test('Check: E, 1–0, Escape and Ctrl+Z do nothing while typing in a text field', async () => {
  const ids = await seedProjects(page, [{ name: 'Alpha' }]);
  await page.evaluate(async (alpha) => {
    const worlds = await window.atlas.world.list();
    if (!worlds.ok) throw new Error(worlds.error.code);
    const worldId = worlds.data.worlds[0]?.id ?? '';
    for (const [slot, target] of [
      [0, { type: 'project', id: alpha }],
      [9, { type: 'service', id: 'settings' }],
    ] as const) {
      const pinned = await window.atlas.hotbar.assign({ worldId, slot, target });
      if (!pinned.ok) throw new Error(pinned.error.code);
    }
  }, ids['Alpha'] ?? '');
  await reload();
  // A placement step to undo, made through the tool.
  await openProjects();
  await placeThroughUi('Alpha', 24, 24);
  await expect(
    page.getByTestId('placement-history').getByRole('button', { name: /^Undo/ }),
  ).toHaveAccessibleName('Undo: place “Alpha”');

  /** Nothing a shortcut would do has happened, and the panel that holds the field is open. */
  const expectNothingHappened = async (panelHeading: string) => {
    await expect(entrancePanel(page).getByRole('heading', { name: panelHeading })).toBeVisible();
    await expect(inspector()).toContainText('Nothing selected.');
    await expect(historyMessage()).toHaveCount(0);
    expect(await buildingLines()).toEqual(['Alpha@24,24']);
  };
  const typeShortcuts = async (field: Locator) => {
    for (const key of ['e', '1', '0']) await field.press(key);
    await expect(field).toHaveValue(/e10$/);
    await field.press('Control+z');
  };

  // 1. The Projects search box. Escape there belongs to the field, so the panel stays.
  await openProjects();
  const search = entrancePanel(page).getByLabel('Search projects');
  await search.fill('');
  await typeShortcuts(search);
  await search.press('Escape');
  await expect(libraryButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expectNothingHappened('Test World');
  await search.fill('');

  // 2. The new-project name field. Escape cancels the draft (the field's own job), nothing else.
  await entrancePanel(page).getByRole('button', { name: 'New project' }).click();
  const form = page.getByRole('form', { name: 'New project' });
  const name = form.getByLabel('Project name');
  await typeShortcuts(name);
  await expectNothingHappened('Test World');
  await name.press('Escape');
  await expect(form).toHaveCount(0);
  await expectNothingHappened('Test World');

  // 3. A rename field. Escape closes the editor without saving.
  await row('Alpha').getByRole('button', { name: 'Rename' }).click();
  const rename = row('Alpha').getByLabel('New name for Alpha');
  await typeShortcuts(rename);
  await rename.press('Escape');
  await expect(rename).toHaveCount(0);
  await expectNothingHappened('Test World');

  // 4. The library's own search box: E there doesn't close the library.
  const library = await openLibraryProjects(page);
  const librarySearch = library.getByLabel('Search projects');
  await librarySearch.fill('');
  await typeShortcuts(librarySearch);
  await librarySearch.press('Escape');
  await expect(libraryButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expectNothingHappened('Library');
  await librarySearch.fill('');
  expect((await allProjects(page)).map((p) => p.name)).toEqual(['Alpha']);

  // Positive control: out of the field, the same keys do their jobs.
  await librarySearch.blur();
  await page.keyboard.press('e');
  await expect(libraryButton(page)).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('1');
  await expect(inspector()).toHaveAttribute('data-project-id', ids['Alpha'] ?? '');
  await page.keyboard.press('Control+z');
  await expect(historyMessage()).toHaveText(/Undone: the building of “Alpha” was removed/);
  expect(await buildingLines()).toEqual([]);
  await page.keyboard.press('0');
  await expect(entrancePanel(page).getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(entrancePanel(page)).toHaveCount(0);
});

test('Check: removing a building and unpinning a shortcut keep the project (§22.2 #3)', async () => {
  await seedProjects(page, [
    { name: 'Keeper', goal: 'Outlive its building', tile: { x: 30, y: 30 } },
  ]);
  await reload();
  await openProjects();
  await pinThroughUi('Keeper', '3');
  await expect(slotButton('3')).toHaveAccessibleName('Slot 3: Keeper');
  // Files next to the profile, in folders named like the project: a delete by name would hit them.
  const fixtures = writeExternalFixtures(userDataDir, 'Keeper');
  const files = snapshotFixtures(fixtures);
  const before = await allProjects(page);

  // Remove the building from the world's inspector.
  await backToWorld();
  await clickTile(30, 30);
  await inspector().getByRole('button', { name: 'Remove from map' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('The project is not deleted');
  await expect(dialog).toContainText('No files are moved or deleted.');
  await dialog.getByRole('button', { name: 'Remove from map' }).click();
  await expect(inspector().getByTestId('inspector-placement')).toHaveText('Not placed');
  await expect(inspector().getByTestId('inspector-status')).toHaveText('Active');

  // Unpin from the bar.
  await hotbarBar().getByRole('button', { name: 'Unpin Keeper from slot 3' }).click();
  await expect(page.getByTestId('hotbar-message')).toHaveText(
    'Unpinned “Keeper” from slot 3. The project itself is not affected.',
  );

  // The project record didn't change at all: same ID, name, goal, status, revision, times.
  // Run history doesn't exist until M4, so there is none to compare yet.
  expect(await allProjects(page)).toEqual(before);
  expect(await buildingLines()).toEqual([]);
  expect(await savedPins(page)).toEqual({});
  expect(snapshotFixtures(fixtures)).toEqual(files);

  await restart();
  expect(await allProjects(page)).toEqual(before);
  expect(await libraryNames(page, 'Active', 'Not placed')).toEqual(['Keeper']);
  await expect(slotButton('3')).toHaveAccessibleName('Slot 3: Empty');
  expect(snapshotFixtures(fixtures)).toEqual(files);
});

test('Check: every critical action works from the list view with the world hidden', async () => {
  test.setTimeout(90_000);
  await seedProjects(page, [{ name: 'Alpha', tile: { x: 30, y: 30 } }, { name: 'Orchard' }]);
  await reload();

  await page.getByRole('button', { name: 'Hide world view' }).click();
  await expect(page.getByTestId('world-hidden')).toBeVisible();
  const noCanvas = async () => {
    await expect(page.getByTestId('world-hidden')).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
  };
  await noCanvas();

  const library = await openLibraryProjects(page);
  const message = library.getByTestId('projects-message');
  const statusFilter = (name: string) =>
    library
      .getByRole('group', { name: 'Show projects' })
      .getByRole('button', { name, exact: true });
  const confirm = async (name: string, button: string, confirmLabel: string) => {
    await row(name).getByRole('button', { name: button, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: confirmLabel, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  };

  // Create, rename and set a goal.
  await createProjectThroughUi(page, 'Notebook');
  await row('Notebook').getByRole('button', { name: 'Rename' }).click();
  await library.getByLabel('New name for Notebook').fill('Field notes');
  await library.getByRole('button', { name: 'Save name' }).click();
  await expect(message).toHaveText('Renamed to “Field notes”.');
  await editGoalThroughUi(page, 'Field notes', 'Written with the map hidden');

  // Open shows the details; E brings the library back.
  await row('Field notes').getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByTestId('project-details')).toContainText('Field notes');
  await page.keyboard.press('e');
  await expect(library.getByRole('tab', { name: 'Projects' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Put on the map and take off again, without the map.
  await row('Field notes').getByRole('button', { name: 'Auto-place' }).click();
  await expect(message).toHaveText(
    /^Placed “Field notes” at tile \d+, \d+, the nearest free spot\.$/,
  );
  await confirm('Field notes', 'Remove from map', 'Remove from map');
  await expect(row('Field notes').getByTestId('project-not-placed')).toHaveText('Not placed');

  // Pin and unpin.
  await pinThroughUi('Field notes', '4');
  await expect(message).toHaveText('Pinned “Field notes” to slot 4. Press 4 to go to it.');
  await hotbarBar().getByRole('button', { name: 'Unpin Field notes from slot 4' }).click();
  await expect(slotButton('4')).toHaveAccessibleName('Slot 4: Empty');

  // Archive → restore, trash → restore from trash.
  await confirm('Alpha', 'Archive', 'Archive project');
  await expect(message).toContainText('Archived “Alpha”.');
  await statusFilter('Archived').click();
  await confirm('Alpha', 'Restore', 'Restore project');
  await statusFilter('Active').click();
  await confirm('Alpha', 'Move to trash', 'Move to trash');
  await statusFilter('Trash').click();
  await confirm('Alpha', 'Restore from trash', 'Restore project');
  await expect(message).toContainText('Restored “Alpha” from the trash.');
  await statusFilter('Active').click();

  // A typed link through the Realm Atlas Connections form, and its removal from the links list.
  const atlas = page.getByTestId('realm-atlas');
  await atlas.getByRole('tab', { name: 'Connections' }).click();
  const linkForm = atlas.getByTestId('atlas-link-form');
  await linkForm
    .getByTestId('atlas-link-source')
    .selectOption({ label: 'Field notes (no building)' });
  await linkForm.getByTestId('atlas-link-type').selectOption({ label: 'references' });
  await linkForm.getByTestId('atlas-link-target').selectOption({ label: 'Orchard (no building)' });
  await linkForm.getByTestId('atlas-link-create').click();
  await expect(atlas.getByTestId('atlas-link-result')).toHaveText(
    'Linked: Field notes references Orchard.',
  );
  await atlas
    .getByTestId('atlas-links-list')
    .getByRole('button', { name: 'Remove link: Field notes references Orchard' })
    .click();
  await page
    .getByRole('dialog', { name: 'Remove this link?' })
    .getByRole('button', { name: 'Remove link' })
    .click();
  await expect(atlas.getByTestId('atlas-link-result')).toHaveText(
    'Removed the link: Field notes references Orchard. Both projects are unchanged.',
  );

  // All of it with the world hidden; every project is still there.
  await noCanvas();
  const projects = await allProjects(page);
  expect(projects.map((p) => `${p.name}:${p.status}`).sort()).toEqual([
    'Alpha:active',
    'Field notes:active',
    'Orchard:active',
  ]);
  expect(projects.find((p) => p.name === 'Field notes')?.goal).toBe('Written with the map hidden');
});

test('Exit: the world matches the saved projects (more than ten in total, placed and unplaced) after a restart', async () => {
  test.setTimeout(90_000);
  // Twelve set up behind the UI: seven placed (one archived), five unplaced (one archived).
  await seedProjects(page, [
    { name: 'Apiary', tile: { x: 10, y: 10 } },
    { name: 'Bakery', tile: { x: 14, y: 10 } },
    { name: 'Chapel', tile: { x: 18, y: 10 } },
    { name: 'Dovecote', tile: { x: 10, y: 14 } },
    { name: 'Forge', tile: { x: 14, y: 14 } },
    { name: 'Granary', tile: { x: 40, y: 40 } },
    { name: 'Herbarium', tile: { x: 44, y: 40 }, archived: true },
    { name: 'Inn' },
    { name: 'Jetty' },
    { name: 'Kiln' },
    { name: 'Lantern' },
    { name: 'Mill', archived: true },
  ]);
  await reload();
  // Two more through the UI: one placed by hand, one auto-placed.
  await openProjects();
  await createProjectThroughUi(page, 'Hand placed');
  await createProjectThroughUi(page, 'Auto placed');
  await placeThroughUi('Hand placed', 26, 24);
  await openProjects();
  await row('Auto placed').getByRole('button', { name: 'Auto-place' }).click();
  await expect(projectsMessage(page)).toHaveText(/^Placed “Auto placed” at tile \d+, \d+/);
  await pinThroughUi('Inn', '1');
  await backToWorld();

  expect(await expectWorldMatchesSaved(page)).toEqual({ placed: 9, unplaced: 5 });
  const projectsBefore = await allProjects(page);
  const buildingsBefore = await savedBuildings(page);
  expect(projectsBefore).toHaveLength(14);

  await restart();
  expect(await allProjects(page)).toEqual(projectsBefore);
  expect(await savedBuildings(page)).toEqual(buildingsBefore);
  expect(await expectWorldMatchesSaved(page)).toEqual({ placed: 9, unplaced: 5 });
  await expect(page.getByTestId('world-view-status')).toContainText('1 archived');
  await expect(slotButton('1')).toHaveAccessibleName('Slot 1: Inn');
});
