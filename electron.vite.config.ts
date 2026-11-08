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
export default defineConfig({
  main: {},
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
  },
});
