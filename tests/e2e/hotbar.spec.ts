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

import {
  createProjectThroughUi,
  item,
  listProjects,
  onlyWorldId,
  projectsMessage,
} from './support/m1-ui';
import { finishOnboarding } from './support/onboarding';

// M2-4 (#69): the hotbar commands through the real preload and built main process. Pin a
// project and a service, refuse a filled slot without an explicit replace (`slot_occupied` with
// the occupant), replace with the right expected target, keep an archived project's pin, and
// clear a slot without touching the project.
//
// M2-10 (#75): the hotbar bar and "Pin to hotbar" through the real UI. §22.2 #2 (ten slots, an
// eleventh project, a restart), the replace confirmation, unpinning, archived pins, the number
// keys (not while typing) and pinning a service from its panel.

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
  userDataDir = mkdtempSync(join(tmpdir(), 'atlas-e2e-hotbar-'));
  await launch();
});

test.afterEach(async () => {
  await app.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('pin, refuse, replace, archive and clear through window.atlas.hotbar', async () => {
  const outcome = await page.evaluate(async () => {
    const must = <T>(result: { ok: true; data: T } | { ok: false; error: { code: string } }): T => {
      if (!result.ok) throw new Error(result.error.code);
      return result.data;
    };
    const worldId = must(await window.atlas.world.list()).worlds[0]?.id ?? '';
    const newProject = async (name: string) =>
      must(
        await window.atlas.project.create({
          worldId,
          templateId: 'builtin.generic',
          templateVersion: '1.0.0',
          name,
        }),
      ).project;

    const first = await newProject('First');
    const second = await newProject('Second');
    const pinned = must(
      await window.atlas.hotbar.assign({
        worldId,
        slot: 0,
        target: { type: 'project', id: first.id },
      }),
    ).slot;
    must(
      await window.atlas.hotbar.assign({
        worldId,
        slot: 9,
        target: { type: 'service', id: 'settings' },
      }),
    );
    const occupied = await window.atlas.hotbar.assign({
      worldId,
      slot: 0,
      target: { type: 'project', id: second.id },
    });
    const wrongExpected = await window.atlas.hotbar.assign({
      worldId,
      slot: 0,
      target: { type: 'project', id: second.id },
      replace: { expectedTargetId: 'settings' },
    });
    const forged = await window.atlas.hotbar.assign({
      worldId,
      slot: 1,
      // @ts-expect-error: a forged target, as a compromised page could send.
      target: { type: 'service', id: 'bank-vault' },
    });
    const replaced = must(
      await window.atlas.hotbar.assign({
        worldId,
        slot: 0,
        target: { type: 'project', id: second.id },
        replace: { expectedTargetId: first.id },
      }),
    ).slot;
    must(
      await window.atlas.project.archive({
        worldId,
        projectId: second.id,
        expectedRevision: second.revision,
      }),
    );
    const afterArchive = must(await window.atlas.hotbar.list({ worldId })).slots;
    const cleared = must(
      await window.atlas.hotbar.clear({ worldId, slot: 0, expectedTargetId: second.id }),
    ).slot;
    const finalList = must(await window.atlas.hotbar.list({ worldId })).slots;
    const secondAfter = must(
      await window.atlas.project.get({ worldId, projectId: second.id }),
    ).project;

    return {
      pinned: { slot: pinned.slot, isFirst: pinned.target.id === first.id },
      occupied: occupied.ok ? null : occupied.error,
      occupantIsFirst: !occupied.ok && occupied.error.hotbar?.occupant.target.id === first.id,
      wrongExpected: wrongExpected.ok ? null : wrongExpected.error.code,
      forged: forged.ok ? null : forged.error.code,
      replaced: { isSecond: replaced.target.id === second.id, revision: replaced.revision },
      afterArchive: afterArchive.map((s) => [s.slot, s.projectStatus]),
      cleared: cleared.projectStatus,
      finalList: finalList.map((s) => s.target.id),
      secondAfter: { name: secondAfter.name, status: secondAfter.status },
    };
  });

  expect(outcome).toEqual({
    pinned: { slot: 0, isFirst: true },
    occupied: {
      code: 'slot_occupied',
      message: 'That hotbar slot holds something else.',
      hotbar: {
        slot: 0,
        occupant: { target: { type: 'project', id: expect.any(String) }, projectStatus: 'active' },
      },
    },
    occupantIsFirst: true,
    wrongExpected: 'slot_occupied',
    forged: 'invalid_payload',
    replaced: { isSecond: true, revision: 2 },
    afterArchive: [
      [0, 'archived'],
      [9, null],
    ],
    cleared: 'archived',
    finalList: ['settings'],
    secondAfter: { name: 'Second', status: 'archived' },
  });
});
// ---- M2-10: the hotbar UI ----------------------------------------------------------------

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const hotbarBar = () => page.getByRole('group', { name: 'Hotbar' });
const slotButton = (key: string) => hotbarBar().locator(`li[data-slot="${key}"] .hotbar-activate`);
const pinDialog = () => page.getByTestId('pin-dialog');

/** Creates projects through the preload API and reloads, so the list shows them. */
async function createProjects(names: readonly string[]): Promise<Record<string, string>> {
  const ids = await page.evaluate(async (projectNames) => {
    const worlds = await window.atlas.world.list();
    if (!worlds.ok) throw new Error(worlds.error.code);
    const worldId = worlds.data.worlds[0]?.id ?? '';
    const out: Record<string, string> = {};
    for (const name of projectNames) {
      const created = await window.atlas.project.create({
        worldId,
        templateId: 'builtin.generic',
        templateVersion: '1.0.0',
        name,
      });
      if (!created.ok) throw new Error(created.error.code);
      out[name] = created.data.project.id;
    }
    return out;
  }, names);
  await page.reload();
  await finishOnboarding(page);
  return ids;
}

/** Pins through the preload API (setup only), then reloads so the bar shows it. */
async function pinThroughApi(
  pins: readonly {
    slot: number;
    target: { type: 'project' | 'service'; id: string };
  }[],
): Promise<void> {
  const failures = await page.evaluate(async (list) => {
    const worlds = await window.atlas.world.list();
    if (!worlds.ok) throw new Error(worlds.error.code);
    const worldId = worlds.data.worlds[0]?.id ?? '';
    const codes: string[] = [];
    for (const { slot, target } of list) {
      const result = await window.atlas.hotbar.assign({
        worldId,
        slot,
        target: target as never,
      });
      if (!result.ok) codes.push(result.error.code);
    }
    return codes;
  }, pins);
  expect(failures).toEqual([]);
  await page.reload();
  await finishOnboarding(page);
}

/** "Pin to hotbar" on a project row, then the slot with this key. */
async function pinThroughUi(name: string, key: string): Promise<void> {
  await item(page, name).getByRole('button', { name: 'Pin to hotbar' }).click();
  await pinDialog().locator(`button[data-slot="${key}"]`).click();
}

test('the bar shows ten labelled slots, empty ones saying so', async () => {
  for (const key of KEYS) {
    await expect(slotButton(key)).toHaveAccessibleName(`Slot ${key}: Empty`);
  }
  await expect(hotbarBar()).not.toContainText('not built yet');
});

test('§22.2 #2: ten pinned slots and an eleventh project survive a restart, nothing replaced', async () => {
  const names = KEYS.map((_, i) => `Project ${String(i + 1).padStart(2, '0')}`);
  await createProjects(names);
  for (const [i, name] of names.entries()) {
    const key = KEYS[i] ?? '';
    await pinThroughUi(name, key);
    await expect(projectsMessage(page)).toHaveText(
      `Pinned “${name}” to slot ${key}. Press ${key} to go to it.`,
    );
    await expect(pinDialog()).toHaveCount(0);
  }

  // An eleventh project, and an attempt to pin it over slot 1: the dialog names the shortcut
  // there, and Cancel changes nothing.
  await createProjectThroughUi(page, 'Project 11');
  await pinThroughUi('Project 11', '1');
  await expect(pinDialog().getByTestId('pin-occupant')).toHaveText(
    'Slot 1 holds the shortcut “Project 01”.',
  );
  await pinDialog().getByRole('button', { name: 'Cancel' }).click();
  await page.keyboard.press('Escape');
  await expect(pinDialog()).toHaveCount(0);

  const expectAllThere = async () => {
    for (const [i, name] of names.entries()) {
      const key = KEYS[i] ?? '';
      await expect(slotButton(key)).toHaveAccessibleName(`Slot ${key}: ${name}`);
    }
    const saved = await listProjects(page, await onlyWorldId(page));
    expect(saved.map((p) => p.name).sort()).toEqual([...names, 'Project 11'].sort());
  };
  await expectAllThere();

  await app.close();
  await launch();
  await expectAllThere();
  await expect(item(page, 'Project 11')).toBeVisible();
});

test('replacing asks first and names the shortcut; unpin says the project is not affected', async () => {
  const ids = await createProjects(['Alpha', 'Beta']);
  await pinThroughApi([{ slot: 2, target: { type: 'project', id: ids['Alpha'] ?? '' } }]);
  await expect(slotButton('3')).toHaveAccessibleName('Slot 3: Alpha');

  await pinThroughUi('Beta', '3');
  await expect(pinDialog().getByTestId('pin-occupant')).toHaveText(
    'Slot 3 holds the shortcut “Alpha”.',
  );
  await expect(pinDialog().getByRole('button', { name: 'Cancel' })).toBeFocused();
  await pinDialog().getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(projectsMessage(page)).toHaveText('Pinned “Beta” to slot 3. Press 3 to go to it.');
  await expect(slotButton('3')).toHaveAccessibleName('Slot 3: Beta');
  await expect(item(page, 'Alpha').getByTestId('pin-to-hotbar')).toHaveText('Pin to hotbar');
  await expect(item(page, 'Beta').getByTestId('pin-to-hotbar')).toHaveText('On hotbar (slot 3)');

  await hotbarBar().getByRole('button', { name: 'Unpin Beta from slot 3' }).click();
  await expect(page.getByTestId('hotbar-message')).toHaveText(
    'Unpinned “Beta” from slot 3. The project itself is not affected.',
  );
  await expect(slotButton('3')).toHaveAccessibleName('Slot 3: Empty');
  const saved = await listProjects(page, await onlyWorldId(page));
  expect(saved.map((p) => [p.name, p.status]).sort()).toEqual([
    ['Alpha', 'active'],
    ['Beta', 'active'],
  ]);
});

test('an archived pin says so in text and keeps its slot', async () => {
  const ids = await createProjects(['Gamma']);
  await pinThroughApi([{ slot: 4, target: { type: 'project', id: ids['Gamma'] ?? '' } }]);
  await item(page, 'Gamma').getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive project' }).click();
  await expect(slotButton('5')).toHaveAccessibleName('Slot 5: Gamma (archived)');
});

test('keys 1–0 select a project or open a service, but not while typing', async () => {
  const ids = await createProjects(['Delta']);
  await pinThroughApi([
    { slot: 0, target: { type: 'project', id: ids['Delta'] ?? '' } },
    { slot: 9, target: { type: 'service', id: 'settings' } },
  ]);
  await expect(slotButton('1')).toHaveAccessibleName('Slot 1: Delta');
  await expect(slotButton('0')).toHaveAccessibleName('Slot 0: Settings');

  // Typing a 1 into a field is just typing.
  const search = page.getByLabel('Search projects');
  await search.press('1');
  await expect(search).toHaveValue('1');
  await expect(page.getByTestId('inspector')).toContainText('Nothing selected.');
  await search.fill('');
  await search.blur();

  await page.keyboard.press('1');
  await expect(page.getByTestId('inspector')).toHaveAttribute(
    'data-project-id',
    ids['Delta'] ?? '',
  );

  await page.keyboard.press('0');
  await expect(
    page.getByTestId('entrance-panel').getByRole('heading', { name: 'Settings' }),
  ).toBeVisible();

  await page.keyboard.press('Escape');
  await page.keyboard.press('5');
  await expect(page.getByTestId('hotbar-message')).toHaveText(
    'Slot 5 is empty. Use “Pin to hotbar” on a project to fill it.',
  );
});

test('a service is pinned from its panel, and its key opens it', async () => {
  await page.locator('[data-entrance="agents"]').click();
  const panel = page.getByTestId('entrance-panel');
  await panel.getByRole('button', { name: 'Pin to hotbar' }).click();
  await pinDialog().locator('button[data-slot="2"]').click();
  await expect(panel.getByRole('status')).toHaveText(
    'Pinned “Agents Guild” to slot 2. Press 2 to go to it.',
  );
  await expect(slotButton('2')).toHaveAccessibleName('Slot 2: Agents Guild');

  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await page.keyboard.press('2');
  await expect(
    page.getByTestId('entrance-panel').getByRole('heading', { name: 'Agents Guild' }),
  ).toBeVisible();
});
