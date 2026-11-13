import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { _electron as electron, expect, test } from '@playwright/test';

import { requireDatabaseFile } from './support/profile-data';

// The real built app, started twice against a throwaway userData folder: the profile index and
// database must be created under userData, migrated, and still hold the first run's record on the second.
let userDataDir: string;
// The electron package's main export is the path to its executable.
const electronBinary = createRequire(import.meta.url)('electron') as string;

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

/** Starts the app, waits for its window, returns userData and the UI's launch line, then quits. */
async function launchOnce(): Promise<{ userData: string; launchText: string }> {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: cleanEnv(),
  });
  try {
    const page = await app.firstWindow();
    const launchInfo = page.getByTestId('launch-info');
    await expect(launchInfo).toContainText('Launch #');
    return {
      userData: await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData')),
      launchText: (await launchInfo.textContent()) ?? '',
    };
  } finally {
    await app.close();
  }
}

test('the database lives under userData and its records survive a restart', async () => {
  const first = await launchOnce();
  expect(first.userData).toBe(userDataDir);
  expect(first.launchText).toMatch(/^Launch #1 · .* · schema v4$/);
  // The UI shows the stored count after a restart, not just the database file.
  expect((await launchOnce()).launchText).toMatch(/^Launch #2 · .* · schema v4$/);

  // A fresh install gets one profile, "Default", with a UUID (ADR-0017); both launches used it.
  const index = JSON.parse(readFileSync(join(userDataDir, 'profiles-index.json'), 'utf8')) as {
    profiles: { id: string; displayName: string }[];
    lastUsedProfileId: string;
  };
  expect(index.profiles).toEqual([{ id: index.lastUsedProfileId, displayName: 'Default' }]);
  expect(index.lastUsedProfileId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);

  // Read the file the app wrote, after it has quit (read-only: the test never changes it).
  const db = new DatabaseSync(requireDatabaseFile(userDataDir), {
    readOnly: true,
  });
  try {
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 4 });
    expect(db.prepare("SELECT value FROM app_meta WHERE key = 'launch_count'").get()).toEqual({
      value: '2',
    });
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
    ]);
  } finally {
    db.close();
  }
});

test('a second copy of the app quits without opening the database', async () => {
  const lockDir = mkdtempSync(join(tmpdir(), 'atlas-e2e-lock-'));
  const args = ['.', `--user-data-dir=${lockDir}`];
  const first = await electron.launch({ args, env: cleanEnv() });
  try {
    await first.firstWindow();

    // Started directly, not via Playwright: the second copy should exit before any window.
    const second = spawn(electronBinary, args, { env: cleanEnv(), stdio: 'ignore' });
    const exitCode = await new Promise<number | null>((resolve) => second.on('exit', resolve));
    expect(exitCode).toBe(0);

    const count = await first.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    expect(count).toBe(1);
  } finally {
    await first.close();
  }

  const db = new DatabaseSync(requireDatabaseFile(lockDir), {
    readOnly: true,
  });
  try {
    expect(db.prepare("SELECT value FROM app_meta WHERE key = 'launch_count'").get()).toEqual({
      value: '1',
    });
  } finally {
    db.close();
    rmSync(lockDir, { recursive: true, force: true });
  }
});
