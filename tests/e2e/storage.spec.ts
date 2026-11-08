import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { _electron as electron, expect, test } from '@playwright/test';

// The real built app, started twice against a throwaway userData folder: the database must
// be created under userData, migrated, and still hold the first run's record on the second.
let userDataDir: string;

test.beforeAll(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'atlas-e2e-userdata-'));
});

test.afterAll(() => {
  rmSync(userDataDir, { recursive: true, force: true });
});

const cleanEnv = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== 'ELECTRON_RENDERER_URL',
    ),
  );

/** Starts the app, waits for its window, returns what userData resolved to, then quits. */
async function launchOnce(): Promise<string> {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: cleanEnv(),
  });
  try {
    await app.firstWindow();
    return await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
  } finally {
    await app.close();
  }
}

test('the database lives under userData and its records survive a restart', async () => {
  expect(await launchOnce()).toBe(userDataDir);
  await launchOnce();

  // Read the file the app wrote, after it has quit (read-only: the test never changes it).
  const db = new DatabaseSync(join(userDataDir, 'profiles', 'default', 'app.sqlite'), {
    readOnly: true,
  });
  try {
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
    expect(db.prepare("SELECT value FROM app_meta WHERE key = 'launch_count'").get()).toEqual({
      value: '2',
    });
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }]);
  } finally {
    db.close();
  }
});
