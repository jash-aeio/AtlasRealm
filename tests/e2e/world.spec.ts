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
  DEFAULT_MAP,
  gridToWorld,
  pickTile,
  screenToWorld,
  worldToScreen,
  type Camera,
  type GridPoint,
  type Point,
} from '../../src/renderer/world/projection';
import { mapWorldBounds } from '../../src/renderer/world/comfort';
import { finishOnboarding, openDeveloperSpikes } from './support/onboarding';

// The world on the main screen (M2-6 #71; renderer since M0-4), inside the built app under the
// production CSP: saved buildings, selection, the inspector and details, culling, and the
// renderer's failure paths.
//
// Pointer tests never assume where the map is. The world writes its real camera to the host's
// `data-camera`, and the expected tile is worked out from it with the same projection code the
// app uses. That replaces the old fixed-offset assertions, which flaked when the layout or
// camera differed slightly from what the test assumed ("hover, wheel zoom and middle-drag pan").

interface Launched {
  app: ElectronApplication;
  page: Page;
  consoleLines: string[];
  close: () => Promise<void>;
}

/** A fixed window, so the world area (and so the off-map corners) is the same on every run. */
const WINDOW = { width: 1280, height: 800 };

/**
 * Launches the built app on the main screen with the startup Projects panel closed. `initScript`
 * runs in the page before any app code on every load, which is how the failure tests take
 * graphics APIs away without test hooks in app code.
 */
