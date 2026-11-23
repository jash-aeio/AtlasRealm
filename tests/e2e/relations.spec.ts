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

import { finishOnboarding } from './support/onboarding';

// M2-11 (#76): project links through the real preload and built main process. Link two
// projects, refuse a duplicate and a self-link, read the bounded world graph (an unplaced
// project included), restart the app and find the link again, then remove it without touching
// either project. No UI yet: the Connections tab comes in M2-13.

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

async function launch(): Promise<void> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env: cleanEnv() });
  page = await app.firstWindow();
}

test.beforeEach(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'atlas-e2e-relations-'));
  await launch();
  await finishOnboarding(page);
});

test.afterEach(async () => {
  await app.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('link, refuse, read, survive a restart and remove through window.atlas', async () => {
  const created = await page.evaluate(async () => {
    const must = <T>(result: { ok: true; data: T } | { ok: false; error: { code: string } }): T => {
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
    const a = await newProject('Event');
    const b = await newProject('Campaign');
    const input = {
      worldId,
      sourceProjectId: a.id,
      targetProjectId: b.id,
      type: 'supports' as const,
    };
    const relation = must(await window.atlas.relation.create(input)).relation;
    const duplicate = await window.atlas.relation.create(input);
    const self = await window.atlas.relation.create({ ...input, targetProjectId: a.id });
    const graph = must(await window.atlas.graph.worldConnections({ worldId }));
    return { worldId, relation, duplicate, self, graph };
  });

  expect(created.relation).toMatchObject({ type: 'supports', origin: 'user', revision: 1 });
  expect(created.duplicate).toMatchObject({ ok: false, error: { code: 'already_exists' } });
  expect(created.self).toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
  expect(created.graph).toMatchObject({
    edges: [created.relation],
    totalNodes: 2,
    totalEdges: 1,
    omittedNodes: 0,
    omittedEdges: 0,
  });
  // Both have one link and may share a creation millisecond, so their order is not asserted.
  expect(created.graph.nodes.map((n) => [n.name, n.placed]).sort()).toEqual([
    ['Campaign', false],
    ['Event', false],
  ]);

  await app.close();
  await launch();

  const afterRestart = await page.evaluate(
    async ({ worldId, relationId }) => {
      const before = await window.atlas.graph.worldConnections({ worldId });
      const removed = await window.atlas.relation.remove({
        worldId,
        relationId,
        expectedRevision: 1,
      });
      const after = await window.atlas.graph.worldConnections({ worldId });
      const projects = await window.atlas.project.list({ worldId, status: 'active' });
      return { before, removed, after, projects };
    },
    { worldId: created.worldId, relationId: created.relation.id },
  );

  expect(afterRestart.before).toMatchObject({ ok: true, data: { edges: [created.relation] } });
  expect(afterRestart.removed).toEqual({ ok: true, data: { relation: created.relation } });
  expect(afterRestart.after).toMatchObject({ ok: true, data: { edges: [], totalNodes: 2 } });
  expect(afterRestart.projects).toMatchObject({ ok: true });
  if (afterRestart.projects.ok) expect(afterRestart.projects.data.projects).toHaveLength(2);
});
