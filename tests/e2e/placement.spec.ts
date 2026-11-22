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
  gridToWorld,
  worldToScreen,
  type Camera,
  type Point,
} from '../../src/renderer/world/projection';
import { createProjectThroughUi } from './support/m1-ui';
import { finishOnboarding } from './support/onboarding';

// M2-3 (#68): the placement commands through the real preload and built main process. Place,
// list, move and remove a building; a forged overlap and a smuggled footprint are refused;
// archiving the project removes its building and the project stays readable.

test.describe('placement commands through window.atlas', () => {
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

  test.beforeEach(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'atlas-e2e-placement-'));
    app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env: cleanEnv() });
    page = await app.firstWindow();
    await finishOnboarding(page);
  });

  test.afterEach(async () => {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('place, refuse, move, archive and remove through window.atlas.placement', async () => {
    const outcome = await page.evaluate(async () => {
      const must = <T>(
        result: { ok: true; data: T } | { ok: false; error: { code: string } },
      ): T => {
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
      const placed = must(
        await window.atlas.placement.create({
          worldId,
          projectId: first.id,
          tileX: 2,
          tileY: 2,
          rotation: 0,
        }),
      ).placement;
      const overlap = await window.atlas.placement.create({
        worldId,
        projectId: second.id,
        tileX: 3,
        tileY: 3,
        rotation: 0,
      });
      const smuggled = await window.atlas.placement.create({
        worldId,
        projectId: second.id,
        tileX: 3,
        tileY: 3,
        rotation: 0,
        // @ts-expect-error: a forged payload, as a compromised page could send.
        footprint: { columns: 1, rows: 1 },
      });
      const moved = must(
        await window.atlas.placement.move({
          worldId,
          placementId: placed.id,
          expectedRevision: placed.revision,
          tileX: 10,
          tileY: 10,
          rotation: 90,
        }),
      ).placement;
      const listed = must(await window.atlas.placement.list({ worldId })).placements;
      const archived = must(
        await window.atlas.project.archive({
          worldId,
          projectId: first.id,
          expectedRevision: first.revision,
        }),
      ).project;
      const afterArchive = must(await window.atlas.placement.list({ worldId })).placements;
      const secondPlaced = must(
        await window.atlas.placement.create({
          worldId,
          projectId: second.id,
          tileX: 3,
          tileY: 3,
          rotation: 0,
        }),
      ).placement;
      must(
        await window.atlas.placement.remove({
          worldId,
          placementId: secondPlaced.id,
          expectedRevision: secondPlaced.revision,
        }),
      );
      const finalList = must(await window.atlas.placement.list({ worldId })).placements;
      const secondAfter = must(
        await window.atlas.project.get({ worldId, projectId: second.id }),
      ).project;

      return {
        placed: { tileX: placed.tileX, footprint: placed.footprint },
        overlap: overlap.ok ? null : overlap.error,
        smuggled: smuggled.ok ? null : smuggled.error.code,
        moved: { id: moved.id === placed.id, tileX: moved.tileX, rotation: moved.rotation },
        listed: listed.map((p) => p.target.id === first.id),
        archivedStatus: archived.status,
        afterArchive: afterArchive.length,
        finalList: finalList.length,
        secondAfter: { id: secondAfter.id === second.id, name: secondAfter.name },
        blockingIsFirst: !overlap.ok && overlap.error.placement?.blockingIds[0] === placed.id,
      };
    });

    expect(outcome).toEqual({
      placed: { tileX: 2, footprint: { columns: 2, rows: 2 } },
      overlap: {
        code: 'placement_blocked',
        message: 'Another building is in the way.',
        placement: { reason: 'overlaps', blockingIds: [expect.any(String)] },
      },
      smuggled: 'invalid_payload',
      moved: { id: true, tileX: 10, rotation: 90 },
      listed: [true],
      archivedStatus: 'archived',
      afterArchive: 0,
      finalList: 0,
      secondAfter: { id: true, name: 'Second' },
      blockingIsFirst: true,
    });
  });
});
// M2-7 (#72): the placement tool through the real UI. Projects and buildings are set up through
// the preload API (the same commands the UI uses); every change under test is made with the
// pointer or the keyboard, and read back through `placement.list`.
//
// Pointer positions come from the world's real camera (`data-camera`), worked out with the same
// projection code the app uses, as in world.spec.ts.
test.describe('placement tool UI', () => {
  /** A fixed window, so the tiles used below are always on screen. */
  const WINDOW = { width: 1280, height: 800 };

  interface Session {
    readonly app: ElectronApplication;
    readonly page: Page;
  }

  let userDataDir: string;
  let session: Session | null = null;

  async function launchApp(): Promise<Session> {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] =>
          entry[1] !== undefined && entry[0] !== 'ELECTRON_RENDERER_URL',
      ),
    );
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env,
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
    }, WINDOW);
    await finishOnboarding(page);
    session = { app, page };
    return session;
  }

  test.beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'atlas-e2e-placement-ui-'));
  });

  test.afterEach(async () => {
    await session?.app.close();
    session = null;
    rmSync(userDataDir, { recursive: true, force: true });
  });

  const host = (page: Page) => page.getByTestId('world-view-host');
  const toolBar = (page: Page) => page.getByTestId('placement-tool');
  const toolMessage = (page: Page) => page.getByTestId('placement-message');
  const row = (page: Page, name: string) => page.getByRole('listitem', { name, exact: true });

  async function camera(page: Page): Promise<Camera> {
    const [panX, panY, zoom] = ((await host(page).getAttribute('data-camera')) ?? '')
      .split(',')
      .map(Number);
    if (panX === undefined || panY === undefined || zoom === undefined || Number.isNaN(zoom)) {
      throw new Error('no camera yet');
    }
    return { panX, panY, zoom };
  }

  /** Window coordinates of a tile's centre, through the real camera. */
  async function tileCentre(page: Page, gx: number, gy: number): Promise<Point> {
    const box = await host(page).boundingBox();
    if (box === null) throw new Error('world host not visible');
    const screen = worldToScreen(gridToWorld({ gx: gx + 0.5, gy: gy + 0.5 }), await camera(page));
    return { x: box.x + screen.x, y: box.y + screen.y };
  }

  async function hoverTile(page: Page, gx: number, gy: number): Promise<void> {
    const point = await tileCentre(page, gx, gy);
    await page.mouse.move(point.x, point.y);
  }

  async function clickTile(page: Page, gx: number, gy: number): Promise<void> {
    const point = await tileCentre(page, gx, gy);
    await page.mouse.click(point.x, point.y);
  }

  /** The world's buildings as `name@x,y`, read through the preload API. */
  async function savedBuildings(page: Page): Promise<string[]> {
    return page.evaluate(async () => {
      const worlds = await window.atlas.world.list();
      if (!worlds.ok) throw new Error(worlds.error.code);
      const worldId = worlds.data.worlds[0]?.id ?? '';
      const [placements, projects] = await Promise.all([
        window.atlas.placement.list({ worldId }),
        window.atlas.project.list({ worldId, status: 'active' }),
      ]);
      if (!placements.ok || !projects.ok) throw new Error('list failed');
      const names = new Map(projects.data.projects.map((p) => [p.id, p.name]));
      return placements.data.placements
        .map(
          (p) => `${names.get(p.target.id) ?? p.target.id}@${String(p.tileX)},${String(p.tileY)}`,
        )
        .sort();
    });
  }

  /** Creates projects (and buildings for those with a tile) through the preload API. */
  async function seed(
    page: Page,
    specs: readonly { name: string; tile?: { x: number; y: number } }[],
  ): Promise<void> {
    await page.evaluate(async (list) => {
      const must = <T>(
        result: { ok: true; data: T } | { ok: false; error: { code: string } },
      ): T => {
        if (!result.ok) throw new Error(result.error.code);
        return result.data;
      };
      const worldId = must(await window.atlas.world.list()).worlds[0]?.id ?? '';
      for (const spec of list) {
        const { project } = must(
          await window.atlas.project.create({
            worldId,
            templateId: 'builtin.generic',
            templateVersion: '1.0.0',
            name: spec.name,
          }),
        );
        if (spec.tile !== undefined) {
          must(
            await window.atlas.placement.create({
              worldId,
              projectId: project.id,
              tileX: spec.tile.x,
              tileY: spec.tile.y,
              rotation: 0,
            }),
          );
        }
      }
    }, specs);
    await page.reload();
    await expect(page.locator('main[data-screen="main"]')).toBeVisible();
    await expect(page.getByTestId('world-view')).toHaveAttribute('data-state', 'ready');
  }

  async function backToWorld(page: Page): Promise<void> {
    const panel = page.getByTestId('entrance-panel');
    if (await panel.isVisible()) await panel.getByRole('button', { name: 'Back to world' }).click();
    await expect(panel).toHaveCount(0);
  }

  test('Place on map: the preview says why a spot is blocked; a click places the building', async () => {
    const { page } = await launchApp();
    await seed(page, [{ name: 'Alpha', tile: { x: 30, y: 30 } }, { name: 'Beta' }]);

    await row(page, 'Beta').getByRole('button', { name: 'Place on map' }).click();
    // The panel closes so the map shows, and the tool takes focus.
    await expect(page.getByTestId('entrance-panel')).toHaveCount(0);
    await expect(toolBar(page)).toHaveAttribute('data-mode', 'placing');
    await expect(toolBar(page)).toContainText('Placing “Beta”');
    await expect(page.getByRole('button', { name: 'Place here' })).toBeFocused();

    await hoverTile(page, 31, 31);
    await expect(toolBar(page)).toHaveAttribute('data-fits', 'false');
    await expect(page.getByTestId('placement-preview')).toHaveText(
      '✕ Blocked: another building is in the way',
    );
    await clickTile(page, 31, 31);
    await expect(toolMessage(page)).toHaveText(
      /It can't stand there: another building is in the way\. Pick another spot\./,
    );
    await expect(toolBar(page)).toBeVisible();
    expect(await savedBuildings(page)).toEqual(['Alpha@30,30']);

    await hoverTile(page, 24, 24);
    await expect(toolBar(page)).toHaveAttribute('data-fits', 'true');
    await expect(page.getByTestId('placement-preview')).toHaveText('✓ Fits here');
    await clickTile(page, 24, 24);
    await expect(toolMessage(page)).toHaveText(/Placed “Beta” at tile 24, 24\./);
    await expect(toolBar(page)).toHaveCount(0);
    await expect(page.getByTestId('world-view')).toHaveAttribute('data-buildings', '2');
    expect(await savedBuildings(page)).toEqual(['Alpha@30,30', 'Beta@24,24']);
  });

  test('when the command refuses, its message is shown and nothing changes', async () => {
    const { page } = await launchApp();
    await seed(page, [{ name: 'Beta' }, { name: 'Gamma' }]);
    await row(page, 'Beta').getByRole('button', { name: 'Place on map' }).click();
    await hoverTile(page, 26, 22);
    await expect(toolBar(page)).toHaveAttribute('data-fits', 'true');

    // Another window places Gamma on that spot after this one read the map: the preview still
    // says it fits, and only the command knows better.
    await page.evaluate(async () => {
      const worlds = await window.atlas.world.list();
      if (!worlds.ok) throw new Error('world.list');
      const worldId = worlds.data.worlds[0]?.id ?? '';
      const projects = await window.atlas.project.list({
        worldId,
        status: 'active',
      });
      if (!projects.ok) throw new Error('project.list');
      const gamma = projects.data.projects.find((p) => p.name === 'Gamma');
      if (gamma === undefined) throw new Error('no Gamma');
      const placed = await window.atlas.placement.create({
        worldId,
        projectId: gamma.id,
        tileX: 26,
        tileY: 22,
        rotation: 0,
      });
      if (!placed.ok) throw new Error(placed.error.code);
    });

    await clickTile(page, 26, 22);
    await expect(toolMessage(page)).toHaveText(
      /It can't stand there: another building is in the way\. Nothing was changed\./,
    );
    await expect(toolMessage(page)).toHaveAttribute('role', 'alert');
    expect(await savedBuildings(page)).toEqual(['Gamma@26,22']);
    // The map was read again, so the preview now shows Gamma in the way.
    await expect(toolBar(page)).toHaveAttribute('data-fits', 'false');
  });

  test('drag moves a building; an invalid drop keeps the saved location', async () => {
    const { page } = await launchApp();
    await seed(page, [
      { name: 'Alpha', tile: { x: 30, y: 30 } },
      { name: 'Beta', tile: { x: 36, y: 30 } },
    ]);
    await backToWorld(page);

    await clickTile(page, 31, 31);
    const inspector = page.getByTestId('inspector');
    await expect(inspector.getByRole('heading', { name: 'Alpha' })).toBeVisible();
    await inspector.getByRole('button', { name: 'Move building' }).click();
    await expect(toolBar(page)).toHaveAttribute('data-mode', 'moving');

    // Press on the building, drag it across the map and let go on free ground.
    const from = await tileCentre(page, 30, 30);
    const to = await tileCentre(page, 24, 26);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await expect(toolBar(page)).toHaveAttribute('data-anchor', '24,26');
    await page.mouse.up();
    await expect(toolMessage(page)).toHaveText(/Moved “Alpha” to tile 24, 26\./);
    expect(await savedBuildings(page)).toEqual(['Alpha@24,26', 'Beta@36,30']);

    // Drop it on Beta: refused, and it stays where it was saved.
    await clickTile(page, 25, 27);
    await inspector.getByRole('button', { name: 'Move building' }).click();
    const start = await tileCentre(page, 24, 26);
    const onBeta = await tileCentre(page, 36, 30);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(onBeta.x, onBeta.y, { steps: 8 });
    await expect(page.getByTestId('placement-preview')).toHaveText(
      '✕ Blocked: another building is in the way',
    );
    await page.mouse.up();
    await expect(toolMessage(page)).toHaveText(
      /Not moved: another building is in the way\. It stays at tile 24, 26\./,
    );
    expect(await savedBuildings(page)).toEqual(['Alpha@24,26', 'Beta@36,30']);

    // Escape leaves the tool and saves nothing.
    await page.keyboard.press('Escape');
    await expect(toolBar(page)).toHaveCount(0);
    await expect(toolMessage(page)).toHaveText(/Placement cancelled\. Nothing was changed\./);
    expect(await savedBuildings(page)).toEqual(['Alpha@24,26', 'Beta@36,30']);
  });

  test('Remove from map says the project, its files and its runs are kept', async () => {
    const { page } = await launchApp();
    await seed(page, [
      { name: 'Alpha', tile: { x: 30, y: 30 } },
      { name: 'Beta', tile: { x: 24, y: 24 } },
    ]);

    // From the Projects list.
    await row(page, 'Beta').getByRole('button', { name: 'Remove from map' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Remove the building of “Beta” from the map?');
    await expect(dialog).toContainText('The project is not deleted');
    await expect(dialog).toContainText('No files are moved or deleted.');
    await expect(dialog).toContainText('No runs are stopped or deleted.');
    await dialog.getByRole('button', { name: 'Remove from map' }).click();
    await expect(page.getByTestId('projects-message')).toContainText(
      'Removed the building of “Beta” from the map. The project, its files and its runs are kept',
    );
    await expect(row(page, 'Beta').getByTestId('project-not-placed')).toHaveText('Not placed');
    await expect(row(page, 'Beta').getByTestId('project-status')).toHaveText('Active');

    // From the inspector.
    await backToWorld(page);
    await clickTile(page, 31, 31);
    const inspector = page.getByTestId('inspector');
    await inspector.getByRole('button', { name: 'Remove from map' }).click();
    await expect(page.getByRole('dialog')).toContainText('No runs are stopped or deleted.');
    await page.getByRole('dialog').getByRole('button', { name: 'Remove from map' }).click();
    await expect(inspector.getByTestId('inspector-placement')).toHaveText('Not placed');
    await expect(inspector.getByTestId('inspector-status')).toHaveText('Active');
    expect(await savedBuildings(page)).toEqual([]);
    await expect(page.getByTestId('world-view-empty')).toBeVisible();
  });

  test('Auto-place finds a free plot without the map, and says so when the world is full', async () => {
    test.setTimeout(60_000);
    const { page } = await launchApp();
    await seed(page, [{ name: 'Alpha', tile: { x: 32, y: 32 } }, { name: 'Beta' }]);

    await row(page, 'Beta').getByRole('button', { name: 'Auto-place' }).click();
    await expect(page.getByTestId('projects-message')).toHaveText(
      /^Placed “Beta” at tile \d+, \d+, the nearest free spot\.$/,
    );
    await expect(row(page, 'Beta').getByTestId('project-not-placed')).toHaveCount(0);
    expect(await savedBuildings(page)).toHaveLength(2);

    // Fill the rest of the world so no 2 × 2 plot is left: buildings every third tile leave only
    // one-tile-wide gaps (anchors 0, 3, … 60 plus 62 on both axes).
    await page.evaluate(async () => {
      const must = <T>(
        result: { ok: true; data: T } | { ok: false; error: { code: string } },
      ): T => {
        if (!result.ok) throw new Error(result.error.code);
        return result.data;
      };
      const worldId = must(await window.atlas.world.list()).worlds[0]?.id ?? '';
      for (const existing of must(await window.atlas.placement.list({ worldId })).placements) {
        must(
          await window.atlas.placement.remove({
            worldId,
            placementId: existing.id,
            expectedRevision: existing.revision,
          }),
        );
      }
      const anchors = [...Array.from({ length: 21 }, (_, i) => i * 3), 62];
      let n = 0;
      for (const y of anchors) {
        for (const x of anchors) {
          const { project } = must(
            await window.atlas.project.create({
              worldId,
              templateId: 'builtin.generic',
              templateVersion: '1.0.0',
              name: `Filler ${String(++n)}`,
            }),
          );
          must(
            await window.atlas.placement.create({
              worldId,
              projectId: project.id,
              tileX: x,
              tileY: y,
              rotation: 0,
            }),
          );
        }
      }
      must(
        await window.atlas.project.create({
          worldId,
          templateId: 'builtin.generic',
          templateVersion: '1.0.0',
          name: 'Last',
        }),
      );
    });
    await page.reload();
    await expect(page.locator('main[data-screen="main"]')).toBeVisible();
    await page.getByLabel('Search projects').fill('Last');
    await row(page, 'Last').getByRole('button', { name: 'Auto-place' }).click();
    await expect(page.getByTestId('projects-message')).toContainText(
      'No free spot is big enough for a building in this world.',
    );
    await expect(row(page, 'Last').getByTestId('project-not-placed')).toHaveText('Not placed');
    expect(await savedBuildings(page)).toHaveLength(484);
  });

  test('keyboard only: arrow keys move the preview and Place here saves it', async () => {
    const { page } = await launchApp();
    await seed(page, [{ name: 'Beta' }]);

    const place = row(page, 'Beta').getByRole('button', {
      name: 'Place on map',
    });
    await place.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Place here' })).toBeFocused();
    const [x0 = 0, y0 = 0] = ((await toolBar(page).getAttribute('data-anchor')) ?? '')
      .split(',')
      .map(Number);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    const expected = `${String(x0 + 2)},${String(y0 + 1)}`;
    await expect(toolBar(page)).toHaveAttribute('data-anchor', expected);
    await expect(toolBar(page)).toContainText(`Tile ${String(x0 + 2)}, ${String(y0 + 1)}`);
    await page.keyboard.press('Enter');
    await expect(toolMessage(page)).toHaveText(
      new RegExp(`Placed “Beta” at tile ${String(x0 + 2)}, ${String(y0 + 1)}\\.`),
    );
    // The tool is gone, so focus moved to the result line rather than being lost.
    await expect(toolMessage(page)).toBeFocused();
    expect(await savedBuildings(page)).toEqual([`Beta@${expected}`]);
  });

  test('§22.2 #1: create a project, cancel placement, restart: it is still there and unplaced', async () => {
    const first = await launchApp();
    let { page } = first;
    await createProjectThroughUi(page, 'Keeper');
    await row(page, 'Keeper').getByRole('button', { name: 'Place on map' }).click();
    await expect(toolBar(page)).toBeVisible();
    await hoverTile(page, 30, 30);
    await page.keyboard.press('Escape');
    await expect(toolBar(page)).toHaveCount(0);
    await expect(toolMessage(page)).toHaveText(/Placement cancelled\. Nothing was changed\./);

    await first.app.close();
    session = null;
    ({ page } = await launchApp());
    await expect(row(page, 'Keeper')).toBeVisible();
    await expect(row(page, 'Keeper').getByTestId('project-status')).toHaveText('Active');
    await expect(row(page, 'Keeper').getByTestId('project-not-placed')).toHaveText('Not placed');
    expect(await savedBuildings(page)).toEqual([]);
  });
});
