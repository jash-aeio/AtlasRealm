import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';

// M1-9 (#36): first launch reaches a usable, empty world with no account and no network
// (PRD §5.1). The avatar step is skippable and editable later; switching profiles is shown but
// disabled until M1-8.

interface Launched {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly consoleErrors: string[];
}

const cleanEnv = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== 'ELECTRON_RENDERER_URL',
    ),
  );

async function launch(userDataDir: string): Promise<Launched> {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: cleanEnv(),
  });
  const page = await app.firstWindow();
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.waitForLoadState('domcontentloaded');
  return { app, page, consoleErrors };
}

const screen = (page: Page, name: string): Locator => page.locator(`main[data-screen="${name}"]`);

/** Presses Tab until `target` has focus: proves it is reachable by keyboard alone. */
async function tabTo(page: Page, target: Locator, maxPresses = 40): Promise<void> {
  for (let i = 0; i < maxPresses; i++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`could not reach ${target.toString()} with Tab`);
}

let userDataDir: string;

test.beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'atlas-e2e-onboarding-'));
});

test.afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true });
});

test('first launch works offline and by keyboard alone, and the world survives a restart', async () => {
  const first = await launch(userDataDir);
  const { app, page } = first;
  try {
    // Take the network away and record any attempt to reach it, then start over.
    await app.evaluate(({ session }) => {
      const attempts: string[] = [];
      (globalThis as unknown as { __netAttempts: string[] }).__netAttempts = attempts;
      session.defaultSession.enableNetworkEmulation({ offline: true });
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
        (details, callback) => {
          attempts.push(details.url);
          callback({ cancel: true });
        },
      );
    });
    await page.reload();

    // Step 1: the local profile. The step heading takes focus.
    await expect(screen(page, 'onboarding')).toBeVisible();
    await expect(page.getByText('Step 1 of 3: Profile')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Who is using Atlas Realm?' })).toBeFocused();
    await expect(page.getByText('No account or internet connection is needed.')).toBeVisible();
    const continueButton = page.getByRole('button', { name: 'Continue as Default' });
    await tabTo(page, continueButton);
    await page.keyboard.press('Enter');

    // Step 2: the avatar is optional.
    await expect(page.getByRole('heading', { name: 'Choose an avatar (optional)' })).toBeFocused();
    await expect(
      page.getByText('Placeholder avatar: the final character art comes later.'),
    ).toBeVisible();
    await tabTo(page, page.getByRole('button', { name: 'Skip' }));
    await page.keyboard.press('Enter');

    // Step 3: the world.
    await expect(page.getByRole('heading', { name: 'Create your world' })).toBeFocused();
    const worldName = page.getByLabel('World name');
    await tabTo(page, worldName);
    await page.keyboard.type('Hearth');
    await expect(page.getByLabel('Theme')).toHaveValue('meadow');
    await page.keyboard.press('Enter'); // submits the form

    // The usable, empty world.
    await expect(screen(page, 'main')).toBeVisible();
    await expect(page.getByTestId('world-name')).toHaveText('Hearth');
    await expect(page.getByTestId('world-empty-state')).toHaveText(
      'No projects in this world yet. Create one to get started.',
    );
    await expect(page.getByRole('button', { name: 'Create project' })).toBeDisabled();
    await expect(
      page.getByText('The project form arrives with the next update (M1-10).'),
    ).toBeVisible();
    // The M0 spikes stay collapsed and labelled as mock.
    const spikes = page.locator('details.developer-spikes');
    await expect(spikes).not.toHaveAttribute('open', '');
    await expect(spikes.locator('summary')).toHaveText(
      'Developer spikes (M0 mock data, not your projects)',
    );
    await expect(page.getByTestId('world')).toHaveCount(0); // not mounted while closed

    // Skipping saved nothing: the profile still has no avatar.
    const settings = await page.evaluate(() => window.atlas.profile.settings.get());
    expect(settings.ok && settings.data.settings.avatarColour).toBeNull();

    const attempts = await app.evaluate(
      () => (globalThis as unknown as { __netAttempts: string[] }).__netAttempts,
    );
    expect(attempts).toEqual([]);
    expect(first.consoleErrors).toEqual([]);
  } finally {
    await app.close();
  }

  // The next start goes straight to the world: onboarding doesn't come back.
  const second = await launch(userDataDir);
  try {
    await expect(screen(second.page, 'main')).toBeVisible();
    await expect(second.page.getByTestId('world-name')).toHaveText('Hearth');
  } finally {
    await second.app.close();
  }
});

