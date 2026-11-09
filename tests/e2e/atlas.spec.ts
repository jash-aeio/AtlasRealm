import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  centeredCamera,
  gridToWorld,
  worldToScreen,
  type GridPoint,
} from '../../src/renderer/world/projection';

// M0-5: the Realm Atlas graph (React Flow) and the world view (Pixi) share one selection,
// in the built app under the production CSP. All entities are M0 mock data.

let app: ElectronApplication;
let page: Page;
const consoleLines: string[] = [];
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'atlas-e2e-atlas-'));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== 'ELECTRON_RENDERER_URL',
    ),
  );
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env });
  page = await app.firstWindow();
  page.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
  await page.waitForLoadState('domcontentloaded');
  // Record CSP violations from the start of the load, before React Flow's code runs.
  await app.context().addInitScript(() => {
    const scope = window as unknown as { __cspViolations: string[] };
    scope.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      scope.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('world')).toHaveAttribute('data-state', 'ready');
});

test.afterAll(async () => {
  await app.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

const graphNode = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const world = () => page.getByTestId('world');

/** Reads one composited screen pixel (CSS coordinates in the window) from the main process. */
async function pixelAt(x: number, y: number) {
  const bgra = await app.evaluate(
    async ({ BrowserWindow }, point) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window === undefined) throw new Error('no window');
      const image = await window.webContents.capturePage({
        x: Math.round(point.x),
        y: Math.round(point.y),
        width: 1,
        height: 1,
      });
      return Array.from(image.toBitmap().subarray(0, 4));
    },
    { x, y },
  );
  const [b = 0, g = 0, r = 0] = bgra;
  return { r, g, b };
}

/** Selection highlight 0x6bc6f2 (light blue); ground 0x34503a and markers 0xc9a26b aren't. */
const isSelectionBlue = ({ r, g, b }: { r: number; g: number; b: number }) =>
  b > 200 && g > 150 && r < 160;

/**
 * Window coordinates of a point inside `tile`, beside its centred marker, so the pixel shows
 * the selection fill. Assumes the default camera (Reset view), the same maths the app uses.
 */
async function besideMarker(tile: GridPoint) {
  const host = await page.evaluate(() => {
    const element = document.querySelector<HTMLElement>('[data-testid="world-canvas-host"]');
    if (element === null) throw new Error('no world host');
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left + element.clientLeft,
      top: rect.top + element.clientTop,
      width: element.clientWidth,
      height: element.clientHeight,
    };
  });
  const camera = centeredCamera(host.width, host.height, 0.5);
  // 0.35 tile left of centre: inside the tile diamond, outside the half-size marker.
  const centre = worldToScreen(gridToWorld({ gx: tile.gx + 0.5, gy: tile.gy + 0.5 }), camera);
  return { x: host.left + centre.x - 0.35 * 64 * camera.zoom, y: host.top + centre.y };
}

async function resetWorldView() {
  await world().getByRole('button', { name: 'Reset view', exact: true }).click();
  // Keep the cursor off the canvas so the hover outline can't change sampled pixels.
  await page.mouse.move(2, 2);
}

test('the Connections graph renders in the upper-right panel without CSP violations', async () => {
  const atlas = page.getByTestId('atlas');
  await expect(atlas).toContainText('M0 spike · mock data');
  await expect(page.getByTestId('atlas-dataset')).toHaveText(
    'Small mock graph: 8 entities, 8 links',
  );
  await expect(page.locator('.react-flow__node')).toHaveCount(8);
  await expect(page.locator('.react-flow__edge')).toHaveCount(8);
  await expect(graphNode('mock-website')).toHaveText('Website');

  // Upper right: to the right of the world, starting level with it.
  const atlasBox = await atlas.boundingBox();
  const worldBox = await world().boundingBox();
  if (atlasBox === null || worldBox === null) throw new Error('layout not visible');
  expect(atlasBox.x).toBeGreaterThan(worldBox.x + worldBox.width - 1);
  expect(Math.abs(atlasBox.y - worldBox.y)).toBeLessThan(24);

  // React Flow's stylesheet really applied (bundled CSS, not blocked): its viewport is absolute.
  const position = await page
    .locator('.react-flow__viewport')
    .evaluate((element) => getComputedStyle(element).position);
  expect(position).toBe('absolute');

  const violations = await page.evaluate(
    () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
  );
  expect(violations).toEqual([]);
  expect(consoleLines.filter((line) => line.startsWith('error'))).toEqual([]);
});

