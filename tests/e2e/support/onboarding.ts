// Gets a fresh install past first launch (M1-9) to the M0 spike panels, for specs that test
// those panels rather than onboarding. The onboarding UI itself is covered by onboarding.spec.ts.
import { expect, type Page } from '@playwright/test';

/**
 * Makes sure the active profile has a world, so the app shows its main screen. A fresh profile
 * gets one through the preload API (the same command the UI uses), then the page reloads.
 */
export async function finishOnboarding(page: Page): Promise<void> {
  const main = page.locator('main[data-screen="main"]');
  await expect(
    page.locator('main[data-screen="onboarding"], main[data-screen="main"]'),
  ).toBeVisible();
  if (await main.isVisible()) return;
  const created = await page.evaluate(() => window.atlas.world.create({ name: 'Test World' }));
  if (!created.ok) throw new Error(`world.create failed: ${created.error.code}`);
  await page.reload();
  await expect(main).toBeVisible();
}

/** Finishes onboarding if needed and expands the "Developer spikes" section. */
export async function openDeveloperSpikes(page: Page): Promise<void> {
  await finishOnboarding(page);
  const spikes = page.locator('details.developer-spikes');
  if ((await spikes.getAttribute('open')) === null) {
    await spikes.locator('summary').click();
  }
  await expect(spikes).toHaveAttribute('open', '');
  // Pixel and pointer tests use window coordinates, so put the panels where the M0 world used
  // to be: at the top of the window.
  await spikes.evaluate((element) => {
    element.scrollIntoView({ block: 'start' });
  });
}
