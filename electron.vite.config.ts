import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

import { CSP_PLACEHOLDER, DEVELOPMENT_CSP, PRODUCTION_CSP } from './src/common/security/csp';

/** Writes the right Content Security Policy into index.html for dev vs build. */
function contentSecurityPolicy(): Plugin {
  let csp = PRODUCTION_CSP;
  return {
    name: 'atlas:csp',
    configResolved(config) {
      csp = config.command === 'serve' ? DEVELOPMENT_CSP : PRODUCTION_CSP;
    },
    transformIndexHtml(html) {
      if (!html.includes(CSP_PLACEHOLDER)) {
        throw new Error(`index.html is missing the ${CSP_PLACEHOLDER} placeholder`);
      }
      return html.replace(CSP_PLACEHOLDER, csp);
    },
  };
}

// One build per Electron process (ADR-0009). Entries follow electron-vite's defaults:
// src/main/index.ts, src/preload/index.ts, src/renderer/index.html → out/<process>/.
// Every build bundles its libraries, so the packaged app ships out/ and no node_modules (#10).
// That's why all packages are devDependencies: none are needed at runtime.
export default defineConfig({
  main: {
    // Bundle zod etc. into out/main. Node built-ins (node:sqlite) and electron stay external.
    build: { externalizeDeps: false },
  },
  preload: {
    build: {
      // A sandboxed preload can't load ES modules or files from node_modules, so emit
      // one self-contained CommonJS file (package.json "type": "module" would pick ESM).
      externalizeDeps: false,
      rolldownOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    plugins: [react(), contentSecurityPolicy()],
    // Minify the UI bundle (electron-vite leaves it readable by default). Main and preload stay
    // unminified so stack traces in local logs remain readable.
    build: { minify: true },
  },
});
