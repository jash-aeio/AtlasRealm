import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { cp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { type Browser, chromium, expect, type Page, test } from '@playwright/test';

// Smoke tests for the packaged app (#10, TEST_PLAN §22.2 #24). They copy release/win-unpacked
// to a folder whose path has spaces and non-ASCII characters and run the real .exe from there.
//
// Why not Playwright's _electron.launch: it attaches through Node's --inspect, and the
// packaged app turns that off with a fuse. Instead we start the .exe ourselves with Chromium's
// --remote-debugging-port and connect to the window over CDP (the DevTools protocol).

const UNPACKED = resolve('release', 'win-unpacked');
const EXE_NAME = 'Atlas Realm.exe';
const devElectron = createRequire(import.meta.url)('electron') as string;

test.describe.configure({ mode: 'serial' });

let root: string;
let installDir: string;
let exePath: string;
let userDataDir: string;

test.beforeAll(async () => {
  if (!existsSync(join(UNPACKED, EXE_NAME))) {
    throw new Error('No packaged app in release/win-unpacked. Run `pnpm package` first.');
  }
  root = mkdtempSync(join(tmpdir(), 'atlas packaged Ünïcødé 测试 '));
  installDir = join(root, 'Program Fïles (x86) 地图', 'Atlas Realm');
  userDataDir = join(root, 'user data Ünïcødé 测试');
  // Not cpSync: on Node 24.13/Windows it silently copies nothing into a non-ASCII folder.
  await cp(UNPACKED, installDir, { recursive: true });
  exePath = join(installDir, EXE_NAME);
  if (!existsSync(exePath)) throw new Error(`Copy failed: ${exePath} is missing`);
});

test.afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === 'string') reject(new Error('no port'));
        else resolvePort(address.port);
      });
    });
  });
}

interface Running {
  readonly child: ChildProcess;
  readonly browser: Browser;
  readonly page: Page;
  readonly output: () => string;
}

