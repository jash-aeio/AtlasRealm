import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GraphWorldConnectionsOutput } from '../../src/common/contracts/graph';
import type { PlacementSummary } from '../../src/common/contracts/placement';
import { finishOnboarding } from './support/onboarding';

// The Realm Atlas Connections tab (M2-13 #78, GRAPH_MODEL §30.3–30.6, ADR-0032) in the built app:
// real projects (placed, unplaced and archived) and their links from `graph.worldConnections`,
// the legend, creating and removing links through forms, the keyboard list, selection shared with
// the world and the Map (§22.2 #25), dragging nodes leaving buildings alone (§22.2 #26), reduced
// motion and truncation counts.

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
let worldId = '';
const ids = new Map<string, string>();

/** Orchard and Harbour have buildings; Notebook has none; Attic is archived (so no building). */
const PLACED = [
  { name: 'Orchard', x: 8, y: 8 },
  { name: 'Harbour', x: 40, y: 12 },
] as const;
const UNPLACED = ['Notebook', 'Attic'] as const;

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'atlas-e2e-connections-'));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== 'ELECTRON_RENDERER_URL',
    ),
  );
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900);
  });
  await finishOnboarding(page);

  const seeded = await page.evaluate(
    async ({ placed, unplaced }) => {
      const must = <T>(
        result: { ok: true; data: T } | { ok: false; error: { code: string } },
      ): T => {
        if (!result.ok) throw new Error(result.error.code);
        return result.data;
      };
      const world = must(await window.atlas.world.list()).worlds[0]?.id ?? '';
      const made: [string, string][] = [];
      for (const name of [...placed.map((p) => p.name), ...unplaced]) {
        const { project } = must(
          await window.atlas.project.create({
            worldId: world,
            templateId: 'builtin.generic',
            templateVersion: '1.0.0',
            name,
          }),
        );
        made.push([name, project.id]);
        const spot = placed.find((p) => p.name === name);
        if (spot !== undefined) {
          must(
            await window.atlas.placement.create({
              worldId: world,
              projectId: project.id,
              tileX: spot.x,
              tileY: spot.y,
              rotation: 0,
            }),
          );
        }
        if (name === 'Attic') {
          must(
            await window.atlas.project.archive({
              worldId: world,
              projectId: project.id,
              expectedRevision: project.revision,
            }),
          );
        }
      }
      const byName = new Map(made);
      must(
        await window.atlas.relation.create({
          worldId: world,
          sourceProjectId: byName.get('Orchard') ?? '',
          targetProjectId: byName.get('Harbour') ?? '',
          type: 'depends_on',
        }),
      );
      return { world, made };
    },
    { placed: PLACED.map((p) => ({ ...p })), unplaced: [...UNPLACED] },
  );
  worldId = seeded.world;
  for (const [name, id] of seeded.made) ids.set(name, id);
  await page.reload();
  await expect(page.locator('main[data-screen="main"]')).toBeVisible();
  await expect(page.getByTestId('world-view')).toHaveAttribute('data-state', 'ready');
  await atlas().getByRole('tab', { name: 'Connections' }).click();
  await expect(graph()).toBeVisible();
});

