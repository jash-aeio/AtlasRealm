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
    // Plain JS files (configs, Claude hooks) aren't type-checked, so drop the type-aware rules.
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  // Must be last: turns off stylistic rules that would fight with Prettier.
  prettier,
);