test('selecting a graph node highlights the same entity in the Pixi world', async () => {
  await resetWorldView();
  const tile = { gx: 28, gy: 34 }; // mock-website
  const point = await besideMarker(tile);
  // Control: before selection the spot is ground, not the highlight.
  expect(isSelectionBlue(await pixelAt(point.x, point.y))).toBe(false);

  await graphNode('mock-website').click();
  await expect(graphNode('mock-website')).toHaveClass(/selected/);
  await expect(page.getByTestId('atlas-selection')).toHaveText(
    'Selected: Website (mock-website) · chosen in Connections',
  );
  await expect(world()).toHaveAttribute('data-selected-entity', 'mock-website');
  await expect(world()).toHaveAttribute('data-selected-tile', '28,34');
  await expect(page.getByTestId('world-selection')).toHaveText(
    'Highlighted in world: Website (mock-website) on tile 28,34',
  );
  // The Pixi scene really drew it.
  await expect.poll(async () => isSelectionBlue(await pixelAt(point.x, point.y))).toBe(true);

  // Selecting another node moves the highlight: old tile back to ground, one node selected.
  await graphNode('mock-thesis').click();
  await expect(world()).toHaveAttribute('data-selected-entity', 'mock-thesis');
  await expect.poll(async () => isSelectionBlue(await pixelAt(point.x, point.y))).toBe(false);
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
});

test('clicking a marker in the world selects the same node in the graph', async () => {
  await resetWorldView();
  const point = await besideMarker({ gx: 36, gy: 32 }); // mock-garden
  await page.mouse.click(point.x, point.y);
  await expect(world()).toHaveAttribute('data-selected-entity', 'mock-garden');
  await expect(graphNode('mock-garden')).toHaveClass(/selected/);
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
  await expect(page.getByTestId('atlas-selection')).toHaveText(
    'Selected: Garden planner (mock-garden) · chosen in world view',
  );

  // Clicking empty ground clears the selection in both views.
  const empty = await besideMarker({ gx: 32, gy: 32 });
  await page.mouse.click(empty.x, empty.y);
  await expect(world()).not.toHaveAttribute('data-selected-entity');
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(0);
  await expect(page.getByTestId('atlas-selection')).toContainText('Nothing selected');
});

test('keyboard selection works through the list view and a focused graph node', async () => {
  await page.getByText('List view').click();
  const listButton = page
    .getByTestId('atlas-entity-list')
    .getByRole('button', { name: 'Budget sheet' });
  await listButton.focus();
  await page.keyboard.press('Enter');
  await expect(listButton).toHaveAttribute('aria-pressed', 'true');
  await expect(world()).toHaveAttribute('data-selected-entity', 'mock-budget');
  await expect(graphNode('mock-budget')).toHaveClass(/selected/);

  // React Flow nodes are focusable; Enter on a focused node selects it through the store.
  await graphNode('mock-recipes').focus();
  await page.keyboard.press('Enter');
  await expect(world()).toHaveAttribute('data-selected-entity', 'mock-recipes');
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
  await page.getByText('List view').click();
});

