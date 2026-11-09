// @ts-check
// ESLint "flat config": an array of config objects applied in order (later ones win).
import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    // Replaces the old .eslintignore file. docs/ holds no code; build output is generated.
    ignores: [
      'node_modules/',
      'dist/',
      'out/',
      'release/',
      'build/',
      'coverage/',
      'docs/',
      'test-results/',
      'playwright-report/',
    ],
  },
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: {
      globals: globals.node,
      // Type-aware linting: rules can ask the TypeScript compiler about types
      // (e.g. "is this promise awaited?"), using the nearest tsconfig.json.
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js', '.claude/hooks/*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // The renderer is a web page: browser globals only, no Node (matches tsconfig.web.json).
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Only grid-scene.ts may import Pixi: it loads 'pixi.js/unsafe-eval' first, which keeps
    // our CSP free of 'unsafe-eval' (ADR-0011). A renderer created elsewhere would fail.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/renderer/world/grid-scene.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['pixi.js', 'pixi.js/*', '@pixi/*'],
              message: 'Import Pixi only in src/renderer/world/grid-scene.ts (ADR-0011).',
            },
          ],
        },
      ],
    },
  },
  {
    // Plain JS files (configs, Claude hooks) aren't type-checked, so drop the type-aware rules.
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  // Must be last: turns off stylistic rules that would fight with Prettier.
  prettier,
);
