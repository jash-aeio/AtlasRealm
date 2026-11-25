// UI steps and read-backs shared by the M2 acceptance tests (M2-15, #80): the dev build
// (tests/e2e/m2-acceptance.spec.ts) and the packaged build (tests/e2e-packaged). Setup may go
// through the preload API (the same commands the UI uses); the checks compare what was saved
// with what the user sees.
import { inflateSync } from 'node:zlib';

import { expect, type Locator, type Page } from '@playwright/test';

import type { ProjectSummary } from '../../../src/common/contracts/project';
import {
  gridToWorld,
  worldToScreen,
  type GridPoint,
  type Point,
} from '../../../src/renderer/world/projection';

export interface ProjectSeed {
  readonly name: string;
  readonly goal?: string;
  /** Gives the project a building at this tile. */
  readonly tile?: { readonly x: number; readonly y: number };
  /** Archived first, then placed if it has a tile (archiving removes a building, ADR-0025). */
  readonly archived?: boolean;
}

/** Creates projects (and buildings) through the preload API. Returns name → project ID. */
export async function seedProjects(
  page: Page,
  seeds: readonly ProjectSeed[],
): Promise<Record<string, string>> {
  return page.evaluate(async (list) => {
    const must = <T>(result: { ok: true; data: T } | { ok: false; error: { code: string } }): T => {
      if (!result.ok) throw new Error(result.error.code);
      return result.data;
    };
    const worldId = must(await window.atlas.world.list()).worlds[0]?.id ?? '';
    const ids: Record<string, string> = {};
    for (const seed of list) {
      let { project } = must(
        await window.atlas.project.create({
          worldId,
          templateId: 'builtin.generic',
          templateVersion: '1.0.0',
          name: seed.name,
          ...(seed.goal === undefined ? {} : { goal: seed.goal }),
        }),
      );
      if (seed.archived === true) {
        ({ project } = must(
          await window.atlas.project.archive({
            worldId,
            projectId: project.id,
            expectedRevision: project.revision,
          }),
        ));
      }
      if (seed.tile !== undefined) {
        must(
          await window.atlas.placement.create({
            worldId,
            projectId: project.id,
            tileX: seed.tile.x,
            tileY: seed.tile.y,
            rotation: 0,
          }),
        );
      }
      ids[seed.name] = project.id;
    }
    return ids;
  }, seeds);
}