/** Starts the packaged .exe and connects to its window. Fails if it exits or never opens. */
async function launchPackaged(
  options: { args?: string[]; env?: NodeJS.ProcessEnv } = {},
): Promise<Running> {
  const port = await freePort();
  const child = spawn(
    exePath,
    [
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${String(port)}`,
      ...(options.args ?? []),
    ],
    { env: { ...process.env, ...options.env }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));

  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`App exited early (code ${String(child.exitCode)}): ${output}`);
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`App never opened its debugging port: ${output}`);
    }
    try {
      if ((await fetch(`http://127.0.0.1:${String(port)}/json/version`)).ok) break;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(port)}`);
  const context = browser.contexts()[0];
  if (context === undefined) throw new Error('No browser context');
  const page =
    context.pages().find((candidate) => candidate.url().startsWith('app://')) ??
    (await context.waitForEvent('page'));
  await page.waitForLoadState('domcontentloaded');
  return { child, browser, page, output: () => output };
}

/** Closes the window the normal way (the app quits on window-all-closed) and waits for exit. */
async function quit({ child, browser, page }: Running): Promise<number | null> {
  const exited = new Promise<number | null>((r) =>
    child.once('exit', (code) => {
      r(code);
    }),
  );
  await page.evaluate(() => {
    window.close();
  });
  await browser.close();
  return exited;
}

test('launches from a path with spaces and non-ASCII characters and keeps data across restarts', async () => {
  expect(exePath).toMatch(/Ünïcødé 测试.*Program Fïles \(x86\) 地图/);

  const first = await launchPackaged();
  try {
    await expect(first.page).toHaveTitle('Atlas Realm');
    await expect(first.page.getByTestId('launch-info')).toHaveText(/^Launch #1 · .* · schema v1$/);
  } finally {
    expect(await quit(first)).toBe(0);
  }

  // node:sqlite works in the packaged app: the second start reads what the first one stored.
  const second = await launchPackaged();
  try {
    await expect(second.page.getByTestId('launch-info')).toHaveText(/^Launch #2 · .* · schema v1$/);
  } finally {
    expect(await quit(second)).toBe(0);
  }
  expect(existsSync(join(userDataDir, 'profiles', 'default', 'app.sqlite'))).toBe(true);
});

test('loads the UI and its bundled assets only from app://atlas (works offline)', async () => {
  const running = await launchPackaged();
  try {
    const { page } = running;
    expect(page.url()).toBe('app://atlas/index.html');
    const loaded = await page.evaluate(() => ({
      resources: performance.getEntriesByType('resource').map((entry) => entry.name),
      scripts: [...document.scripts].map((script) => script.src),
      styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map(
        (link) => (link as HTMLLinkElement).href,
      ),
      // app.css sets body { margin: 0 }; the browser default is 8px. Proves the CSS applied.
      bodyMargin: getComputedStyle(document.body).margin,
    }));
    expect(loaded.scripts.length).toBeGreaterThan(0);
    expect(loaded.styles.length).toBeGreaterThan(0);
    for (const url of [...loaded.resources, ...loaded.scripts, ...loaded.styles]) {
      expect(url).toMatch(/^app:\/\/atlas\//);
    }
    expect(loaded.bodyMargin).toBe('0px');
    // React ran: the heading exists and the IPC bridge answered.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Atlas Realm');
  } finally {
    await quit(running);
  }
});

test('file: images are blocked in the packaged app, while app:// assets still load', async () => {
  const running = await launchPackaged();
  try {
    const outcome = await running.page.evaluate(async () => {
      const load = (element: HTMLImageElement | HTMLLinkElement): Promise<string> =>
        new Promise((resolveLoad) => {
          element.addEventListener('load', () => {
            resolveLoad('loaded');
          });
          element.addEventListener('error', () => {
            resolveLoad('blocked');
          });
          setTimeout(() => {
            resolveLoad('timeout');
          }, 3000);
        });
      const img = document.createElement('img');
      img.src = 'file:///C:/Windows/Web/Screen/img100.jpg'; // exists on every Windows 10/11
      const imgResult = load(img);
      document.body.append(img);
      // Positive control: the same load/error mechanism succeeds for our own stylesheet.
      const existing = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"]');
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `${existing?.href ?? ''}?control`;
      const linkResult = load(link);
      document.head.append(link);
      const results = { fileImage: await imgResult, appStylesheet: await linkResult };
      img.remove();
      link.remove();
      return results;
    });
    expect(outcome).toEqual({ fileImage: 'blocked', appStylesheet: 'loaded' });
  } finally {
    await quit(running);
  }
});

// ---- Fuses -------------------------------------------------------------------------------

/**
 * Reads Electron's fuse wire from a binary: a fixed sentinel, a version byte, a length byte,
 * then one byte per fuse ('0' off, '1' on). Same format @electron/fuses reads and writes.
 */
function readFuses(binary: string): string {
  const bytes = readFileSync(binary);
  const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
  const at = bytes.indexOf(sentinel);
  if (at < 0) throw new Error('No fuse wire found');
  const start = at + sentinel.length;
  const length = bytes[start + 1] ?? 0;
  return bytes.subarray(start + 2, start + 2 + length).toString('latin1');
}

// Fuse positions in FuseVersion.V1 (@electron/fuses FuseV1Options).
const FUSE = {
  runAsNode: 0,
  nodeOptions: 2,
  nodeCliInspect: 3,
  asarIntegrity: 4,
  onlyLoadAppFromAsar: 5,
  fileProtocolExtraPrivileges: 7,
} as const;

function fuseStates(binary: string): Record<keyof typeof FUSE, string | undefined> {
  const wire = readFuses(binary);
  return Object.fromEntries(
    Object.entries(FUSE).map(([name, index]) => [name, wire[index]]),
  ) as Record<keyof typeof FUSE, string | undefined>;
}

test('fuses are flipped in the packaged binary (dev Electron as control)', () => {
  // Control: stock Electron has the defaults, so the positions above are read correctly.
  expect(fuseStates(devElectron)).toEqual({
    runAsNode: '1',
    nodeOptions: '1',
    nodeCliInspect: '1',
    asarIntegrity: '0',
    onlyLoadAppFromAsar: '0',
    fileProtocolExtraPrivileges: '1',
  });
  expect(fuseStates(exePath)).toEqual({
    runAsNode: '0',
    nodeOptions: '0',
    nodeCliInspect: '0',
    asarIntegrity: '1',
    onlyLoadAppFromAsar: '1',
    fileProtocolExtraPrivileges: '0',
  });
});

test('ELECTRON_RUN_AS_NODE no longer turns the app into Node.js', async () => {
  const script = ['-e', 'process.stdout.write("RAN_AS_NODE")'];
  // Control: stock Electron obeys the variable and runs the script as plain Node.
  const control = spawnSync(devElectron, script, {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 20_000,
  });
  expect(control.stdout).toContain('RAN_AS_NODE');

  // Packaged: the variable is ignored and the normal app starts instead.
  const running = await launchPackaged({ args: script, env: { ELECTRON_RUN_AS_NODE: '1' } });
  try {
    await expect(running.page).toHaveTitle('Atlas Realm');
    expect(running.output()).not.toContain('RAN_AS_NODE');
  } finally {
    await quit(running);
  }
});

test('--inspect does not open a Node debugger in the packaged app', async () => {
  // Control: stock Electron (as Node) announces its debugger on stderr when given --inspect.
  const control = spawnSync(devElectron, ['--inspect=0', '-e', 'setTimeout(() => {}, 300)'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 20_000,
  });
  expect(control.stderr).toContain('Debugger listening');

  const running = await launchPackaged({ args: ['--inspect=0'] });
  try {
    await expect(running.page).toHaveTitle('Atlas Realm');
    // Give a debugger time to announce itself if it were going to.
    await new Promise((r) => setTimeout(r, 1000));
    expect(running.output()).not.toContain('Debugger listening');
  } finally {
    await quit(running);
  }
});

// Last on purpose: it damages the copied install.
test('a modified app.asar refuses to start (asar integrity)', async () => {
  const asar = join(installDir, 'resources', 'app.asar');
  const size = readFileSync(asar).length;
  const fd = openSync(asar, 'r+');
  try {
    // Change one byte near the end, inside the bundled files rather than the header.
    writeSync(fd, Buffer.from('X'), 0, 1, size - 64);
  } finally {
    closeSync(fd);
  }
  // Electron stops with a FATAL error naming the damaged entry, before any window opens.
  await expect(launchPackaged()).rejects.toThrow(/exited early[\s\S]*Integrity check failed/);
});
