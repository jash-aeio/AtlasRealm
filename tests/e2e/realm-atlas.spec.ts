import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clippedViewport, mapBuildings } from '../../src/renderer/atlas/map-geometry';
import { worldToScreen, type Camera } from '../../src/renderer/world/projection';
import { viewportWorldRect } from '../../src/renderer/world/world-camera';
import type { PlacementSummary } from '../../src/common/contracts/placement';
import { finishOnboarding } from './support/onboarding';

// The real Realm Atlas (M2-12 #77, GRAPH_MODEL §30.1, UI_SPEC §6.1 / §6.6) in the built app: the
// Map drawn from saved placements, selection without camera jumps, "Go to" and follow-selection,
// collapse / expand / resize / pin saved per world, and the narrow drawer that docks beside the
// world. The M0 mock-data Atlas is covered by atlas.spec.ts under Developer spikes.

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
const WINDOW = { width: 1280, height: 800 };

/** Names of the seeded projects; the first three get buildings, the last has none. */
const PLACED = [
  { name: 'Orchard', x: 8, y: 8 },
  { name: 'Harbour', x: 40, y: 12 },
  { name: 'Tower', x: 20, y: 44 },
] as const;
const UNPLACED = 'Notebook';

let worldId = '';
const projectIds = new Map<string, string>();

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'atlas-e2e-realm-atlas-'));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== 'ELECTRON_RENDERER_URL',
    ),
  );
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await setSize(WINDOW.width, WINDOW.height);
  await finishOnboarding(page);

  const seeded = await page.evaluate(
    async ({ placed, unplaced }) => {
      const must = <T>(
        result: { ok: true; data: T } | { ok: false; error: { code: string } },
      ): T => {
        if (!result.ok) throw new Error(result.error.code);
        return result.data;
      };
      const id = must(await window.atlas.world.list()).worlds[0]?.id ?? '';
      const ids: [string, string][] = [];
      for (const name of [...placed.map((p) => p.name), unplaced]) {
        const { project } = must(
          await window.atlas.project.create({
            worldId: id,
            templateId: 'builtin.generic',
            templateVersion: '1.0.0',
            name,
          }),
        );
        ids.push([name, project.id]);
        const spot = placed.find((p) => p.name === name);
        if (spot !== undefined) {
          must(
            await window.atlas.placement.create({
              worldId: id,
              projectId: project.id,
              tileX: spot.x,
              tileY: spot.y,
              rotation: 0,
            }),
          );
        }
      }
      return { worldId: id, ids };
    },
    { placed: PLACED.map((p) => ({ ...p })), unplaced: UNPLACED },
  );
  worldId = seeded.worldId;
  for (const [name, id] of seeded.ids) projectIds.set(name, id);
  await page.reload();
  await showWorld();
});

test.afterAll(async () => {
  await app.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

async function setSize(width: number, height: number): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
    },
    { width, height },
  );
}

/** Main screen with no panel over the world and the world renderer ready. */
async function showWorld(): Promise<void> {
  await expect(page.locator('main[data-screen="main"]')).toBeVisible();
  const panel = page.getByTestId('entrance-panel');
  if (await panel.isVisible()) await panel.getByRole('button', { name: 'Back to world' }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('world-view')).toHaveAttribute('data-state', 'ready');
}

const atlas = (): Locator => page.getByTestId('realm-atlas');
const mapSvg = (): Locator => atlas().locator('svg.atlas-map-svg');
const building = (name: string): Locator =>
  mapSvg().locator(`polygon[data-project-id="${projectIds.get(name) ?? ''}"]`);
const host = (): Locator => page.getByTestId('world-view-host');
const sideColumn = (): Locator =>
  page.getByRole('complementary', { name: 'Realm Atlas and inspector' });

async function camera(): Promise<Camera> {
  const [panX = NaN, panY = NaN, zoom = NaN] = ((await host().getAttribute('data-camera')) ?? '')
    .split(',')
    .map(Number);
  if (Number.isNaN(zoom)) throw new Error('no camera yet');
  return { panX, panY, zoom };
}

