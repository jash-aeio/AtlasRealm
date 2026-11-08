import { defineConfig } from '@playwright/test';

// End-to-end tests launch the real built app (run `pnpm test:e2e`, which builds first).
// Vitest only picks up *.test.ts, Playwright only *.spec.ts, so they don't overlap.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  // One Electron instance at a time: they would share the same userData folder.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  timeout: 30_000,
  reporter: process.env['CI'] ? [['list'], ['github']] : 'list',
  use: {
    trace: 'retain-on-failure',
  },
});
