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

import { finishOnboarding, openDeveloperSpikes } from './support/onboarding';

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
    profile: Object.keys(window.atlas.profile),
    profileSettings: Object.keys(window.atlas.profile.settings),
    profilePreferences: Object.keys(window.atlas.profile.preferences),
    world: Object.keys(window.atlas.world),
    project: Object.keys(window.atlas.project),
    placement: Object.keys(window.atlas.placement),
    hotbar: Object.keys(window.atlas.hotbar),
    relation: Object.keys(window.atlas.relation),
    graph: Object.keys(window.atlas.graph),
  }));
  expect(shape).toEqual({
    top: [
      'app',
      'runtime',
      'template',
      'profile',
      'world',
      'project',
      'placement',
      'hotbar',
      'relation',
      'graph',
    ],
    app: ['ping', 'launchInfo'],
    runtime: ['workerStatus', 'workerCheck'],
    template: ['list'],
    profile: ['list', 'create', 'rename', 'switch', 'settings', 'preferences'],
    profileSettings: ['get', 'update'],
    profilePreferences: ['get', 'update'],
    world: ['create', 'list', 'rename'],
    project: [
      'create',
      'get',
      'list',
      'rename',
      'updateGoal',
      'archive',
      'restore',
      'trash',
      'restoreFromTrash',
    ],
    placement: ['list', 'create', 'move', 'remove'],
    hotbar: ['list', 'assign', 'clear'],
    relation: ['create', 'remove'],
    graph: ['worldConnections'],
  });
});

test('profile and world commands round-trip through the built main process', async () => {
  const outcome = await page.evaluate(async () => {
    const profiles = await window.atlas.profile.list();
    const settings = await window.atlas.profile.settings.get();
    const created = await window.atlas.world.create({ name: 'E2E world' });
    const forged = await window.atlas.world.rename({
      worldId: '00000000-0000-4000-8000-000000000000',
      expectedRevision: 1,
      name: 'Nope',
    });
    const worlds = await window.atlas.world.list();
    return {
      activeIsListed:
        profiles.ok &&
        profiles.data.profiles.some((p) => p.isActive && p.id === profiles.data.activeProfileId),
      avatar: settings.ok ? settings.data.settings.avatarPreset : 'error',
      createdTheme: created.ok ? created.data.world.themeId : created.error.code,
      forgedCode: forged.ok ? 'accepted' : forged.error.code,
      worldNames: worlds.ok ? worlds.data.worlds.map((w) => w.name) : [],
    };
  });
  expect(outcome).toEqual({
    activeIsListed: true,
    avatar: null,
    createdTheme: 'meadow',
    forgedCode: 'not_found',
    worldNames: expect.arrayContaining(['E2E world']) as string[],
  });
});