test('an avatar chosen during onboarding can be changed and removed in Settings', async () => {
  const { app, page } = await launch(userDataDir);
  try {
    await page.getByRole('button', { name: 'Continue as Default' }).click();
    await page.getByLabel('Clay red').check();
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await page.getByLabel('World name').fill('Hearth');
    await page.getByRole('button', { name: 'Create world' }).click();

    await expect(screen(page, 'main')).toBeVisible();
    await expect(page.locator('.profile-chip').getByRole('img')).toHaveAccessibleName(
      'Placeholder avatar',
    );

    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByTestId('avatar-current')).toHaveText('Current: Clay red.');
    await expect(page.getByLabel('Clay red')).toBeChecked();

    await page.getByLabel('Arcane blue').check();
    await page.getByRole('button', { name: 'Save avatar' }).click();
    await expect(page.getByTestId('avatar-current')).toHaveText('Current: Arcane blue.');
    const saved = await page.evaluate(() => window.atlas.profile.settings.get());
    expect(saved.ok && saved.data.settings).toMatchObject({
      avatarPreset: 'default',
      avatarColour: '#6bc6f2',
    });

    await page.getByRole('button', { name: 'Remove avatar' }).click();
    await expect(page.getByTestId('avatar-current')).toHaveText('No avatar chosen.');
    await expect(page.locator('.profile-chip').getByRole('img')).toHaveAccessibleName(
      'No avatar chosen',
    );
    const cleared = await page.evaluate(() => window.atlas.profile.settings.get());
    expect(cleared.ok && cleared.data.settings).toMatchObject({
      avatarPreset: null,
      avatarColour: null,
    });

    // The world can be renamed later, keeping its ID.
    const before = await page.evaluate(() => window.atlas.world.list());
    await page.getByLabel('World name').fill('Lantern Hollow');
    await page.getByRole('button', { name: 'Rename world' }).click();
    await expect(page.getByText('Renamed to “Lantern Hollow”.')).toBeVisible();
    await page.getByRole('button', { name: 'Back to world' }).click();
    await expect(page.getByTestId('world-name')).toHaveText('Lantern Hollow');
    const after = await page.evaluate(() => window.atlas.world.list());
    expect(after.ok && after.data.worlds.map((w) => w.id)).toEqual(
      before.ok && before.data.worlds.map((w) => w.id),
    );
  } finally {
    await app.close();
  }
});

test('the profile picker lists, creates and renames profiles; switching waits for M1-8', async () => {
  const { app, page } = await launch(userDataDir);
  try {
    await expect(screen(page, 'onboarding')).toBeVisible();
    const list = page.getByRole('list', { name: 'Profiles on this computer' });
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list.getByRole('listitem').first()).toContainText('Default');
    await expect(list.getByRole('listitem').first()).toContainText('Active');

    // Create a second profile. It's listed, but can't be switched to yet.
    await page.getByLabel('New profile name').fill('Second');
    await page.getByRole('button', { name: 'Create profile' }).click();
    await expect(page.getByRole('status')).toHaveText(
      'Created “Second”. You can switch to it once profile switching arrives (M1-8).',
    );
    const second = list.getByRole('listitem').filter({ hasText: 'Second' });
    await expect(second.getByRole('button', { name: 'Switch' })).toBeDisabled();
    await expect(page.getByText('Switching profiles arrives with M1-8.')).toBeVisible();

    // Rename the active profile; the continue button follows the saved name.
    await page.getByLabel('Active profile name').fill('Robin');
    await page.getByRole('button', { name: 'Rename profile' }).click();
    await expect(page.getByRole('button', { name: 'Continue as Robin' })).toBeVisible();

    // Clear messages for bad names, before or after asking the main process.
    await page.getByLabel('New profile name').fill('robin');
    await page.getByRole('button', { name: 'Create profile' }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'A profile with that name already exists. Pick another name.',
    );
    await page.getByLabel('New profile name').fill('   ');
    await page.getByRole('button', { name: 'Create profile' }).click();
    await expect(page.getByRole('alert')).toHaveText('Enter a name.');
    await expect(page.getByLabel('New profile name')).toHaveAttribute('aria-invalid', 'true');

    const profiles = await page.evaluate(() => window.atlas.profile.list());
    expect(profiles.ok && profiles.data.profiles.map((p) => [p.displayName, p.isActive])).toEqual([
      ['Robin', true],
      ['Second', false],
    ]);
  } finally {
    await app.close();
  }
});
