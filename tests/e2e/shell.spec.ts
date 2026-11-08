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
  }));
  expect(shape).toEqual({ top: ['app'], app: ['ping'] });
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