test('project commands round-trip through the built main process with a bundled template', async () => {
  const outcome = await page.evaluate(async () => {
    const world = await window.atlas.world.create({ name: 'E2E projects' });
    if (!world.ok) return { step: 'world', code: world.error.code };
    const worldId = world.data.world.id;
    const created = await window.atlas.project.create({
      worldId,
      templateId: 'builtin.generic',
      templateVersion: '1.0.0',
      name: 'E2E project',
      goal: 'Prove the commands work',
    });
    if (!created.ok) return { step: 'create', code: created.error.code };
    const { id: projectId, revision } = created.data.project;
    const renamed = await window.atlas.project.rename({
      worldId,
      projectId,
      expectedRevision: revision,
      name: 'Renamed project',
    });
    if (!renamed.ok) return { step: 'rename', code: renamed.error.code };
    const trashed = await window.atlas.project.trash({
      worldId,
      projectId,
      expectedRevision: renamed.data.project.revision,
    });
    if (!trashed.ok) return { step: 'trash', code: trashed.error.code };
    const fetched = await window.atlas.project.get({ worldId, projectId });
    const active = await window.atlas.project.list({ worldId });
    const inTrash = await window.atlas.project.list({ worldId, status: 'trashed' });
    return {
      step: 'done',
      fetched: fetched.ok
        ? { id: fetched.data.project.id === projectId, name: fetched.data.project.name }
        : fetched.error.code,
      status: fetched.ok ? fetched.data.project.status : null,
      runCheck: trashed.data.runCheck,
      activeCount: active.ok ? active.data.projects.length : -1,
      trashNames: inTrash.ok ? inTrash.data.projects.map((p) => p.name) : [],
    };
  });
  expect(outcome).toEqual({
    step: 'done',
    fetched: { id: true, name: 'Renamed project' },
    status: 'trashed',
    runCheck: 'stub',
    activeCount: 0,
    trashNames: ['Renamed project'],
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
  // The IPC check panel sits under "Developer spikes" on the main screen (M1-9).
  await openDeveloperSpikes(page);
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
// Main screen layout and shortcut layer (M2-5, #70; UI_SPEC §6.1, §6.2, §6.6).
test.describe('main screen layout and keyboard shortcuts', () => {
  const panel = () => page.getByTestId('entrance-panel');
  const entrance = (name: string) =>
    page.getByRole('navigation', { name: 'Entrances' }).getByRole('button', { name, exact: true });
  const libraryButton = () => page.locator('.bottom-bar').getByRole('button', { name: /^Library/ });

  test.beforeAll(async () => {
    // Earlier tests created worlds through the API; reload so the screen shows them.
    await page.reload();
    await finishOnboarding(page);
  });

  test('shows the §6.1 regions, with the project list open at startup', async () => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Atlas Realm');
    await expect(
      page.getByRole('navigation', { name: 'Entrances' }).getByRole('button'),
    ).toHaveText([
      'Projects',
      'Agents Guild',
      'Skill Library',
      'Tool Shops',
      'Automations',
      'Activity',
      'Settings',
    ]);
    await expect(page.getByTestId('world-area')).toBeVisible();
    const side = page.getByRole('complementary', {
      name: 'Realm Atlas and inspector',
    });
    await expect(side.getByRole('heading', { name: 'Realm Atlas' })).toBeVisible();
    await expect(side.getByRole('heading', { name: 'Inspector' })).toBeVisible();
    await expect(libraryButton()).toBeVisible();
    await expect(page.getByRole('group', { name: 'Hotbar' })).toContainText(
      'Hotbar: not built yet (planned later in M2)',
    );
    // M1-10's project list is there without any clicks.
    await expect(entrance('Projects')).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('projects-summary')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
  });

  for (const name of ['Agents Guild', 'Skill Library', 'Tool Shops', 'Automations', 'Activity']) {
    test(`${name} opens a "not built yet" panel; Escape closes it and restores focus`, async () => {
      await entrance(name).click();
      await expect(panel().getByRole('heading', { name, exact: true })).toBeFocused();
      await expect(panel().getByTestId('not-built')).toHaveText('Not built yet (planned for M3+)');
      await page.keyboard.press('Escape');
      await expect(panel()).toHaveCount(0);
      await expect(entrance(name)).toBeFocused();
    });
  }

  test('"Back to world" closes Settings and returns focus to its entrance', async () => {
    await entrance('Settings').click();
    await expect(panel().getByRole('heading', { name: 'Settings' })).toBeFocused();
    await page.getByRole('button', { name: 'Back to world' }).click();
    await expect(panel()).toHaveCount(0);
    await expect(entrance('Settings')).toBeFocused();
  });

  test('E toggles the library, but never while typing in a field', async () => {
    await entrance('Projects').click();
    await page.getByRole('button', { name: 'New project' }).click();
    const nameField = page.getByRole('form', { name: 'New project' }).getByLabel('Project name');
    await nameField.fill('');
    await nameField.press('e');
    await nameField.press('E');
    await expect(nameField).toHaveValue('eE');
    await expect(libraryButton()).toHaveAttribute('aria-pressed', 'false');
    // Escape in the field belongs to the form (it cancels the draft); the panel stays open.
    await nameField.press('Escape');
    await expect(page.getByRole('form', { name: 'New project' })).toHaveCount(0);
    await expect(page.getByTestId('projects-summary')).toBeVisible();

    // Outside a field, E opens the library and E again closes it.
    await entrance('Projects').focus();
    await page.keyboard.press('e');
    await expect(panel().getByRole('heading', { name: 'Library' })).toBeFocused();
    await expect(panel().getByRole('tab', { name: 'Projects', selected: true })).toBeVisible();
    await expect(libraryButton()).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('e');
    await expect(panel()).toHaveCount(0);
    // Focus goes back to what had it when E was pressed.
    await expect(entrance('Projects')).toBeFocused();
  });

  test('keys are left alone while a confirmation dialog is open', async () => {
    const worldId = await page.evaluate(async () => {
      const worlds = await window.atlas.world.list();
      return worlds.ok ? worlds.data.worlds[0]?.id : undefined;
    });
    if (worldId === undefined) throw new Error('no world');
    const created = await page.evaluate(
      (id) =>
        window.atlas.project.create({
          worldId: id,
          templateId: 'builtin.generic',
          templateVersion: '1.0.0',
          name: 'Shortcut probe',
          goal: '',
        }),
      worldId,
    );
    if (!created.ok) throw new Error(`project.create failed: ${created.error.code}`);
    const projectId = created.data.project.id;
    // Reopen Projects so the list reads the new project.
    await entrance('Settings').click();
    await entrance('Projects').click();
    const row = page.getByRole('listitem', {
      name: 'Shortcut probe',
      exact: true,
    });
    await row.getByRole('button', { name: 'Archive', exact: true }).click();
    const dialog = page.getByRole('dialog', {
      name: 'Archive “Shortcut probe”?',
    });
    await expect(dialog).toBeVisible();

    await page.keyboard.press('e');
    await expect(libraryButton()).toHaveAttribute('aria-pressed', 'false');
    // Escape closes only the dialog: the panel behind it stays open and nothing is archived.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('projects-summary')).toBeVisible();
    await expect(row).toBeVisible();
    const fetched = await page.evaluate((ids) => window.atlas.project.get(ids), {
      worldId,
      projectId,
    });
    expect(fetched.ok && fetched.data.project.status).toBe('active');
  });

  test('narrow windows turn the Atlas column into a drawer', async () => {
    const side = page.getByRole('complementary', {
      name: 'Realm Atlas and inspector',
    });
    const toggle = page.getByRole('button', {
      name: 'Atlas & inspector',
      exact: true,
    });
    const original = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.getContentSize(),
    );
    const resize = (size: readonly [number, number]) =>
      app.evaluate(({ BrowserWindow }, [width, height]) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(width, height);
      }, size);
    try {
      await resize([800, 700]);
      await expect(side).toBeHidden();
      await toggle.click();
      await expect(side).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(side.getByRole('button', { name: 'Close Atlas & inspector' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(side).toBeHidden();
      await expect(toggle).toBeFocused();
    } finally {
      const [width = 1280, height = 800] = original ?? [];
      await resize([width, height]);
    }
    await expect(side).toBeVisible();
    await expect(toggle).toBeHidden();
  });
});
