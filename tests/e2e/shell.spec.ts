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

// Smoke + security probes against the built app (out/). Launched without
// ELECTRON_RENDERER_URL, so it loads the production index.html and production CSP.
let app: ElectronApplication;
let page: Page;
// Throwaway userData, so tests never touch the developer's real profile database.
const userDataDir = mkdtempSync(join(tmpdir(), 'atlas-e2e-shell-'));

test.beforeAll(async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== 'ELECTRON_RENDERER_URL',
    ),
  );
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('opens a window titled "Atlas Realm"', async () => {
  await expect(page).toHaveTitle('Atlas Realm');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Atlas Realm');
});

test('renderer process runs in the OS sandbox', async () => {
  // ProcessMetric.sandboxed is reported on Windows and macOS (our targets).
  const sandboxed = await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    const pid = BrowserWindow.getAllWindows()[0]?.webContents.getOSProcessId();
    return electronApp.getAppMetrics().find((metric) => metric.pid === pid)?.sandboxed;
  });
  expect(sandboxed).toBe(true);
});

test('renderer cannot reach require, process, module or Buffer', async () => {
  const reachable = await page.evaluate(() => {
    const scope = globalThis as Record<string, unknown>;
    return {
      require: typeof scope['require'],
      process: typeof scope['process'],
      module: typeof scope['module'],
      Buffer: typeof scope['Buffer'],
    };
  });
  expect(reachable).toEqual({
    require: 'undefined',
    process: 'undefined',
    module: 'undefined',
    Buffer: 'undefined',
  });
});

test('preload exposes only the explicit API', async () => {
  const shape = await page.evaluate(() => ({
    top: Object.keys(window.atlas),
    app: Object.keys(window.atlas.app),
    runtime: Object.keys(window.atlas.runtime),
    template: Object.keys(window.atlas.template),
  }));
  expect(shape).toEqual({
    top: ['app', 'runtime', 'template'],
    app: ['ping', 'launchInfo'],
    runtime: ['workerStatus', 'workerCheck'],
    template: ['list'],
  });
});

test('template.list returns the bundled templates from the built main process', async () => {
  const result = await page.evaluate(() => window.atlas.template.list());
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(
    result.data.templates.map((t) =>
      t.status === 'available' ? `${t.id}@${t.version}` : t.reason,
    ),
  ).toEqual(['builtin.content-campaign@1.0.0', 'builtin.generic@1.0.0']);
});

test('app.ping round-trips through the main process', async () => {
  await page.getByLabel('Message').fill('round trip');
  await page.getByRole('button', { name: 'Send app.ping' }).click();
  await expect(page.getByTestId('ping-result')).toContainText('pong: round trip (main process,');
});

test('main process rejects an invalid app.ping payload', async () => {
  const result = await page.evaluate(() => {
    // Deliberately wrong shapes, bypassing TypeScript the way a compromised page could.
    const ping = window.atlas.app.ping as (
      input: unknown,
    ) => ReturnType<typeof window.atlas.app.ping>;
    return Promise.all([ping({ message: 42 }), ping({ message: 'hi', extra: true })]);
  });
  for (const r of result) {
    expect(r).toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
  }
});

test('CSP blocks injected inline scripts', async () => {
  const executed = await page.evaluate(async () => {
    const script = document.createElement('script');
    script.textContent = 'window.__injected = true;';
    document.head.append(script);
    await new Promise((resolve) => setTimeout(resolve, 100));
    return (window as unknown as Record<string, unknown>)['__injected'] === true;
  });
  expect(executed).toBe(false);
});

test('new windows and navigation away are blocked', async () => {
  const startUrl = page.url();
  const opened = await page.evaluate(() => window.open('https://example.com/') !== null);
  expect(opened).toBe(false);

  await page.evaluate(() => {
    window.location.href = 'https://example.com/';
  });
  await page.waitForTimeout(500);
  expect(page.url()).toBe(startUrl);
  expect(app.windows()).toHaveLength(1);
});

test('built UI loads from the app://atlas origin, not file://', async () => {
  expect(page.url()).toBe('app://atlas/index.html');
  // Assets resolve relative to the page, so they come from app:// too.
  const scripts = await page.evaluate(() =>
    // Skip inline scripts (no src), e.g. the one the CSP test injects.
    Array.from(document.scripts)
      .filter((script) => script.src !== '')
      .map((script) => new URL(script.src).protocol),
  );
  expect(scripts.length).toBeGreaterThan(0);
  expect(new Set(scripts)).toEqual(new Set(['app:']));
});

