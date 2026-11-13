import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
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

import {
  hasProfileData,
  lastUsedDatabaseFile,
  requireDatabaseFile,
} from '../e2e/support/profile-data';

// Smoke tests for the packaged app (#10, TEST_PLAN §22.2 #24). They copy release/win-unpacked
// to a folder whose path has spaces and non-ASCII characters and run the real .exe from there.
//
// Why not Playwright's _electron.launch: it attaches through Node's --inspect, and the
// packaged app turns that off with a fuse. Instead we start the .exe ourselves with Chromium's
// --remote-debugging-port and connect to the window over CDP (the DevTools protocol).
//
// Two builds (#20, ADR-0015). The shipped build (release/win-unpacked, `pnpm package`) refuses
// --remote-debugging-port, so the UI smoke tests drive the test-only variant
// (release-test/win-unpacked, `pnpm package:test`). Same bundled code, plus a marker in the
// package.json inside app.asar that allows that one switch. It has its own exe name, appId and
// data folder, so it can't be mistaken for the real app. The shipped build gets the
// switch-guard tests, the marker check and the fuse readout.

const UNPACKED = resolve('release-test', 'win-unpacked');
const SHIPPED_UNPACKED = resolve('release', 'win-unpacked');
const EXE_NAME = 'AtlasRealmTest.exe';
const SHIPPED_EXE_NAME = 'Atlas Realm.exe';
const devElectron = createRequire(import.meta.url)('electron') as string;

test.describe.configure({ mode: 'serial' });

let root: string;
let installDir: string;
let exePath: string;
let shippedExePath: string;
let userDataDir: string;