async function launch(initScript?: () => void): Promise<Launched> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'atlas-e2e-world-'));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== 'ELECTRON_RENDERER_URL',
    ),
  );
  const app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env });
  const page = await app.firstWindow();
  const consoleLines: string[] = [];
  page.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
  }, WINDOW);
  // Record CSP violations from the very start of each load (before any app code), so a test
  // can assert none happened while Pixi starts under the strict CSP.
  await app.context().addInitScript(() => {
    const scope = window as unknown as { __cspViolations: string[] };
    scope.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      scope.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  if (initScript !== undefined) await app.context().addInitScript(initScript);
  // Reload so the init scripts run on a fresh page load.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await showWorld(page);
  return {
    app,
    page,
    consoleLines,
    close: async () => {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

/** Main screen with no panel over the world. */
async function showWorld(page: Page): Promise<void> {
  await finishOnboarding(page);
  const panel = page.getByTestId('entrance-panel');
  if (await panel.isVisible()) await panel.getByRole('button', { name: 'Back to world' }).click();
  await expect(panel).toHaveCount(0);
}

const worldView = (page: Page) => page.getByTestId('world-view');
const host = (page: Page) => page.getByTestId('world-view-host');

async function hostBox(page: Page) {
  const box = await host(page).boundingBox();
  if (box === null) throw new Error('world host not visible');
  return box;
}

/** The camera the world is really using right now. */
async function camera(page: Page): Promise<Camera> {
  const value = await host(page).getAttribute('data-camera');
  const [panX, panY, zoom] = (value ?? '').split(',').map(Number);
  if (panX === undefined || panY === undefined || zoom === undefined || Number.isNaN(zoom)) {
    throw new Error(`no camera yet: ${String(value)}`);
  }
  return { panX, panY, zoom };
}

/** Window coordinates of a grid point, through the real camera. */
async function windowPointOf(page: Page, grid: GridPoint): Promise<Point> {
  const box = await hostBox(page);
  const screen = worldToScreen(gridToWorld(grid), await camera(page));
  return { x: box.x + screen.x, y: box.y + screen.y };
}

/** The hover text the world should show for a window point, from the real camera. */
async function expectedHover(page: Page, point: Point): Promise<string> {
  const box = await hostBox(page);
  const tile = pickTile(
    { x: point.x - box.x, y: point.y - box.y },
    await camera(page),
    DEFAULT_MAP,
  );
  return tile === null
    ? 'Hover the map to see a tile. Click a building to select its project.'
    : `Tile ${String(tile.gx)}, ${String(tile.gy)}`;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Reads one composited screen pixel (CSS coordinates in the window) from the main process. */
async function pixelAt(app: ElectronApplication, x: number, y: number): Promise<Rgb> {
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

/** Placeholder ground is grass 0x4f7a3f: green clearly dominates. Background ink is near black. */
const isGround = ({ r, g, b }: Rgb) => g > r + 15 && g > b + 10 && g > 50;
const isBackground = ({ r, g, b }: Rgb) => r < 40 && g < 40 && b < 45;

interface PlacedProject {
  readonly projectId: string;
  readonly placementId: string | null;
}

/**
 * Creates projects through the preload API (the same commands the UI uses) and places the ones
 * with a tile. `archive: true` archives the project and then places it again: archiving
 * removes a building (ADR-0025), and an archived project may be placed afterwards.
 */
async function createProjects(
  page: Page,
  specs: readonly { name: string; tile?: GridPoint; archive?: boolean }[],
): Promise<PlacedProject[]> {
  return page.evaluate(async (list) => {
    const must = <T>(result: { ok: true; data: T } | { ok: false; error: { code: string } }): T => {
      if (!result.ok) throw new Error(result.error.code);
      return result.data;
    };
    const worldId = must(await window.atlas.world.list()).worlds[0]?.id ?? '';
    const created: { projectId: string; placementId: string | null }[] = [];
    for (const spec of list) {
      let project = must(
        await window.atlas.project.create({
          worldId,
          templateId: 'builtin.generic',
          templateVersion: '1.0.0',
          name: spec.name,
        }),
      ).project;
      if (spec.archive === true) {
        project = must(
          await window.atlas.project.archive({
            worldId,
            projectId: project.id,
            expectedRevision: project.revision,
          }),
        ).project;
      }
      let placementId: string | null = null;
      if (spec.tile !== undefined) {
        placementId = must(
          await window.atlas.placement.create({
            worldId,
            projectId: project.id,
            tileX: spec.tile.gx,
            tileY: spec.tile.gy,
            rotation: 0,
          }),
        ).placement.id;
      }
      created.push({ projectId: project.id, placementId });
    }
    return created;
  }, specs);
}

/** Reloads so the world reads the buildings the test just saved, then waits for them. */
async function reloadWorld(page: Page, buildings: number): Promise<void> {
  await page.reload();
  await showWorld(page);
  await expect(worldView(page)).toHaveAttribute('data-state', 'ready');
  await expect(worldView(page)).toHaveAttribute('data-buildings', String(buildings));
}

async function resetView(page: Page): Promise<void> {
  await worldView(page).getByRole('button', { name: 'Reset view', exact: true }).click();
}

test.describe('world view with graphics available', () => {
  let launched: Launched;
  test.beforeAll(async () => {
    // Only observes: records every WebGL context the page creates, so the leak test can
    // count the ones still alive. Contexts are returned unchanged.
    launched = await launch(() => {
      const contexts: WebGLRenderingContext[] = [];
      (window as unknown as { __glContexts: WebGLRenderingContext[] }).__glContexts = contexts;
      // Read via the descriptor: we call it with an explicit `this` below.
      const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')
        ?.value as (...a: unknown[]) => unknown;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        ...args: never[]
      ) {
        const context = original.apply(this, args);
        if (String(args[0]).includes('webgl') && context !== null) {
          if (!contexts.includes(context as WebGLRenderingContext)) {
            contexts.push(context as WebGLRenderingContext);
          }
        }
        return context;
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
  });
  test.afterAll(async () => {
    await launched.close();
  });

  test('renders the empty world with an allowed renderer under the production CSP', async () => {
    const { page } = launched;
    const world = worldView(page);
    await expect(world).toHaveAttribute('data-state', 'ready');
    const renderer = await world.getAttribute('data-renderer');
    test.info().annotations.push({ type: 'renderer', description: String(renderer) });
    expect(['webgl', 'canvas']).toContain(renderer);
    await expect(world).toHaveAttribute('data-buildings', '0');
    await expect(page.getByTestId('world-view-status')).toContainText(
      '64 × 64 tiles · 0 buildings (placeholder art)',
    );
    await expect(page.getByTestId('world-view-empty')).toContainText('Not placed');
    await expect(host(page).locator('canvas')).toHaveCount(1);
    // No mock data in the product view: the M0 marker world only lives under Developer spikes.
    await expect(page.getByTestId('world')).toHaveCount(0);
    await expect(page.getByTestId('world-area')).not.toContainText(/mock/i);

    const violations = await page.evaluate(
      () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
    );
    expect(violations).toEqual([]);
    expect(launched.consoleLines.filter((line) => line.startsWith('error'))).toEqual([]);
  });

  test('loads the building and selection sprites as real PNGs from app://atlas', async () => {
    const { page } = launched;
    // Chromium records no resource-timing entry for the first, uncached app:// fetch of an
    // image (see also packaged.spec.ts), so reload once and read the cached load.
    await page.reload();
    await showWorld(page);
    await expect(worldView(page)).toHaveAttribute('data-state', 'ready');
    // The scene loads its art before it reports ready, so the requests have already happened.
    const images = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((entry) => (entry as PerformanceResourceTiming).initiatorType === 'img')
        .map((entry) => entry.name),
    );
    // Real files (inlining is off), not data: URIs, served by our app:// handler.
    expect(images).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^app:\/\/atlas\/assets\/building-2x2-[\w-]+\.png$/),
        expect.stringMatching(/^app:\/\/atlas\/assets\/selection-[\w-]+\.png$/),
      ]),
    );
    expect(images.filter((url) => !url.startsWith('app://atlas/'))).toEqual([]);
    // Pixi's Assets loader is not used, so no blob: workers were needed (our CSP blocks them).
    const violations = await page.evaluate(
      () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
    );
    expect(violations).toEqual([]);
  });

  test('draws real pixels: ground in the centre, background beyond the map edge', async () => {
    const { app, page } = launched;
    // At 0.5× the map covers the whole view; zoom out to ~0.26× so the corners are off-map.
    for (let i = 0; i < 3; i++)
      await worldView(page).getByRole('button', { name: 'Zoom out', exact: true }).click();
    await expect(page.getByTestId('world-view-status')).toContainText('Zoom 26%');
    await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(0.256, 3);
    const centre = await windowPointOf(page, { gx: 32.5, gy: 32.5 });
    await expect.poll(async () => isGround(await pixelAt(app, centre.x, centre.y))).toBe(true);
    const box = await hostBox(page);
    // Poll this too: the centre is ground at 50% as well, so the poll above can pass before
    // the 26% frame is composited (seen once in CI).
    await expect
      .poll(async () => isBackground(await pixelAt(app, box.x + 8, box.y + 8)))
      .toBe(true);
    await resetView(page);
    await expect(page.getByTestId('world-view-status')).toContainText('Zoom 50%');
  });

  test('hover, wheel zoom and middle-drag pan follow the real camera', async () => {
    const { page } = launched;
    const hover = page.getByTestId('world-view-hover');
    await resetView(page);
    const point = await windowPointOf(page, { gx: 32.5, gy: 32.5 });
    await page.mouse.move(point.x, point.y);
    await expect(hover).toHaveText('Tile 32, 32');

    // Zooming around the cursor keeps the same world point under it.
    const beforeZoom = await camera(page);
    await page.mouse.wheel(0, -100);
    await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(0.625, 6);
    const afterZoom = await camera(page);
    const box = await hostBox(page);
    const local = { x: point.x - box.x, y: point.y - box.y };
    const anchorBefore = screenToWorld(local, beforeZoom);
    const anchorAfter = screenToWorld(local, afterZoom);
    // Within one world pixel: the browser reports the pointer in whole CSS pixels.
    expect(Math.abs(anchorAfter.x - anchorBefore.x)).toBeLessThan(1);
    expect(Math.abs(anchorAfter.y - anchorBefore.y)).toBeLessThan(1);
    await page.mouse.move(point.x + 1, point.y);
    await page.mouse.move(point.x, point.y);
    await expect(hover).toHaveText('Tile 32, 32');
    await resetView(page);

    // Middle-drag 64 px right moves the camera exactly 64 px right.
    const beforePan = await camera(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(point.x + 32, point.y);
    await page.mouse.move(point.x + 64, point.y);
    await page.mouse.up({ button: 'middle' });
    await expect.poll(async () => (await camera(page)).panX).toBe(beforePan.panX + 64);
    expect((await camera(page)).panY).toBe(beforePan.panY);
    // Released: a plain move no longer pans, and hover matches the moved camera. At 0.5× that
    // is 128 world px, two tiles: (30, 34).
    await page.mouse.move(point.x, point.y);
    await expect(hover).toHaveText(await expectedHover(page, point));
    await expect(hover).toHaveText('Tile 30, 34');
    expect((await camera(page)).panX).toBe(beforePan.panX + 64);

    await page.mouse.move(box.x - 20, box.y - 20);
    await expect(hover).toHaveText(
      'Hover the map to see a tile. Click a building to select its project.',
    );
    await resetView(page);
  });

  test('canvas follows its container when the window resizes', async () => {
    const { app, page } = launched;
    const sizes = async () =>
      page.evaluate(() => {
        const element = document.querySelector<HTMLElement>('[data-testid="world-view-host"]');
        const canvas = element?.querySelector('canvas');
        if (!element || !canvas) return null;
        return {
          host: [element.clientWidth, element.clientHeight],
          canvas: [canvas.clientWidth, canvas.clientHeight],
          backing: canvas.width / window.devicePixelRatio,
        };
      });
    for (const [width, height] of [
      [900, 700],
      [1400, 1000],
      [WINDOW.width, WINDOW.height],
    ] as const) {
      await app.evaluate(
        ({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
        },
        { width, height },
      );
      await expect
        .poll(async () => {
          const s = await sizes();
          return s !== null && s.host[0] === s.canvas[0] && s.host[1] === s.canvas[1];
        })
        .toBe(true);
      const s = await sizes();
      // The drawing buffer matches too (high-DPI aware), not just the CSS box.
      expect(s?.backing).toBeCloseTo(s?.host[0] ?? -1, 0);
    }
  });

  test('a lost graphics context shows a message, keeps the UI usable and recovers', async () => {
    const { page } = launched;
    test.skip(
      (await worldView(page).getAttribute('data-renderer')) !== 'webgl',
      'context loss only applies to WebGL',
    );
    await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="world-view-host"] canvas');
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no world canvas');
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      const ext = gl?.getExtension('WEBGL_lose_context');
      if (!ext) throw new Error('WEBGL_lose_context unavailable');
      (window as unknown as { __loseContext: WEBGL_lose_context }).__loseContext = ext;
      ext.loseContext();
    });
    await expect(worldView(page)).toHaveAttribute('data-state', 'lost');
    await expect(worldView(page).getByRole('alert')).toContainText('World view unavailable');

    // The rest of the screen still works: the project list opens and reads.
    await page.locator('[data-entrance="projects"]').click();
    await expect(page.getByTestId('projects-summary')).not.toBeEmpty();
    await page.getByRole('button', { name: 'Back to world' }).click();

    await page.evaluate(() => {
      (window as unknown as { __loseContext: WEBGL_lose_context }).__loseContext.restoreContext();
    });
    await expect(worldView(page)).toHaveAttribute('data-state', 'ready');
    await expect(worldView(page).getByRole('alert')).toHaveCount(0);
  });

  test('the spike grid still mounts and unmounts without leaking contexts', async () => {
    // The M0 spike world under Developer spikes shares the renderer code. Toggling it 20 times
    // (and racing Pixi's async init) must release every context it made. The product world's
    // own context stays alive the whole time, so it is part of the baseline.
    const { page } = launched;
    await openDeveloperSpikes(page);
    const toggle = page.getByRole('button', { name: /world view/ });
    const canvases = page.locator('[data-testid="world-canvas-host"] canvas');
    for (let i = 0; i < 20; i++) {
      await toggle.click(); // hide
      await expect(canvases).toHaveCount(0);
      await toggle.click(); // show
      await expect(page.getByTestId('world')).toHaveAttribute('data-state', 'ready');
      await expect(canvases).toHaveCount(1);
    }
    const alive = () =>
      page.evaluate(
        () =>
          (window as unknown as { __glContexts: WebGLRenderingContext[] }).__glContexts.filter(
            (context) => !context.isContextLost(),
          ).length,
      );
    await toggle.click(); // hide
    // With the spike hidden: the product world, plus at most Pixi's page-wide helper
    // (getTestContext() caches one small context for reading GPU limits).
    const baseline = await alive();
    expect(baseline).toBeLessThanOrEqual(2);

    // Show, then hide a microtask later while Pixi's async init is still running.
    // A late-finishing init must destroy its own app (and its WebGL context).
    const hiddenWhileLoading = await page.evaluate(async () => {
      const button = Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent.includes('world view'),
      );
      if (button === undefined) throw new Error('toggle not found');
      const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));
      let raced = 0;
      for (let i = 0; i < 20; i++) {
        button.click(); // show: React commits and starts init during this click
        await Promise.resolve();
        if (document.querySelector('[data-testid="world"][data-state="loading"]')) raced++;
        button.click(); // hide
        await nextTask();
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return raced;
    });
    // Proves the race really happened, so this test can't pass vacuously.
    expect(hiddenWhileLoading).toBeGreaterThan(10);
    await expect(canvases).toHaveCount(0);
    // Every renderer context is released (Pixi's destroy loses it on purpose).
    await expect.poll(alive).toBe(baseline);
    await toggle.click();
    await expect(page.getByTestId('world')).toHaveAttribute('data-state', 'ready');
    await expect(canvases).toHaveCount(1);
    await expect.poll(alive).toBe(baseline + 1);
    // Chromium allows ~16 live WebGL contexts and warns when it drops old ones.
    expect(launched.consoleLines.filter((line) => /too many active webgl/i.test(line))).toEqual([]);
    await page.reload();
    await showWorld(page);
  });
});