/** Every project of the only world, in every status, following the cursor to the end. */
export async function allProjects(page: Page): Promise<ProjectSummary[]> {
  return page.evaluate(async () => {
    const worlds = await window.atlas.world.list();
    if (!worlds.ok) throw new Error(worlds.error.code);
    const worldId = worlds.data.worlds[0]?.id ?? '';
    const out: ProjectSummary[] = [];
    for (const status of ['active', 'archived', 'trashed'] as const) {
      let cursor: string | undefined;
      do {
        const page = await window.atlas.project.list({
          worldId,
          status,
          limit: 100,
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!page.ok) throw new Error(page.error.code);
        out.push(...page.data.projects);
        cursor = page.data.nextCursor ?? undefined;
      } while (cursor !== undefined);
    }
    return out;
  });
}

export interface SavedBuilding {
  readonly projectId: string;
  readonly name: string;
  readonly archived: boolean;
  readonly x: number;
  readonly y: number;
}

/** The world's project buildings as saved, sorted by name. */
export async function savedBuildings(page: Page): Promise<SavedBuilding[]> {
  const buildings = await page.evaluate(async () => {
    const worlds = await window.atlas.world.list();
    if (!worlds.ok) throw new Error(worlds.error.code);
    const worldId = worlds.data.worlds[0]?.id ?? '';
    const list = await window.atlas.placement.list({ worldId });
    if (!list.ok) throw new Error(list.error.code);
    return list.data.placements.map((p) => ({
      targetType: p.target.type,
      projectId: p.target.id,
      name: p.projectName ?? '',
      archived: p.projectStatus === 'archived',
      x: p.tileX,
      y: p.tileY,
    }));
  });
  // M2 offers no way to place a service structure, so every building is a project's.
  expect(buildings.filter((b) => b.targetType !== 'project')).toEqual([]);
  return buildings
    .map(({ projectId, name, archived, x, y }) => ({ projectId, name, archived, x, y }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The world's hotbar as `slot → target ID`, as saved. */
export async function savedPins(page: Page): Promise<Record<number, string>> {
  return page.evaluate(async () => {
    const worlds = await window.atlas.world.list();
    if (!worlds.ok) throw new Error(worlds.error.code);
    const worldId = worlds.data.worlds[0]?.id ?? '';
    const list = await window.atlas.hotbar.list({ worldId });
    if (!list.ok) throw new Error(list.error.code);
    return Object.fromEntries(list.data.slots.map((s) => [s.slot, s.target.id]));
  });
}

export const entrancePanel = (page: Page): Locator => page.getByTestId('entrance-panel');
export const libraryButton = (page: Page): Locator =>
  page.locator('.bottom-bar').getByRole('button', { name: /^Library/ });
const atlas = (page: Page): Locator => page.getByTestId('realm-atlas');

/** Opens the library on its Projects tab (or leaves it open). */
export async function openLibraryProjects(page: Page): Promise<Locator> {
  if ((await libraryButton(page).getAttribute('aria-pressed')) !== 'true') {
    await libraryButton(page).click();
  }
  const panel = entrancePanel(page);
  await expect(panel.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await panel.getByRole('tab', { name: 'Projects', exact: true }).click();
  return panel;
}

/** Project names the library lists under one status and one "On map" filter. */
export async function libraryNames(
  page: Page,
  status: 'Active' | 'Archived',
  onMap: 'Placed' | 'Not placed',
): Promise<string[]> {
  const panel = await openLibraryProjects(page);
  await panel
    .getByRole('group', { name: 'Show projects' })
    .getByRole('button', { name: status, exact: true })
    .click();
  await panel
    .getByRole('group', { name: 'On map' })
    .getByRole('button', { name: onMap, exact: true })
    .click();
  const summary = panel.getByTestId('projects-summary');
  await expect(summary).not.toHaveText(/Loading|Checking|Searching/);
  const names = await panel.locator('.project-item h4').allTextContents();
  return names.sort((a, b) => a.localeCompare(b));
}

/**
 * The Exit check: what the user sees matches what was saved. Compares the saved placements and
 * projects with the world view (building count, status line), the Atlas Map's Buildings list
 * (name and tile of each building) and the library's Placed / Not placed filters. Leaves the
 * library open.
 */
export async function expectWorldMatchesSaved(page: Page): Promise<{
  placed: number;
  unplaced: number;
}> {
  const buildings = await savedBuildings(page);
  const projects = await allProjects(page);
  const placedIds = new Set(buildings.map((b) => b.projectId));
  const byName = (list: ProjectSummary[]) =>
    list.map((p) => p.name).sort((a, b) => a.localeCompare(b));
  const ofStatus = (status: ProjectSummary['status'], placed: boolean) =>
    byName(projects.filter((p) => p.status === status && placedIds.has(p.id) === placed));

  // Every building belongs to a saved, non-trashed project of this world.
  for (const building of buildings) {
    const project = projects.find((p) => p.id === building.projectId);
    expect(project?.status, building.name).toMatch(/^(active|archived)$/);
    expect(project?.name).toBe(building.name);
  }

  // The world view.
  const world = page.getByTestId('world-view');
  await expect(world).toHaveAttribute('data-state', 'ready');
  await expect(world).toHaveAttribute('data-buildings', String(buildings.length));
  const status = page.getByTestId('world-view-status');
  await expect(status).toContainText(
    `${String(buildings.length)} ${buildings.length === 1 ? 'building' : 'buildings'} (placeholder art)`,
  );
  await expect(status).not.toContainText('missing art');

  // The Atlas Map: one line per building, with its tile.
  await atlas(page).getByRole('tab', { name: 'Map', exact: true }).click();
  const mapList = atlas(page).getByTestId('atlas-map-list');
  await expect(mapList.locator('summary')).toHaveText(
    `Buildings list (${String(buildings.length)})`,
  );
  if ((await mapList.getAttribute('open')) === null) await mapList.locator('summary').click();
  const expectedLines = buildings
    .map((b) => `${b.name}${b.archived ? ' (archived)' : ''} · tile ${String(b.x)}, ${String(b.y)}`)
    .sort((a, b) => a.localeCompare(b));
  const shownLines = (await mapList.locator('li button').allTextContents())
    .map((line) => line.replace(/ · pinned$/, ''))
    .sort((a, b) => a.localeCompare(b));
  expect(shownLines).toEqual(expectedLines);

  // The library, through its filters.
  expect(await libraryNames(page, 'Active', 'Placed')).toEqual(ofStatus('active', true));
  expect(await libraryNames(page, 'Active', 'Not placed')).toEqual(ofStatus('active', false));
  expect(await libraryNames(page, 'Archived', 'Placed')).toEqual(ofStatus('archived', true));
  expect(await libraryNames(page, 'Archived', 'Not placed')).toEqual(ofStatus('archived', false));

  const live = projects.filter((p) => p.status !== 'trashed');
  return { placed: buildings.length, unplaced: live.length - buildings.length };
}

/** The camera the world is really using (the host's `data-camera`). */
export async function worldCamera(
  page: Page,
): Promise<{ panX: number; panY: number; zoom: number }> {
  const value = await page.getByTestId('world-view-host').getAttribute('data-camera');
  const [panX, panY, zoom] = (value ?? '').split(',').map(Number);
  if (panX === undefined || panY === undefined || zoom === undefined || Number.isNaN(zoom)) {
    throw new Error(`no camera yet: ${String(value)}`);
  }
  return { panX, panY, zoom };
}

/** Window coordinates of a grid point, through the real camera and the same projection code. */
export async function windowPointOf(page: Page, grid: GridPoint): Promise<Point> {
  const box = await page.getByTestId('world-view-host').boundingBox();
  if (box === null) throw new Error('world host not visible');
  const screen = worldToScreen(gridToWorld(grid), await worldCamera(page));
  return { x: box.x + screen.x, y: box.y + screen.y };
}

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Placeholder ground is grass 0x4f7a3f: green clearly dominates. Background ink is near black. */
export const isGround = ({ r, g, b }: Rgb): boolean => g > r + 15 && g > b + 10 && g > 50;
export const isBackground = ({ r, g, b }: Rgb): boolean => r < 40 && g < 40 && b < 45;

/**
 * Reads one screen pixel through a 1 × 1 page screenshot. Works over CDP, so the packaged app
 * (whose fuses shut the main process out) can use it too. A 1 × 1 PNG needs no real decoder:
 * with no pixel to the left or above, every PNG row filter leaves the bytes as they are, so
 * after inflating the data it is one filter byte followed by the colour.
 */
export async function screenPixel(page: Page, point: Point): Promise<Rgb> {
  const png = await page.screenshot({
    clip: { x: Math.round(point.x), y: Math.round(point.y), width: 1, height: 1 },
    animations: 'disabled',
    // CSS pixels, so a high-DPI screen still gives one pixel.
    scale: 'css',
  });
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const colourType = png[25];
  if (width !== 1 || height !== 1) {
    throw new Error(`expected a 1 × 1 screenshot, got ${String(width)} × ${String(height)}`);
  }
  if (colourType !== 2 && colourType !== 6) {
    throw new Error(`unexpected PNG colour type ${String(colourType)}`);
  }
  const data: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    if (type === 'IDAT') data.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const [, r = 0, g = 0, b = 0] = raw;
  return { r, g, b };
}