async function placements(): Promise<PlacementSummary[]> {
  return page.evaluate(async (id) => {
    const result = await window.atlas.placement.list({ worldId: id });
    if (!result.ok) throw new Error(result.error.code);
    return result.data.placements;
  }, worldId);
}

/** Where a project's building centre is on the world canvas, through the real camera. */
async function screenCentreOf(name: string) {
  const all = mapBuildings(await placements());
  const target = all.find((b) => b.projectId === projectIds.get(name));
  if (target === undefined) throw new Error(`${name} has no building`);
  return worldToScreen(target.centre, await camera());
}

async function expectCentredOn(name: string): Promise<void> {
  const size = await host().evaluate((el) => ({ w: el.clientWidth, h: el.clientHeight }));
  await expect
    .poll(async () => {
      const point = await screenCentreOf(name);
      return Math.hypot(point.x - size.w / 2, point.y - size.h / 2);
    })
    .toBeLessThan(1);
}

async function select(name: string): Promise<void> {
  await building(name).click();
  await expect(building(name)).toHaveAttribute('data-selected', 'true');
}

test('the Map draws the world bounds, every saved building and the camera viewport', async () => {
  await expect(atlas().getByRole('tab', { name: 'Map' })).toHaveAttribute('aria-selected', 'true');
  await expect(mapSvg()).toHaveAttribute('data-buildings', String(PLACED.length));
  await expect(mapSvg().locator('polygon.atlas-map-ground')).toHaveCount(1);
  await expect(mapSvg().locator('polygon.atlas-map-building')).toHaveCount(PLACED.length);
  for (const { name } of PLACED) await expect(building(name)).toHaveCount(1);
  // The project with no building is not on the Map (the Map shows geography, not existence).
  await expect(building(UNPLACED)).toHaveCount(0);
  await expect(atlas().getByTestId('atlas-map-status')).toContainText(
    `64 × 64 tiles · ${String(PLACED.length)} buildings · Viewport shown`,
  );

  // The viewport rectangle is the part of the world the camera really shows.
  const size = await host().evaluate((el) => ({ width: el.clientWidth, height: el.clientHeight }));
  const expected = clippedViewport(viewportWorldRect({ camera: await camera(), ...size }), {
    columns: 64,
    rows: 64,
  });
  expect(expected).not.toBeNull();
  await expect(mapSvg()).toHaveAttribute(
    'data-viewport',
    [expected?.left, expected?.top, expected?.right, expected?.bottom]
      .map((n) => (n ?? 0).toFixed(1))
      .join(','),
  );
  // Zooming the world changes the viewport on the Map.
  const before = await mapSvg().getAttribute('data-viewport');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(mapSvg()).not.toHaveAttribute('data-viewport', before ?? '');
  await page.getByRole('button', { name: 'Reset view' }).click();
});

test('clicking a building on the Map selects it without moving the camera', async () => {
  const cameraBefore = await host().getAttribute('data-camera');
  await select('Harbour');
  await expect(page.getByTestId('inspector')).toContainText('Harbour');
  const harbour = (await placements()).find((p) => p.projectName === 'Harbour');
  await expect(page.getByTestId('world-view')).toHaveAttribute(
    'data-selected-placement',
    harbour?.id ?? '',
  );
  // The list equivalent selects too, also without a camera move.
  await atlas().getByTestId('atlas-map-list').locator('summary').click();
  await atlas()
    .getByRole('button', { name: /^Orchard/ })
    .click();
  await expect(building('Orchard')).toHaveAttribute('data-selected', 'true');
  await expect(building('Harbour')).not.toHaveAttribute('data-selected', 'true');
  expect(await host().getAttribute('data-camera')).toBe(cameraBefore);
});