test.describe('saved buildings', () => {
  let launched: Launched;
  let alpha: PlacedProject;
  let beta: PlacedProject;
  test.beforeAll(async () => {
    launched = await launch();
    [alpha, beta] = await createProjects(launched.page, [
      { name: 'Alpha', tile: { gx: 28, gy: 30 } },
      { name: 'Beta', tile: { gx: 34, gy: 30 }, archive: true },
      { name: 'Gamma' },
    ]).then((created) => created.slice(0, 2) as [PlacedProject, PlacedProject]);
    await reloadWorld(launched.page, 2);
  });
  test.afterAll(async () => {
    await launched.close();
  });

  test('draws each saved building, labelled as placeholder art', async () => {
    const { app, page } = launched;
    await expect(page.getByTestId('world-view-status')).toContainText(
      '2 buildings (placeholder art) · 1 archived',
    );
    // A building really is drawn: the middle of Alpha's walls is neither grass nor background.
    const wall = await windowPointOf(page, { gx: 29.5, gy: 31.5 });
    await expect
      .poll(async () => {
        const pixel = await pixelAt(app, wall.x, wall.y - 30);
        return !isGround(pixel) && !isBackground(pixel);
      })
      .toBe(true);
  });

  test('click selects and shows the summary; ground clears; the camera never moves', async () => {
    const { page } = launched;
    const inspector = page.getByTestId('inspector');
    await expect(inspector).toContainText('Nothing selected.');
    const cameraBefore = await host(page).getAttribute('data-camera');

    const alphaFloor = await windowPointOf(page, { gx: 29, gy: 31 });
    await page.mouse.click(alphaFloor.x, alphaFloor.y);
    await expect(worldView(page)).toHaveAttribute(
      'data-selected-placement',
      alpha.placementId ?? '',
    );
    await expect(inspector).toHaveAttribute('data-project-id', alpha.projectId);
    await expect(inspector.getByRole('heading', { name: 'Alpha' })).toBeVisible();
    await expect(page.getByTestId('inspector-status')).toHaveText('Active');
    await expect(page.getByTestId('inspector-placement')).toHaveText('Building at tile 28, 30');
    expect(await host(page).getAttribute('data-camera')).toBe(cameraBefore);

    const ground = await windowPointOf(page, { gx: 40.5, gy: 20.5 });
    await page.mouse.click(ground.x, ground.y);
    await expect(worldView(page)).not.toHaveAttribute('data-selected-placement', /.+/);
    await expect(inspector).toContainText('Nothing selected.');
    expect(await host(page).getAttribute('data-camera')).toBe(cameraBefore);
  });

  test('double-click and the inspector Open both show the project details', async () => {
    const { page } = launched;
    const alphaFloor = await windowPointOf(page, { gx: 29, gy: 31 });
    await page.mouse.dblclick(alphaFloor.x, alphaFloor.y);
    const details = page.getByTestId('project-details');
    await expect(details).toHaveAttribute('data-project-id', alpha.projectId);
    await expect(page.getByRole('heading', { name: 'Project details' })).toBeVisible();
    await expect(details).toContainText('Building at tile 28, 30');
    await expect(details).toContainText('Project workspace: not built yet (planned for M5)');
    await page.keyboard.press('Escape');
    await expect(details).toHaveCount(0);

    // The selection stayed; Open in the inspector shows the same details.
    await page.getByTestId('inspector').getByRole('button', { name: 'Open' }).click();
    await expect(details).toHaveAttribute('data-project-id', alpha.projectId);
    await page.getByRole('button', { name: 'Back to world' }).click();
    // Focus returns to the button that opened the panel.
    await expect(page.getByTestId('inspector').getByRole('button', { name: 'Open' })).toBeFocused();
  });

  test('an archived building offers Unarchive, and keeps its building', async () => {
    const { page } = launched;
    const betaFloor = await windowPointOf(page, { gx: 35, gy: 31 });
    await page.mouse.click(betaFloor.x, betaFloor.y);
    const inspector = page.getByTestId('inspector');
    await expect(inspector).toHaveAttribute('data-project-id', beta.projectId);
    await expect(page.getByTestId('inspector-status')).toHaveText('Archived');
    await inspector.getByRole('button', { name: 'Unarchive' }).click();
    const dialog = page.getByRole('dialog', { name: 'Unarchive “Beta”?' });
    await expect(dialog).toContainText('Its building stays where it is in the world.');
    await dialog.getByRole('button', { name: 'Unarchive project' }).click();
    await expect(page.getByTestId('inspector-status')).toHaveText('Active');
    await expect(inspector.getByRole('status')).toContainText('Unarchived “Beta”.');
    await expect(worldView(page)).toHaveAttribute('data-buildings', '2');
    await expect(page.getByTestId('world-view-status')).not.toContainText('archived');
  });

  test('unplaced projects are listed as Not placed and archiving in the list removes a building', async () => {
    const { page } = launched;
    await page.locator('[data-entrance="projects"]').click();
    const item = (name: string) =>
      page.locator('.project-item', { has: page.getByRole('heading', { name, exact: true }) });
    await expect(item('Gamma').getByTestId('project-not-placed')).toHaveText('Not placed');
    await expect(item('Alpha').getByTestId('project-not-placed')).toHaveCount(0);

    await item('Alpha').getByRole('button', { name: 'Archive' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Archive project', exact: true })
      .click();
    await expect(page.getByTestId('projects-message')).toContainText('Archived');
    // Archiving removed Alpha's building (ADR-0025); the world reloaded without asking.
    await expect(worldView(page)).toHaveAttribute('data-buildings', '1');
    await page.getByRole('button', { name: 'Archived', exact: true }).click();
    await expect(item('Alpha').getByTestId('project-not-placed')).toHaveText('Not placed');
    await page.getByRole('button', { name: 'Back to world' }).click();
  });
});

test.describe('100 buildings', () => {
  let launched: Launched;
  test.beforeAll(async () => {
    launched = await launch();
    const specs = Array.from({ length: 100 }, (_, index) => ({
      name: `Project ${String(index + 1).padStart(3, '0')}`,
      tile: { gx: 6 + (index % 10) * 5, gy: 6 + Math.floor(index / 10) * 5 },
    }));
    await createProjects(launched.page, specs);
    await reloadWorld(launched.page, 100);
  });
  test.afterAll(async () => {
    await launched.close();
  });

  test('offscreen buildings are culled; hover, zoom and pan stay responsive', async () => {
    const { page } = launched;
    const world = worldView(page);
    const drawn = async () => Number(await world.getAttribute('data-drawn-buildings'));

    // Zoomed in, only the buildings near the centre are drawn; zoomed out, many more.
    for (let i = 0; i < 6; i++)
      await world.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect(page.getByTestId('world-view-status')).toContainText('Zoom 191%');
    await expect.poll(drawn).toBeLessThan(100);
    const zoomedIn = await drawn();
    expect(zoomedIn).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++)
      await world.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await expect(page.getByTestId('world-view-status')).toContainText('Zoom 25%');
    await expect.poll(drawn).toBeGreaterThan(zoomedIn);
    test.info().annotations.push({
      type: 'culling',
      description: `drawn at 191%: ${String(zoomedIn)} of 100; at 25%: ${String(await drawn())} of 100`,
    });
    await resetView(page);

    // Measurement, not a guarantee (UI_SPEC §17.4): frame gaps while the pointer hovers,
    // the wheel zooms and the middle button pans over 100 buildings.
    await page.evaluate(() => {
      const scope = window as unknown as { __frames: number[] };
      scope.__frames = [];
      let last = performance.now();
      const tick = (now: number) => {
        scope.__frames.push(now - last);
        last = now;
        if (scope.__frames.length < 100_000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const box = await hostBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const started = performance.now();
    for (let i = 0; i < 40; i++) await page.mouse.move(cx - 200 + i * 10, cy + (i % 5) * 6);
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, i < 3 ? -100 : 100);
    await page.mouse.down({ button: 'middle' });
    for (let i = 0; i < 40; i++) await page.mouse.move(cx + i * 5, cy + i * 2);
    await page.mouse.up({ button: 'middle' });
    // Contains: over a building the line adds " · <project name>".
    await expect(page.getByTestId('world-view-hover')).toContainText(
      await expectedHover(page, { x: cx + 195, y: cy + 78 }),
    );
    const elapsed = performance.now() - started;
    const frames = await page.evaluate(() =>
      (window as unknown as { __frames: number[] }).__frames.slice(1),
    );
    const sorted = [...frames].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const longest = sorted.at(-1) ?? 0;
    const mean = frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frames.length);
    const summary =
      `100 buildings, ${String(frames.length)} frames over ${elapsed.toFixed(0)} ms of input: ` +
      `mean ${mean.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, longest ${longest.toFixed(1)} ms`;
    test.info().annotations.push({ type: 'performance', description: summary });
    console.log(`[world perf] ${summary}`);
    // A loose sanity bound only: the number to read is the annotation, not this assertion.
    expect(p95).toBeLessThan(100);
  });
});

test.describe('world view without WebGL', () => {
  let launched: Launched;
  test.beforeAll(async () => {
    launched = await launch(() => {
      // Read via the descriptor: we call it with an explicit `this` below.
      const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')
        ?.value as (...a: unknown[]) => unknown;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        ...args: never[]
      ) {
        const kind = String(args[0]);
        if (kind.includes('webgl')) return null;
        return original.apply(this, args);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
  });
  test.afterAll(async () => {
    await launched.close();
  });

  test('falls back to Canvas2D and still draws the grid', async () => {
    const { app, page } = launched;
    const world = worldView(page);
    await expect(world).toHaveAttribute('data-state', 'ready');
    await expect(world).toHaveAttribute('data-renderer', 'canvas');
    await expect(page.getByTestId('world-view-status')).toContainText('Renderer: Canvas2D');
    const centre = await windowPointOf(page, { gx: 32.5, gy: 32.5 });
    await expect.poll(async () => isGround(await pixelAt(app, centre.x, centre.y))).toBe(true);
  });
});

test.describe('world view with no graphics at all', () => {
  let launched: Launched;
  test.beforeAll(async () => {
    launched = await launch(() => {
      HTMLCanvasElement.prototype.getContext = function () {
        return null;
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
  });
  test.afterAll(async () => {
    await launched.close();
  });

  test('shows a visible message and the rest of the UI keeps working', async () => {
    const { page } = launched;
    const world = worldView(page);
    await expect(world).toHaveAttribute('data-state', 'failed');
    await expect(world.getByRole('alert')).toContainText('World view unavailable');
    await expect(page.getByTestId('world-view-status')).toHaveText(
      'Renderer: none. Your projects are all in the Projects list.',
    );
    await expect(world.getByRole('button', { name: 'Zoom in', exact: true })).toBeDisabled();

    // Projects work without the canvas (UI_SPEC §6.6).
    await page.locator('[data-entrance="projects"]').click();
    await expect(page.getByTestId('projects-summary')).toHaveText(
      'No active projects in this world yet.',
    );
    await expect(page.getByRole('button', { name: 'New project' })).toBeEnabled();
  });
});
// Comfort (M2-14 #79, UI_SPEC §6.6): name labels, the saved camera and reduced motion. The
// saved values are read back through the real preferences command, never assumed.
test.describe('comfort', () => {
  let launched: Launched;
  test.beforeAll(async () => {
    launched = await launch();
    await createProjects(launched.page, [{ name: 'Harbour', tile: { gx: 31, gy: 31 } }]);
    await reloadWorld(launched.page, 1);
  });
  test.afterAll(async () => {
    await launched.close();
  });

  /** The saved comfort preferences (this world's camera only), via profile.preferences.get. */
  async function savedComfort(page: Page) {
    return page.evaluate(async () => {
      const worlds = await window.atlas.world.list();
      const result = await window.atlas.profile.preferences.get();
      if (!worlds.ok || !result.ok) throw new Error('could not read preferences');
      const worldId = worlds.data.worlds[0]?.id ?? '';
      const { reducedMotion, buildingLabels, cameras } = result.data.preferences;
      return { reducedMotion, buildingLabels, camera: cameras[worldId] };
    });
  }

  /** The world point in the middle of the view, through the real camera. */
  async function viewCentre(page: Page): Promise<Point> {
    // The app's canvas size is the host's clientWidth/Height (inside its border).
    const size = await host(page).evaluate((element) => ({
      width: element.clientWidth,
      height: element.clientHeight,
    }));
    return screenToWorld({ x: size.width / 2, y: size.height / 2 }, await camera(page));
  }

  async function openSettings(page: Page) {
    await page.getByRole('button', { name: 'Settings' }).click();
    return page.getByTestId('entrance-panel');
  }

  async function closePanel(page: Page) {
    await page.getByTestId('entrance-panel').getByRole('button', { name: 'Back to world' }).click();
  }

  test('a building shows its name label, kept readable and hidden when far out', async () => {
    const { page } = launched;
    await resetView(page);
    await expect(worldView(page)).toHaveAttribute('data-labels', 'on');
    await expect(worldView(page)).toHaveAttribute('data-drawn-labels', '1');
    // The hover line names the project too (the canvas itself is hidden from screen readers).
    const point = await windowPointOf(page, { gx: 32, gy: 32 });
    await page.mouse.move(point.x, point.y);
    await expect(page.getByTestId('world-view-hover')).toContainText('Harbour');
    await page.mouse.move(0, 0);
    // Zoomed out to 0.4× (above the 0.35× cut-off) the label still shows; at 0.32× it doesn't.
    const zoomOut = worldView(page).getByRole('button', {
      name: 'Zoom out',
      exact: true,
    });
    await zoomOut.click();
    await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(0.4, 6);
    await expect(worldView(page)).toHaveAttribute('data-drawn-labels', '1');
    await zoomOut.click();
    await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(0.32, 6);
    await expect(worldView(page)).toHaveAttribute('data-drawn-labels', '0');
    await resetView(page);
    await expect(worldView(page)).toHaveAttribute('data-drawn-labels', '1');
  });

  test('reload keeps the camera and the label setting', async () => {
    const { page } = launched;
    await resetView(page);
    // Move the camera: zoom in twice, then middle-drag.
    const zoomIn = worldView(page).getByRole('button', {
      name: 'Zoom in',
      exact: true,
    });
    await zoomIn.click();
    await zoomIn.click();
    const box = await hostBox(page);
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(start.x - 90, start.y - 40);
    await page.mouse.up({ button: 'middle' });
    await page.mouse.move(0, 0);
    const moved = await camera(page);
    const centre = await viewCentre(page);
    expect(moved.zoom).toBeCloseTo(0.78125, 6);

    // Labels off from the world toolbar.
    await worldView(page).getByRole('checkbox', { name: 'Labels' }).uncheck();
    await expect(worldView(page)).toHaveAttribute('data-labels', 'off');
    await expect(worldView(page)).toHaveAttribute('data-drawn-labels', '0');

    // Both are really saved (the camera after its debounce) before the reload.
    await expect
      .poll(async () => savedComfort(page))
      .toMatchObject({ buildingLabels: false, camera: expect.anything() });
    const saved = (await savedComfort(page)).camera;
    expect(saved?.zoom).toBeCloseTo(moved.zoom, 6);
    expect(saved?.centerX).toBeCloseTo(centre.x, 1);
    expect(saved?.centerY).toBeCloseTo(centre.y, 1);

    await reloadWorld(page, 1);
    await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(moved.zoom, 6);
    const restored = await viewCentre(page);
    expect(restored.x).toBeCloseTo(centre.x, 1);
    expect(restored.y).toBeCloseTo(centre.y, 1);
    await expect(worldView(page)).toHaveAttribute('data-labels', 'off');
    await expect(worldView(page)).toHaveAttribute('data-drawn-labels', '0');

    // Settings shows the same setting and turns labels back on.
    const panel = await openSettings(page);
    const checkbox = panel.getByRole('checkbox', {
      name: 'Show building labels',
    });
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await closePanel(page);
    await expect(worldView(page)).toHaveAttribute('data-labels', 'on');
    await expect.poll(async () => (await savedComfort(page)).buildingLabels).toBe(true);
    await resetView(page);
  });

  test('a saved camera off the map opens clamped to the map edge', async () => {
    const { page } = launched;
    // Let the previous test's Reset view finish saving first: last write wins (ADR-0028), so
    // a save still waiting on its debounce would replace the camera written below.
    await expect.poll(async () => (await savedComfort(page)).camera?.zoom).toBe(0.5);
    await page.evaluate(async () => {
      const list = await window.atlas.world.list();
      if (!list.ok) throw new Error(list.error.code);
      const worldId = list.data.worlds[0]?.id ?? '';
      const result = await window.atlas.profile.preferences.update({
        camera: {
          worldId,
          camera: { centerX: 90_000, centerY: -90_000, zoom: 1 },
        },
      });
      if (!result.ok) throw new Error(result.error.code);
    });
    await reloadWorld(page, 1);
    await expect.poll(async () => (await camera(page)).zoom).toBe(1);
    const bounds = mapWorldBounds(DEFAULT_MAP);
    const centre = await viewCentre(page);
    expect(centre.x).toBeCloseTo(bounds.right, 1);
    expect(centre.y).toBeCloseTo(bounds.top, 1);
    await resetView(page);
  });

  test('reduced motion follows the OS by default; Settings overrides it and it is saved', async () => {
    const { page } = launched;
    const root = page.locator('html');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(root).toHaveAttribute('data-motion', 'full');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(root).toHaveAttribute('data-motion', 'reduced');

    const panel = await openSettings(page);
    await expect(panel.getByTestId('os-motion')).toContainText('reduced');
    await panel.getByRole('radio', { name: 'Full motion' }).check();
    await expect(root).toHaveAttribute('data-motion', 'full');
    await expect.poll(async () => (await savedComfort(page)).reducedMotion).toBe('off');

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await panel.getByRole('radio', { name: 'Reduce motion' }).check();
    await expect(root).toHaveAttribute('data-motion', 'reduced');
    await expect.poll(async () => (await savedComfort(page)).reducedMotion).toBe('on');

    // Saved per profile: still on after a reload, while the OS asks for full motion.
    await page.reload();
    await showWorld(page);
    await expect(root).toHaveAttribute('data-motion', 'reduced');
    const again = await openSettings(page);
    await again.getByRole('radio', { name: /Follow the Windows setting/ }).check();
    await expect(root).toHaveAttribute('data-motion', 'full');
    await closePanel(page);
  });
});
