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

// M2-4 (#69): the hotbar commands through the real preload and built main process. Pin a
// project and a service, refuse a filled slot without an explicit replace (`slot_occupied` with
// the occupant), replace with the right expected target, keep an archived project's pin, and
// clear a slot without touching the project. No UI yet: the hotbar bar comes in a later issue.

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
  userDataDir = mkdtempSync(join(tmpdir(), 'atlas-e2e-hotbar-'));
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env: cleanEnv() });
  page = await app.firstWindow();
  await finishOnboarding(page);
});

test.afterEach(async () => {
  await app.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('pin, refuse, replace, archive and clear through window.atlas.hotbar', async () => {
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
    const pinned = must(
      await window.atlas.hotbar.assign({
        worldId,
        slot: 0,
        target: { type: 'project', id: first.id },
      }),
    ).slot;
    must(
      await window.atlas.hotbar.assign({
        worldId,
        slot: 9,
        target: { type: 'service', id: 'settings' },
      }),
    );
    const occupied = await window.atlas.hotbar.assign({
      worldId,
      slot: 0,
      target: { type: 'project', id: second.id },
    });
    const wrongExpected = await window.atlas.hotbar.assign({
      worldId,
      slot: 0,
      target: { type: 'project', id: second.id },
      replace: { expectedTargetId: 'settings' },
    });
    const forged = await window.atlas.hotbar.assign({
      worldId,
      slot: 1,
      // @ts-expect-error: a forged target, as a compromised page could send.
      target: { type: 'service', id: 'bank-vault' },
    });
    const replaced = must(
      await window.atlas.hotbar.assign({
        worldId,
        slot: 0,
        target: { type: 'project', id: second.id },
        replace: { expectedTargetId: first.id },
      }),
    ).slot;
    must(
      await window.atlas.project.archive({
        worldId,
        projectId: second.id,
        expectedRevision: second.revision,
      }),
    );
    const afterArchive = must(await window.atlas.hotbar.list({ worldId })).slots;
    const cleared = must(
      await window.atlas.hotbar.clear({ worldId, slot: 0, expectedTargetId: second.id }),
    ).slot;
    const finalList = must(await window.atlas.hotbar.list({ worldId })).slots;
    const secondAfter = must(
      await window.atlas.project.get({ worldId, projectId: second.id }),
    ).project;

    return {
      pinned: { slot: pinned.slot, isFirst: pinned.target.id === first.id },
      occupied: occupied.ok ? null : occupied.error,
      occupantIsFirst: !occupied.ok && occupied.error.hotbar?.occupant.target.id === first.id,
      wrongExpected: wrongExpected.ok ? null : wrongExpected.error.code,
      forged: forged.ok ? null : forged.error.code,
      replaced: { isSecond: replaced.target.id === second.id, revision: replaced.revision },
      afterArchive: afterArchive.map((s) => [s.slot, s.projectStatus]),
      cleared: cleared.projectStatus,
      finalList: finalList.map((s) => s.target.id),
      secondAfter: { name: secondAfter.name, status: secondAfter.status },
    };
  });

  expect(outcome).toEqual({
    pinned: { slot: 0, isFirst: true },
    occupied: {
      code: 'slot_occupied',
      message: 'That hotbar slot holds something else.',
      hotbar: {
        slot: 0,
        occupant: { target: { type: 'project', id: expect.any(String) }, projectStatus: 'active' },
      },
    },
    occupantIsFirst: true,
    wrongExpected: 'slot_occupied',
    forged: 'invalid_payload',
    replaced: { isSecond: true, revision: 2 },
    afterArchive: [
      [0, 'archived'],
      [9, null],
    ],
    cleared: 'archived',
    finalList: ['settings'],
    secondAfter: { name: 'Second', status: 'archived' },
  });
});
