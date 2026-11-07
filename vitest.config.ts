import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Domain and integration tests run in plain Node. Renderer/DOM and Electron E2E
    // tests get their own setup when they arrive (M0-2).
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Each test file starts with a fresh module graph, so state can't leak between files.
    isolate: true,
  },
});