// On the old file:// page, 'self' matched file: URLs, so these loads were allowed (and a UNC
// img could leak the NTLM hash). From app://atlas, Chromium refuses file: resources outright
// ("Not allowed to load local resource") before CSP is even consulted, and 'self' no longer
// covers file: either. We assert the outcome: neither load succeeds.
test('file: scripts and images are blocked from the app:// page', async () => {
  const outcome = await page.evaluate(async () => {
    // Real files that exist on every Windows machine, so a block can't be a 404 in disguise.
    const target = 'file:///C:/Windows/System32/drivers/etc/hosts';
    const load = (element: HTMLScriptElement | HTMLImageElement): Promise<string> =>
      new Promise((resolve) => {
        element.addEventListener('load', () => {
          resolve('loaded');
        });
        element.addEventListener('error', () => {
          resolve('blocked');
        });
        setTimeout(() => {
          resolve('timeout');
        }, 2000);
      });

    const script = document.createElement('script');
    script.src = target;
    const scriptResult = load(script);
    document.head.append(script);

    const img = document.createElement('img');
    img.src = 'file:///C:/Windows/Web/Screen/img100.jpg';
    const imgResult = load(img);
    document.body.append(img);

    // The #16 threat: a network-share image that would make Windows send the NTLM hash.
    const uncImg = document.createElement('img');
    uncImg.src = 'file://127.0.0.1/c$/Windows/Web/Screen/img100.jpg';
    const uncResult = load(uncImg);
    document.body.append(uncImg);

    const results = { script: await scriptResult, img: await imgResult, unc: await uncResult };
    script.remove();
    img.remove();
    uncImg.remove();
    return results;
  });
  expect(outcome).toEqual({ script: 'blocked', img: 'blocked', unc: 'blocked' });
});

test('app:// handler refuses paths outside the renderer folder', async () => {
  // The renderer can't fetch() app:// (we don't grant supportFetchAPI), so drive the real
  // protocol.handle handler from the main process: net.fetch goes through it too.
  const statuses = await app.evaluate(async ({ net }) => {
    const probe = async (url: string, method = 'GET'): Promise<number> =>
      (await net.fetch(url, { method })).status;
    return Promise.all([
      probe('app://atlas/index.html'), // control: a real file comes back
      probe('app://atlas/..%2F..%2Fpackage.json'),
      probe('app://atlas/..%5C..%5Cpackage.json'),
      probe('app://atlas/..%2Fmain%2Findex.js'),
      probe('app://atlas/C%3A%5CWindows%5Cwin.ini'),
      probe('app://atlas/does-not-exist.js'),
      probe('app://atlas/index.html', 'POST'),
    ]);
  });
  expect(statuses).toEqual([200, 404, 404, 404, 404, 404, 405]);
});

test('file: is blocked for every caller, but app:// still reads its own files', async () => {
  // Main-process net.fetch goes through protocol handlers, so it sees the file: block too.
  // The control fetch skips custom handlers like the app:// handler does, and must succeed:
  // otherwise the 404 could just mean "file missing".
  const statuses = await app.evaluate(async ({ net }) => {
    const hosts = 'file:///C:/Windows/System32/drivers/etc/hosts';
    return {
      blocked: (await net.fetch(hosts)).status,
      control: (await net.fetch(hosts, { bypassCustomProtocolHandlers: true })).status,
      appOrigin: (await net.fetch('app://atlas/index.html')).status,
    };
  });
  expect(statuses).toEqual({ blocked: 404, control: 200, appOrigin: 200 });
});

test('app.launchInfo forwards no renderer payload to the main process', async () => {
  // Bypass the typed preload function: call the bridge with an argument it should never take.
  const result = await page.evaluate(() =>
    (window.atlas.app.launchInfo as unknown as (arg: unknown) => Promise<unknown>)({
      launchCount: 99,
    }),
  );
  // The preload invokes with no payload, so the extra argument never reaches main (whose
  // schema would reject it: see tests/integration/app-launch-info.test.ts).
  expect(result).toMatchObject({ ok: true, data: { launchCount: 1 } });
});
