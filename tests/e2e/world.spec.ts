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

// M0-4: the placeholder Pixi world inside the built app, under the production CSP.

interface Launched {
  app: ElectronApplication;
  page: Page;
  consoleLines: string[];
  close: () => Promise<void>;
}

/**
 * Launches the built app. `initScript` runs in the page before any app code on every load,
 * which is how the failure tests take graphics APIs away without test hooks in app code.
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

/** Placeholder ground is 0x34503a: green clearly dominates. Background 0x14161c is near black. */
const isGround = ({ r, g, b }: Rgb) => g > r + 15 && g > b + 10 && g > 50;
const isBackground = ({ r, g, b }: Rgb) => r < 40 && g < 40 && b < 45;

async function hostBox(page: Page) {
  const box = await page.getByTestId('world-canvas-host').boundingBox();
  if (box === null) throw new Error('world host not visible');
  return box;
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

  test('renders the grid with an allowed renderer under the production CSP', async () => {
    const { page } = launched;
    const world = page.getByTestId('world');
    await expect(world).toHaveAttribute('data-state', 'ready');
    const renderer = await world.getAttribute('data-renderer');
    test.info().annotations.push({ type: 'renderer', description: String(renderer) });
    expect(['webgl', 'canvas']).toContain(renderer);
    await expect(page.getByTestId('world-status')).toContainText('64 × 64 tiles');
    await expect(page.locator('[data-testid="world-canvas-host"] canvas')).toHaveCount(1);

    const violations = await page.evaluate(
      () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
    );
    expect(violations).toEqual([]);
    expect(launched.consoleLines.filter((line) => line.startsWith('error'))).toEqual([]);
  });

  test('draws real pixels: ground in the centre, background beyond the map edge', async () => {
    const { app, page } = launched;
    // At 0.5× the map covers the whole view; zoom out to ~0.26× so the corners are off-map.
    for (let i = 0; i < 3; i++)
      await page
        .getByTestId('world')
        .getByRole('button', { name: 'Zoom out', exact: true })
        .click();
    await expect(page.getByTestId('world-status')).toContainText('Zoom 26%');
    const box = await hostBox(page);
    await expect
      .poll(async () =>
        isGround(await pixelAt(app, box.x + box.width / 2, box.y + box.height / 2 + 6)),
      )
      .toBe(true);
    expect(isBackground(await pixelAt(app, box.x + 8, box.y + 8))).toBe(true);
    await page
      .getByTestId('world')
      .getByRole('button', { name: 'Reset view', exact: true })
      .click();
    await expect(page.getByTestId('world-status')).toContainText('Zoom 50%');
  });

  test('hover, wheel zoom and middle-drag pan use the inverse projection', async () => {
    const { page } = launched;
    const box = await hostBox(page);
    // The map centre (grid 32,32) sits in the middle of the view. 8 px lower at 0.5× is
    // world (0, 16), i.e. the middle of tile (32, 32), away from any edge.
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2 + 8;
    await page.mouse.move(x, y);
    await expect(page.getByTestId('world-hover')).toHaveText('Tile 32, 32');

    // Zooming around the cursor keeps the same world point under it.
    await page.mouse.wheel(0, -100);
    await expect(page.getByTestId('world-status')).toContainText('Zoom 63%');
    await page.mouse.move(x + 1, y);
    await page.mouse.move(x, y);
    await expect(page.getByTestId('world-hover')).toHaveText('Tile 32, 32');
    await page
      .getByTestId('world')
      .getByRole('button', { name: 'Reset view', exact: true })
      .click();

    // Middle-drag 64 px right at 0.5× moves the world 128 px right, so the cursor now
    // points 128 world px further left: gx − 2, gy + 2.
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(x + 32, y);
    await page.mouse.move(x + 64, y);
    await page.mouse.up({ button: 'middle' });
    await page.mouse.move(x, y);
    await expect(page.getByTestId('world-hover')).toHaveText('Tile 30, 34');

    await page.mouse.move(box.x - 20, box.y - 20);
    await expect(page.getByTestId('world-hover')).toHaveText(
      'Hover a tile to see its grid position.',
    );
    await page
      .getByTestId('world')
      .getByRole('button', { name: 'Reset view', exact: true })
      .click();
  });

  test('canvas follows its container when the window resizes', async () => {
    const { app, page } = launched;
    const sizes = async () =>
      page.evaluate(() => {
        const host = document.querySelector<HTMLElement>('[data-testid="world-canvas-host"]');
        const canvas = host?.querySelector('canvas');
        if (!host || !canvas) return null;
        return {
          host: [host.clientWidth, host.clientHeight],
          canvas: [canvas.clientWidth, canvas.clientHeight],
          backing: canvas.width / window.devicePixelRatio,
        };
      });
    for (const [width, height] of [
      [900, 700],
      [1400, 1000],
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

  test('hiding the world removes the canvas; repeated mounts do not leak contexts', async () => {
    const { page } = launched;
    const toggle = page.getByRole('button', { name: /world view/ });
    const canvases = page.locator('canvas');
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
    // With the world hidden, only Pixi's own page-wide helper may remain: getTestContext()
    // caches one small context for reading GPU limits and reuses it for every app.
    const baseline = await alive();
    expect(baseline).toBeLessThanOrEqual(1);

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
  });

  test('a lost graphics context shows a message, keeps the UI usable and recovers', async () => {
    const { page } = launched;
    test.skip(
      (await page.getByTestId('world').getAttribute('data-renderer')) !== 'webgl',
      'context loss only applies to WebGL',
    );
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
      const ext = gl?.getExtension('WEBGL_lose_context');
      if (!ext) throw new Error('WEBGL_lose_context unavailable');
      (window as unknown as { __loseContext: WEBGL_lose_context }).__loseContext = ext;
      ext.loseContext();
    });
    await expect(page.getByTestId('world')).toHaveAttribute('data-state', 'lost');
    await expect(page.getByRole('alert')).toContainText('World view unavailable');

    await page.getByRole('button', { name: 'Send app.ping' }).click();
    await expect(page.getByTestId('ping-result')).toContainText('pong:');

    await page.evaluate(() => {
      (window as unknown as { __loseContext: WEBGL_lose_context }).__loseContext.restoreContext();
    });
    await expect(page.getByTestId('world')).toHaveAttribute('data-state', 'ready');
    await expect(page.getByRole('alert')).toHaveCount(0);
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
    const world = page.getByTestId('world');
    await expect(world).toHaveAttribute('data-state', 'ready');
    await expect(world).toHaveAttribute('data-renderer', 'canvas');
    await expect(page.getByTestId('world-status')).toContainText('Renderer: Canvas2D');
    const box = await hostBox(page);
    await expect
      .poll(async () =>
        isGround(await pixelAt(app, box.x + box.width / 2, box.y + box.height / 2 + 6)),
      )
      .toBe(true);
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
    await expect(page.getByTestId('world')).toHaveAttribute('data-state', 'failed');
    await expect(page.getByRole('alert')).toContainText('World view unavailable');
    await expect(page.getByTestId('world-status')).toHaveText('Renderer: none');
    await expect(
      page.getByTestId('world').getByRole('button', { name: 'Zoom in', exact: true }),
    ).toBeDisabled();

    await expect(page.getByTestId('launch-info')).toContainText('Launch #');
    await page.getByLabel('Message').fill('still works');
    await page.getByRole('button', { name: 'Send app.ping' }).click();
    await expect(page.getByTestId('ping-result')).toContainText('pong: still works');
  });
});
