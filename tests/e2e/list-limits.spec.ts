// #61 in the real built app: a profile restored, imported or edited by hand can hold more
// profiles or worlds than the app lists (50 / 100). Before the fix the app opened on an error
// screen. Now it opens normally, lists up to the limit, says plainly what isn't shown, and
// nothing is deleted.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { _electron as electron, type ElectronApplication, expect, test } from '@playwright/test';

import { MAX_PROFILES } from '../../src/common/contracts/profile';
import { MAX_WORLDS } from '../../src/common/contracts/world';
import { openDatabase } from '../../src/main/storage/database';
import { WorldRepository } from '../../src/main/storage/repositories/world-repository';
import { onboardThroughUi, screen } from './support/m1-ui';
import { requireDatabaseFile } from './support/profile-data';

let userDataDir: string;
let app: ElectronApplication | undefined;

const cleanEnv = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== 'ELECTRON_RENDERER_URL',
    ),
  );

async function launch(): Promise<ElectronApplication> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], env: cleanEnv() });
  return app;
}

test.beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'atlas-e2e-limits-'));
});

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(userDataDir, { recursive: true, force: true });
});

interface IndexFile {
  profiles: { id: string; displayName: string }[];
  [key: string]: unknown;
}

/** What a restore or hand edit would leave: extra profiles in the index, extra worlds in the DB. */
function seedPastTheLimits(): { indexText: string } {
  const indexPath = join(userDataDir, 'profiles-index.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as IndexFile;
  for (let i = 1; i <= MAX_PROFILES; i++) {
    index.profiles.push({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      displayName: `Restored ${String(i)}`,
    });
  }
  const indexText = `${JSON.stringify(index, null, 2)}\n`;
  writeFileSync(indexPath, indexText);

  // Through the app's own repository, so every database rule still holds; only the
  // world.create limit (an IPC-level rule) is bypassed, as a restored file would.
  const db = openDatabase(requireDatabaseFile(userDataDir));
  try {
    const worlds = new WorldRepository(db);
    for (let i = 1; i <= MAX_WORLDS; i++) {
      worlds.create({ name: `Restored world ${String(i)}`, themeId: 'meadow' });
    }
  } finally {
    db.close();
  }
  return { indexText };
}

test('opens normally with more profiles and worlds than it lists, and deletes nothing', async () => {
  // A normal first launch: one profile, one world.
  const first = await launch();
  await onboardThroughUi(await first.firstWindow(), 'Default', 'Home');
  await first.close();
  app = undefined;

  const { indexText } = seedPastTheLimits();

  const second = await launch();
  const page = await second.firstWindow();
  // The main screen, not an error screen.
  await expect(screen(page, 'main')).toBeVisible();
  await expect(page.getByTestId('worlds-omitted')).toHaveText(
    `Showing ${String(MAX_WORLDS)} of ${String(MAX_WORLDS + 1)} worlds. ` +
      'The other one is kept in this profile; nothing was deleted.',
  );

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByTestId('profiles-omitted')).toHaveText(
    `Showing ${String(MAX_PROFILES)} of ${String(MAX_PROFILES + 1)} profiles. ` +
      'The other one is kept on this computer; nothing was deleted.',
  );
  // The active profile is still listed and marked.
  await expect(page.getByRole('list', { name: 'Profiles on this computer' })).toContainText(
    'Active',
  );

  // Nothing was deleted: the index is byte-for-byte what was written, and every world is there.
  await second.close();
  app = undefined;
  expect(readFileSync(join(userDataDir, 'profiles-index.json'), 'utf8')).toBe(indexText);
  const db = openDatabase(requireDatabaseFile(userDataDir));
  try {
    expect(new WorldRepository(db).list({ includeArchived: true })).toHaveLength(MAX_WORLDS + 1);
  } finally {
    db.close();
  }
});