test.afterAll(async () => {
  await app.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

const atlas = (): Locator => page.getByTestId('realm-atlas');
const graph = (): Locator => atlas().getByTestId('atlas-connections-graph');
const node = (name: string): Locator =>
  graph().locator(`.react-flow__node[data-id="${ids.get(name) ?? ''}"]`);
const linksTable = (): Locator => atlas().getByTestId('atlas-links-list').locator('table');
const inspector = (): Locator => page.getByTestId('inspector');

async function connections(): Promise<GraphWorldConnectionsOutput> {
  return page.evaluate(async (id) => {
    const result = await window.atlas.graph.worldConnections({ worldId: id });
    if (!result.ok) throw new Error(result.error.code);
    return result.data;
  }, worldId);
}

async function placements(): Promise<PlacementSummary[]> {
  return page.evaluate(async (id) => {
    const result = await window.atlas.placement.list({ worldId: id });
    if (!result.ok) throw new Error(result.error.code);
    return result.data.placements;
  }, worldId);
}

/** Every project's saved status and revision, to prove nothing about them changed. */
async function projectStates(): Promise<Record<string, string>> {
  return page.evaluate(
    async ({ world, projects }) => {
      const out: Record<string, string> = {};
      for (const [name, id] of projects) {
        const result = await window.atlas.project.get({ worldId: world, projectId: id });
        if (!result.ok) throw new Error(result.error.code);
        out[name] = `${result.data.project.status}@${String(result.data.project.revision)}`;
      }
      return out;
    },
    { world: worldId, projects: [...ids] },
  );
}

async function nodePosition(name: string): Promise<string> {
  return (await node(name).getAttribute('style'))?.match(/translate\([^)]*\)/)?.[0] ?? '';
}

test('nodes and links come from graph.worldConnections, with a legend in words and shapes', async () => {
  const saved = await connections();
  expect(saved.nodes).toHaveLength(4);
  await expect(graph()).toHaveAttribute('data-nodes', String(saved.nodes.length));
  await expect(graph()).toHaveAttribute('data-edges', String(saved.edges.length));
  for (const n of saved.nodes) {
    await expect(graph().locator(`.react-flow__node[data-id="${n.projectId}"]`)).toHaveCount(1);
  }
  // Unplaced and archived projects are nodes too, and say so in words and shape.
  await expect(node('Notebook')).toContainText('Notebook (no building)');
  await expect(node('Notebook')).toHaveClass(/atlas-node-unplaced/);
  await expect(node('Attic')).toContainText('Attic (archived, no building)');
  await expect(node('Attic')).toHaveClass(/atlas-node-archived/);
  await expect(node('Orchard')).not.toHaveClass(/atlas-node-unplaced/);
  // One depends-on edge with a label and an arrowhead at the target.
  const edge = graph().locator('.react-flow__edge');
  await expect(edge).toHaveCount(1);
  await expect(edge).toHaveClass(/atlas-edge-depends_on/);
  await expect(graph().locator('.react-flow__edge-text')).toHaveText('depends on');
  expect(await edge.locator('path.react-flow__edge-path').getAttribute('marker-end')).toMatch(
    /url\(/,
  );

  await expect(atlas().getByTestId('atlas-connections-counts')).toHaveText('4 projects · 1 link');
  await expect(atlas().getByTestId('atlas-connections-truncated')).toHaveCount(0);
  const legend = atlas().getByTestId('atlas-connections-legend');
  await expect(legend).toContainText('Arrows point from the source project to the target project');
  await expect(legend).toContainText('depends on (solid line)');
  await expect(legend).toContainText('supports (dashed line)');
  await expect(legend).toContainText('references (dotted line)');
  await expect(legend).toContainText('Dashed border: archived project');
});

test('the keyboard list shows source, relation, target and origin, and selects by keyboard', async () => {
  const headers = linksTable().locator('thead th');
  await expect(headers).toHaveText(['Source', 'Relation', 'Target', 'Origin', 'Actions']);
  const row = linksTable().locator('tbody tr');
  await expect(row).toHaveCount(1);
  await expect(row.locator('td')).toHaveText([
    'Orchard',
    'depends on →',
    'Harbour',
    'made by you',
    'Remove',
  ]);

  const before = await projectStates();
  await row.getByRole('button', { name: 'Harbour', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(row.getByRole('button', { name: 'Harbour', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(inspector()).toContainText('Harbour');
  await expect(node('Harbour')).toHaveClass(/selected/);
  expect(await projectStates()).toEqual(before);
});

test('selection is shared with the world and the Map, and selecting starts nothing', async () => {
  const before = await projectStates();
  const linksBefore = await connections();
  await node('Orchard').click();
  await expect(node('Orchard')).toHaveClass(/selected/);
  await expect(inspector()).toContainText('Orchard');

  await atlas().getByRole('tab', { name: 'Map' }).click();
  const orchardOnMap = atlas().locator(`polygon[data-project-id="${ids.get('Orchard') ?? ''}"]`);
  await expect(orchardOnMap).toHaveAttribute('data-selected', 'true');
  // Selecting on the Map shows in the graph.
  await atlas()
    .locator(`polygon[data-project-id="${ids.get('Harbour') ?? ''}"]`)
    .click();
  await atlas().getByRole('tab', { name: 'Connections' }).click();
  await expect(node('Harbour')).toHaveClass(/selected/);
  await expect(node('Orchard')).not.toHaveClass(/selected/);

  // Unplaced projects can be selected too; nothing was saved by any of this.
  await node('Notebook').click();
  await expect(inspector()).toContainText('Notebook');
  expect(await projectStates()).toEqual(before);
  expect(await connections()).toEqual(linksBefore);
});

test('create a link through the form, then remove it after a confirmation that keeps both projects', async () => {
  const form = atlas().getByTestId('atlas-link-form');
  await form.getByTestId('atlas-link-source').selectOption({ label: 'Notebook (no building)' });
  await form.getByTestId('atlas-link-type').selectOption({ label: 'references' });
  await form.getByTestId('atlas-link-target').selectOption({ label: 'Orchard' });
  await form.getByTestId('atlas-link-create').click();
  await expect(atlas().getByTestId('atlas-link-result')).toHaveText(
    'Linked: Notebook references Orchard.',
  );
  await expect(linksTable().locator('tbody tr')).toHaveCount(2);
  await expect(graph().locator('.react-flow__edge.atlas-edge-references')).toHaveCount(1);
  const saved = await connections();
  const link = saved.edges.find((e) => e.type === 'references');
  expect(link).toMatchObject({
    sourceProjectId: ids.get('Notebook'),
    targetProjectId: ids.get('Orchard'),
    origin: 'user',
  });

  // A duplicate is refused with a plain message, and nothing is added.
  await form.getByTestId('atlas-link-source').selectOption({ label: 'Notebook (no building)' });
  await form.getByTestId('atlas-link-type').selectOption({ label: 'references' });
  await form.getByTestId('atlas-link-target').selectOption({ label: 'Orchard' });
  await form.getByTestId('atlas-link-create').click();
  await expect(atlas().getByTestId('atlas-link-result')).toHaveText(
    'Could not link: Those projects already have that link.',
  );
  expect((await connections()).edges).toHaveLength(2);

  // Remove: the dialog says only the link goes.
  const before = await projectStates();
  const buildingsBefore = await placements();
  await linksTable()
    .getByRole('button', { name: 'Remove link: Notebook references Orchard' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Remove this link?' });
  await expect(dialog).toContainText('The link "Notebook references Orchard" is removed.');
  await expect(dialog).toContainText('Notebook and Orchard are not changed, archived or deleted.');
  await expect(dialog).toContainText('Their buildings, hotbar pins, files and other links stay');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Remove link' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(atlas().getByTestId('atlas-link-result')).toHaveText(
    'Removed the link: Notebook references Orchard. Both projects are unchanged.',
  );
  await expect(linksTable().locator('tbody tr')).toHaveCount(1);
  const after = await connections();
  expect(after.edges.map((e) => e.type)).toEqual(['depends_on']);
  expect(after.nodes).toHaveLength(4);
  expect(await projectStates()).toEqual(before);
  expect(await placements()).toEqual(buildingsBefore);
});

test('dragging a graph node leaves every building where it was; Reset layout restores the ring', async () => {
  const buildingsBefore = await placements();
  const start = await nodePosition('Orchard');
  // The side column scrolls; bring the graph into view so the mouse reaches the node.
  await graph().scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  const box = await node('Orchard').boundingBox();
  if (box === null) throw new Error('Orchard node not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => nodePosition('Orchard')).not.toBe(start);
  expect(await placements()).toEqual(buildingsBefore);

  await atlas().getByTestId('atlas-reset-layout').click();
  await expect.poll(() => nodePosition('Orchard')).toBe(start);
  expect(await placements()).toEqual(buildingsBefore);
});

test('reduced motion switches the layout animation off', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(graph()).toHaveAttribute('data-layout-animation', 'off');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(graph()).toHaveAttribute('data-layout-animation', 'on');
});

test('a world with more than 150 projects shows how much was left out', async () => {
  // Runs last: it adds 147 more projects (151 in all; the graph keeps 150).
  await page.evaluate(async (world) => {
    for (let i = 0; i < 147; i++) {
      const result = await window.atlas.project.create({
        worldId: world,
        templateId: 'builtin.generic',
        templateVersion: '1.0.0',
        name: `Extra ${String(i + 1).padStart(3, '0')}`,
      });
      if (!result.ok) throw new Error(result.error.code);
    }
  }, worldId);
  await page.reload();
  await expect(graph()).toHaveAttribute('data-nodes', '150');
  const saved = await connections();
  expect(saved.omittedNodes).toBe(1);
  await expect(atlas().getByTestId('atlas-connections-counts')).toContainText(
    '151 projects · 1 link',
  );
  await expect(atlas().getByTestId('atlas-connections-truncated')).toContainText(
    `1 project and ${String(saved.omittedEdges)} links left out`,
  );
  await expect(atlas().getByTestId('atlas-link-form')).toContainText(
    '1 more project is not in the graph',
  );
});