test('"Go to" moves the camera only when pressed, and follow-selection is a toggle', async () => {
  await select('Tower');
  const still = await host().getAttribute('data-camera');
  await atlas().getByTestId('atlas-go-to').click();
  await expectCentredOn('Tower');
  await expect(atlas().getByTestId('atlas-camera-message')).toHaveText('Camera moved to Tower.');
  expect(await host().getAttribute('data-camera')).not.toBe(still);

  // Follow off (the default): a new selection leaves the camera alone.
  const follow = atlas().getByTestId('atlas-follow');
  await expect(follow).not.toBeChecked();
  let cameraBefore = await host().getAttribute('data-camera');
  await select('Orchard');
  expect(await host().getAttribute('data-camera')).toBe(cameraBefore);

  // Switching follow on moves nothing by itself; the next selection does.
  await follow.check();
  expect(await host().getAttribute('data-camera')).toBe(cameraBefore);
  await select('Harbour');
  await expectCentredOn('Harbour');

  // Never while the placement tool is open (§30.1: no camera jump while editing).
  await page.getByTestId('inspector').getByRole('button', { name: 'Move building' }).click();
  await expect(page.getByTestId('placement-tool')).toBeVisible();
  await expect(atlas().getByTestId('atlas-go-to')).toBeDisabled();
  cameraBefore = await host().getAttribute('data-camera');
  await atlas()
    .getByRole('button', { name: /^Tower/ })
    .click();
  expect(await host().getAttribute('data-camera')).toBe(cameraBefore);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('placement-tool')).toHaveCount(0);
  await follow.uncheck();
});

test('collapse, expand, resize and pin are saved per world and shown after a reload', async () => {
  const widthOf = async () => (await sideColumn().boundingBox())?.width ?? 0;
  const normalWidth = await widthOf();

  // Pin: the indicator names the project and stays while the panel is collapsed.
  await select('Orchard');
  await atlas().getByTestId('atlas-pin-button').click();
  await expect(atlas().getByTestId('atlas-pin')).toContainText('Pinned to: Orchard');
  await expect(building('Orchard')).toHaveAttribute('data-pinned', 'true');
  await expect(atlas().locator('circle.atlas-map-pin')).toHaveCount(1);
  // Pinned, "Go to" goes to the pinned project even with another one selected.
  await select('Harbour');
  await atlas().getByTestId('atlas-go-to').click();
  await expectCentredOn('Orchard');

  // Resize with the keyboard (left widens: the handle is on the column's left edge).
  const handle = page.getByTestId('atlas-resize');
  await expect(handle).toHaveAttribute('aria-valuenow', '320');
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '368');
  await expect.poll(widthOf).toBeGreaterThan(normalWidth + 40);

  // Expand gives the larger size; the handle goes away until it is turned off again.
  await atlas().getByTestId('atlas-expand').click();
  await expect(atlas().getByTestId('atlas-expand')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(widthOf).toBeGreaterThan(normalWidth + 200);
  await expect(handle).toHaveCount(0);

  await atlas().getByTestId('atlas-collapse').click();
  await expect(atlas()).toHaveAttribute('data-collapsed', 'true');
  await expect(atlas().getByRole('tab', { name: 'Map' })).toHaveCount(0);
  await expect(atlas().getByTestId('atlas-pin')).toContainText('Pinned to: Orchard');

  // Saved: the main process has it, and a reload shows it.
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const result = await window.atlas.profile.atlasView.get();
        return result.ok ? result.data.views[id] : null;
      }, worldId),
    )
    .toEqual({
      tab: 'map',
      collapsed: true,
      expanded: true,
      width: 368,
      pinnedProjectId: projectIds.get('Orchard'),
      followSelection: false,
    });
  await page.reload();
  await showWorld();
  await expect(atlas()).toHaveAttribute('data-collapsed', 'true');
  await expect(atlas()).toHaveAttribute('data-expanded', 'true');
  await expect(atlas().getByTestId('atlas-pin')).toContainText('Pinned to: Orchard');

  // Another world starts with its own defaults, and coming back shows this world's choices.
  const second = await page.evaluate(async () => {
    const result = await window.atlas.world.create({ name: 'Second World' });
    if (!result.ok) throw new Error(result.error.code);
    return result.data.world.id;
  });
  await page.reload();
  await showWorld();
  const picker = page.getByLabel('World', { exact: true });
  await picker.selectOption(second);
  await expect(atlas()).toHaveAttribute('data-collapsed', 'false');
  await expect(atlas()).toHaveAttribute('data-expanded', 'false');
  await expect(atlas().getByTestId('atlas-pin')).toHaveCount(0);
  await expect(atlas().locator('svg.atlas-map-svg')).toHaveAttribute('data-buildings', '0');
  await picker.selectOption(worldId);
  await expect(atlas()).toHaveAttribute('data-collapsed', 'true');

  // Unpin, show again and back to the normal size for the next tests.
  await atlas().getByRole('button', { name: 'Unpin' }).click();
  await expect(atlas().getByTestId('atlas-pin')).toHaveCount(0);
  await atlas().getByTestId('atlas-collapse').click();
  await atlas().getByTestId('atlas-expand').click();
  await expect(atlas()).toHaveAttribute('data-expanded', 'false');
});