test('selection survives hiding the world, and a new scene draws it at once', async () => {
  await graphNode('mock-photos').click();
  const toggle = page.getByRole('button', { name: /world view/ });
  await toggle.click(); // hide: the projects (mock entities) and selection stay
  await expect(world()).toHaveCount(0);
  await expect(page.getByTestId('atlas-selection')).toContainText('mock-photos');
  await graphNode('mock-gamejam').click(); // select while no world exists
  await toggle.click(); // show: a brand-new Pixi scene
  await expect(world()).toHaveAttribute('data-state', 'ready');
  await expect(world()).toHaveAttribute('data-selected-entity', 'mock-gamejam');
  await page.mouse.move(2, 2);
  const point = await besideMarker({ gx: 29, gy: 32 });
  await expect.poll(async () => isSelectionBlue(await pixelAt(point.x, point.y))).toBe(true);
});

test('performance check: 150 nodes / 300 edges (GRAPH_MODEL §30.6)', async () => {
  // Time from the click to every node and edge being in the DOM and painted.
  const loadMs = await page.evaluate(async () => {
    const button = document.querySelector<HTMLButtonElement>('[data-testid="atlas-stress-toggle"]');
    if (button === null) throw new Error('no stress toggle');
    const start = performance.now();
    button.click();
    for (;;) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const nodes = document.querySelectorAll('.react-flow__node').length;
      const edges = document.querySelectorAll('.react-flow__edge').length;
      if (nodes === 150 && edges === 300) break;
      if (performance.now() - start > 10_000)
        throw new Error(`stuck at ${String(nodes)}/${String(edges)}`);
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return performance.now() - start;
  });
  await expect(page.getByTestId('atlas-dataset')).toContainText('150 entities, 300 links');

  // Time from a node click to the world view showing the same ID.
  const selectMs = await page.evaluate(async () => {
    const node = document.querySelector<HTMLElement>('.react-flow__node[data-id="stress-77"]');
    const worldSection = document.querySelector('[data-testid="world"]');
    if (node === null || worldSection === null) throw new Error('missing elements');
    const start = performance.now();
    node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    while (worldSection.getAttribute('data-selected-entity') !== 'stress-77') {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (performance.now() - start > 5_000) throw new Error('selection never arrived');
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return performance.now() - start;
  });
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);

  // Frame times while zooming the graph with the wheel (real input from Playwright).
  await page.evaluate(() => {
    const scope = window as unknown as { __frames: number[]; __recording: boolean };
    scope.__frames = [];
    scope.__recording = true;
    let last = performance.now();
    const tick = (now: number) => {
      scope.__frames.push(now - last);
      last = now;
      if (scope.__recording) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const graphBox = await page.getByTestId('atlas-graph').boundingBox();
  if (graphBox === null) throw new Error('graph not visible');
  await page.mouse.move(graphBox.x + graphBox.width / 2, graphBox.y + graphBox.height / 2);
  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, i < 10 ? -120 : 120);
  const frames = await page.evaluate(() => {
    const scope = window as unknown as { __frames: number[]; __recording: boolean };
    scope.__recording = false;
    return scope.__frames.slice(1).sort((a, b) => a - b);
  });
  const percentile = (p: number) =>
    frames[Math.min(frames.length - 1, Math.floor(frames.length * p))] ?? 0;
  const result = {
    loadMs: Math.round(loadMs),
    selectMs: Math.round(selectMs),
    frames: frames.length,
    frameP50Ms: Math.round(percentile(0.5) * 10) / 10,
    frameP95Ms: Math.round(percentile(0.95) * 10) / 10,
    frameMaxMs: Math.round((frames.at(-1) ?? 0) * 10) / 10,
  };
  test.info().annotations.push({ type: 'stress-graph', description: JSON.stringify(result) });
  console.log(`[atlas perf] ${JSON.stringify(result)}`);

  // Loose ceilings so slow CI runners pass; the real numbers are recorded on the issue.
  expect(result.loadMs).toBeLessThan(3000);
  expect(result.selectMs).toBeLessThan(500);
  expect(consoleLines.filter((line) => line.startsWith('error'))).toEqual([]);

  // Back to the small graph: the stress selection doesn't exist there, so it's cleared.
  await page.getByTestId('atlas-stress-toggle').click();
  await expect(page.locator('.react-flow__node')).toHaveCount(8);
  await expect(world()).not.toHaveAttribute('data-selected-entity');
});
