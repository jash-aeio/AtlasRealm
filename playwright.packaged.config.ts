import { defineConfig } from '@playwright/test';

// Smoke tests for the packaged Windows app (release/win-unpacked). Run `pnpm package` first,
// then `pnpm test:e2e:packaged`. Kept apart from playwright.config.ts because they need a
// fresh package (about a minute) and launch the real .exe instead of `electron .`.
export default defineConfig({
  testDir: 'tests/e2e-packaged',
  testMatch: '**/*.spec.ts',
  // The tests share one copied install and one userData folder, in order.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  timeout: 60_000,
  reporter: process.env['CI'] ? [['list'], ['github']] : 'list',
  use: {
    trace: 'retain-on-failure',
  },
});
