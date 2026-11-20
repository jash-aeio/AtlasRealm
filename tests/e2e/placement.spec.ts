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

// M2-3 (#68): the placement commands through the real preload and built main process. Place,
// list, move and remove a building; a forged overlap and a smuggled footprint are refused;
// archiving the project removes its building and the project stays readable. No UI yet: the
// world view draws buildings in M2-6.

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