test('the Connections tab is labelled as not built yet; the tabs work by keyboard', async () => {
  const mapTab = atlas().getByRole('tab', { name: 'Map' });
  await mapTab.focus();
  await page.keyboard.press('ArrowRight');
  const connections = atlas().getByRole('tab', { name: 'Connections' });
  await expect(connections).toHaveAttribute('aria-selected', 'true');
  await expect(connections).toBeFocused();
  await expect(atlas().getByTestId('atlas-connections')).toContainText(
    'Not built yet (planned later in M2)',
  );
  await page.keyboard.press('Home');
  await expect(mapTab).toHaveAttribute('aria-selected', 'true');
});

test('the narrow-window drawer docks beside the world and covers no editing controls', async () => {
  const toggle = page.getByRole('button', { name: 'Atlas & inspector', exact: true });
  const overlaps = (
    a: { x: number; y: number; width: number; height: number } | null,
    b: { x: number; y: number; width: number; height: number } | null,
  ) =>
    a !== null &&
    b !== null &&
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height;
  try {
    await setSize(900, 700);
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(sideColumn()).toBeVisible();
    // Open an editing panel (Projects) over the world, and start the placement tool.
    await page
      .getByRole('navigation', { name: 'Entrances' })
      .getByRole('button', { name: 'Projects', exact: true })
      .click();
    await expect(page.getByTestId('entrance-panel')).toBeVisible();
    const side = await sideColumn().boundingBox();
    for (const control of [
      page.getByTestId('entrance-panel'),
      page.getByTestId('world-area'),
      page.locator('.world-toolbar'),
      page.locator('.top-bar'),
      page.locator('.bottom-bar'),
    ]) {
      expect(overlaps(side, await control.boundingBox())).toBe(false);
    }
    await page.getByTestId('entrance-panel').getByRole('button', { name: 'Back to world' }).click();
    await select('Tower');
    await page.getByTestId('inspector').getByRole('button', { name: 'Move building' }).click();
    await expect(page.getByTestId('placement-tool')).toBeVisible();
    for (const control of [
      page.getByTestId('placement-tool'),
      page.getByTestId('placement-history'),
    ]) {
      expect(overlaps(await sideColumn().boundingBox(), await control.boundingBox())).toBe(false);
    }
    await page.keyboard.press('Escape');
  } finally {
    await setSize(WINDOW.width, WINDOW.height);
  }
  await expect(toggle).toBeHidden();
});

test('no "mock data" outside Developer spikes; the stress graph lives there', async () => {
  const mainText = await page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelector('details.developer-spikes')?.remove();
    return clone.innerText;
  });
  expect(mainText.toLowerCase()).not.toContain('mock');
  await expect(page.getByTestId('atlas-stress-toggle')).toHaveCount(0);
  const spikes = page.locator('details.developer-spikes');
  await spikes.locator(':scope > summary').click();
  await expect(spikes.getByTestId('atlas-stress-toggle')).toBeVisible();
  await expect(spikes.getByText('M0 spike · mock data')).toBeVisible();
  await spikes.locator(':scope > summary').click();
});