test.beforeAll(async () => {
  if (!existsSync(join(SHIPPED_UNPACKED, SHIPPED_EXE_NAME))) {
    throw new Error('No packaged app in release/win-unpacked. Run `pnpm package` first.');
  }
  if (!existsSync(join(UNPACKED, EXE_NAME))) {
    throw new Error('No test variant in release-test/win-unpacked. Run `pnpm package:test`.');
  }
  root = mkdtempSync(join(tmpdir(), 'atlas packaged Ünïcødé 测试 '));
  installDir = join(root, 'Program Fïles (x86) 地图', 'Atlas Realm');
  userDataDir = join(root, 'user data Ünïcødé 测试');
  // Not cpSync: on Node 24.13/Windows it silently copies nothing into a non-ASCII folder.
  await cp(UNPACKED, installDir, { recursive: true });
  exePath = join(installDir, EXE_NAME);
  if (!existsSync(exePath)) throw new Error(`Copy failed: ${exePath} is missing`);
  const shippedDir = join(root, 'shipped Fïles 地图', 'Atlas Realm');
  await cp(SHIPPED_UNPACKED, shippedDir, { recursive: true });
  shippedExePath = join(shippedDir, SHIPPED_EXE_NAME);
  if (!existsSync(shippedExePath)) throw new Error(`Copy failed: ${shippedExePath} is missing`);
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
    await expect(first.page.getByTestId('launch-info')).toHaveText(/^Launch #1 · .* · schema v2$/);
  } finally {
    expect(await quit(first)).toBe(0);
  }

  // node:sqlite works in the packaged app: the second start reads what the first one stored.
  const second = await launchPackaged();
  try {
    await expect(second.page.getByTestId('launch-info')).toHaveText(/^Launch #2 · .* · schema v2$/);
  } finally {
    expect(await quit(second)).toBe(0);
  }
  expect(existsSync(requireDatabaseFile(userDataDir))).toBe(true);
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

test('bundled placeholder art ships in app.asar and loads offline from app://atlas (M0-8)', async () => {
  // The packaged app records no resource-timing entries for app:// loads, so instead of
  // reading performance entries we decode the built file by name. Its hashed name comes from
  // out/renderer, the build that `pnpm package` just wrapped.
  const built = readdirSync(resolve('out', 'renderer', 'assets')).filter((name) =>
    /^selection-[\w-]+\.png$/.test(name),
  );
  expect(built).toHaveLength(1);
  const running = await launchPackaged();
  try {
    const { page } = running;
    // The world decodes its art before it reports ready; a missing file would leave it failed.
    await expect(page.getByTestId('world')).toHaveAttribute('data-state', 'ready');
    const size = await page.evaluate(
      async (url) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        return { width: image.naturalWidth, height: image.naturalHeight };
      },
      `app://atlas/assets/${String(built[0])}`,
    );
    expect(size).toEqual({ width: 64, height: 32 });
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

// ---- Chromium switch guard (#20) -------------------------------------------------------

interface Started {
  readonly child: ChildProcess;
  readonly output: () => string;
  readonly userData: string;
}

/** Starts an .exe without CDP (default: the shipped build) with its own fresh userData. */
function startExe(args: string[], exe = shippedExePath): Started {
  const userData = mkdtempSync(join(root, 'guard data Ü '));
  const child = spawn(exe, [`--user-data-dir=${userData}`, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  return { child, output: () => output, userData };
}

/** Resolves with the exit code, or 'still running' after the timeout. */
function exitOrTimeout(child: ChildProcess, ms: number): Promise<number | null | 'still running'> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((r) => {
    const timer = setTimeout(() => {
      r('still running');
    }, ms);
    child.once('exit', (code) => {
      clearTimeout(timer);
      r(code);
    });
  });
}

/** Ends the whole process tree (renderer, GPU, worker): the shipped build has no CDP to close it. */
function killTree(child: ChildProcess): void {
  if (child.pid !== undefined && child.exitCode === null) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  }
}

async function portAnswers(port: number): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${String(port)}/json/version`)).ok;
  } catch {
    return false;
  }
}

/**
 * Polls the port every 50 ms from start until the process exits (or the timeout), so a port
 * that opened briefly and closed again is still caught.
 */
async function watchPortUntilExit(
  child: ChildProcess,
  port: number,
  ms: number,
): Promise<{ exit: number | null | 'still running'; portEverAnswered: boolean }> {
  let portEverAnswered = false;
  // An object, so lint sees that the .finally callback changes it.
  const state = { done: false };
  const exit = exitOrTimeout(child, ms).finally(() => {
    state.done = true;
  });
  while (!state.done) {
    if (await portAnswers(port)) portEverAnswered = true;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (await portAnswers(port)) portEverAnswered = true;
  return { exit: await exit, portEverAnswered };
}

test('positive control: the shipped build starts normally without blocked switches', async () => {
  const started = startExe([]);
  try {
    // It opens its database (so it got past the guard and the lock) and keeps running.
    await expect
      .poll(
        () => {
          const file = lastUsedDatabaseFile(started.userData);
          return file !== undefined && existsSync(file);
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    expect(await exitOrTimeout(started.child, 1_000)).toBe('still running');
    expect(started.output()).not.toContain('[security]');
  } finally {
    killTree(started.child);
  }
});

test('the shipped build quits on --remote-debugging-port before opening the port or DB', async () => {
  // Positive control for the port: the test variant does open it (launchPackaged, used by
  // every smoke test above). Chromium also accepts -x, /x and any letter case on Windows;
  // the guard asks Chromium's own parser, so all of them are caught.
  for (const spelling of [
    '--remote-debugging-port',
    '-remote-debugging-port',
    '/remote-debugging-port',
    '--REMOTE-DEBUGGING-PORT',
  ]) {
    const port = await freePort();
    const started = startExe([`${spelling}=${String(port)}`]);
    try {
      const watched = await watchPortUntilExit(started.child, port, 20_000);
      expect(watched.exit, spelling).toBe(1);
      expect(started.output()).toContain(
        '[security] refusing to start with blocked switches: remote-debugging-port',
      );
      expect(watched.portEverAnswered, spelling).toBe(false);
      expect(hasProfileData(started.userData)).toBe(false);
    } finally {
      killTree(started.child);
    }
  }
});

test('the shipped build quits on other debugging, sandbox and proxy switches', async () => {
  for (const [arg, name] of [
    ['--remote-debugging-pipe', 'remote-debugging-pipe'],
    ['--no-sandbox', 'no-sandbox'],
    ['--disable-web-security', 'disable-web-security'],
    ['--js-flags=--allow-natives-syntax', 'js-flags'],
    ['--proxy-server=127.0.0.1:1', 'proxy-server'],
    ['--disable-features=IsolateOrigins,site-per-process', 'disable-features'],
    ['--disable-gpu-sandbox', 'disable-gpu-sandbox'],
    ['--ssl-key-log-file=keys.log', 'ssl-key-log-file'],
  ] as const) {
    const started = startExe([arg]);
    try {
      expect(await exitOrTimeout(started.child, 20_000), arg).toBe(1);
      expect(started.output()).toContain(`blocked switches: ${name}`);
      expect(hasProfileData(started.userData)).toBe(false);
    } finally {
      killTree(started.child);
    }
  }
});

test('the test variant allows only --remote-debugging-port and still refuses the rest', async () => {
  const port = await freePort();
  const started = startExe([`--remote-debugging-port=${String(port)}`, '--no-sandbox'], exePath);
  try {
    const watched = await watchPortUntilExit(started.child, port, 20_000);
    expect(watched.exit).toBe(1);
    // Only no-sandbox is reported: remote-debugging-port is the variant's one exception.
    expect(started.output()).toMatch(/blocked switches: no-sandbox\r?\n/);
    expect(watched.portEverAnswered).toBe(false);
  } finally {
    killTree(started.child);
  }
});

test('only the test variant carries the packagedTest marker (the shipped build has none)', () => {
  // The package.json inside app.asar is stored uncompressed, so its text is in the archive's
  // bytes. The bundled code says `.packagedTest === true`, which this pattern doesn't match.
  // The installer is built from the same release/win-unpacked folder in the same run.
  const marker = /"packagedTest"\s*:\s*true/;
  const asarText = (dir: string): string =>
    readFileSync(join(dir, 'resources', 'app.asar')).toString('latin1');
  expect(asarText(UNPACKED)).toMatch(marker); // positive control
  expect(asarText(SHIPPED_UNPACKED)).not.toMatch(marker);
  expect(existsSync(join(SHIPPED_UNPACKED, EXE_NAME))).toBe(false);
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

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0: existence check only
    return true;
  } catch {
    return false;
  }
}

test('the worker utility process runs from inside app.asar with the fuses on (M0-6)', async () => {
  // Nothing is unpacked next to the asar, so the worker script can only come from inside it.
  expect(existsSync(join(installDir, 'resources', 'app.asar'))).toBe(true);
  expect(existsSync(join(installDir, 'resources', 'app.asar.unpacked'))).toBe(false);

  const running = await launchPackaged();
  let pid: number | null = null;
  try {
    const { page } = running;
    await expect(page.getByTestId('worker-status')).toContainText('Worker running · pid');
    const check = await page.evaluate(() => window.atlas.runtime.workerCheck());
    expect(check).toMatchObject({
      ok: true,
      data: {
        echo: { outcome: 'ok' },
        cancel: { outcome: 'cancelled', activeAfterCancel: 0 },
        status: { state: 'running', crashCount: 0 },
      },
    });

    // Crash detection and restart also work packaged.
    const status = await page.evaluate(() => window.atlas.runtime.workerStatus());
    if (!status.ok || status.data.pid === null) throw new Error('no worker pid');
    process.kill(status.data.pid);
    await expect
      .poll(async () => {
        const after = await page.evaluate(() => window.atlas.runtime.workerStatus());
        return after.ok ? after.data.state : after.error.code;
      })
      .toBe('crashed');
    const recovered = await page.evaluate(() => window.atlas.runtime.workerCheck());
    expect(recovered).toMatchObject({ ok: true, data: { status: { crashCount: 1 } } });
    pid = recovered.ok ? recovered.data.status.pid : null;
  } finally {
    expect(await quit(running)).toBe(0);
  }
  // Quitting leaves no worker behind.
  expect(pid).not.toBeNull();
  if (pid !== null) await expect.poll(() => isAlive(pid), { timeout: 5_000 }).toBe(false);
});

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
  // Both builds: the test variant differs only in its package.json marker.
  for (const binary of [shippedExePath, exePath]) {
    expect(fuseStates(binary)).toEqual({
      runAsNode: '0',
      nodeOptions: '0',
      nodeCliInspect: '0',
      asarIntegrity: '1',
      onlyLoadAppFromAsar: '1',
      fileProtocolExtraPrivileges: '0',
    });
  }
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

  // Two layers: the inspect fuse is off (readout above), and since #20 the switch guard
  // refuses to start at all, so no debugger can announce itself.
  await expect(launchPackaged({ args: ['--inspect=0'] })).rejects.toThrow(
    /exited early \(code 1\)[\s\S]*blocked switches: inspect/,
  );
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
