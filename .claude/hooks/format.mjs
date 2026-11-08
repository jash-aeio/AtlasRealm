// PostToolUse(Edit|Write|MultiEdit): formats the edited file with the project's Prettier/ESLint.
// Does nothing until M0-1 installs them, so it's safe to enable early.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readInput } from './lib.mjs';

const input = await readInput();
const root = process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd();
const file = input?.tool_input?.file_path;
if (!file || !/\.(ts|tsx|js|jsx|mjs|cjs|json|css)$/.test(file) || !fs.existsSync(file))
  process.exit(0);
if (/[\\/](node_modules|docs[\\/]archive)[\\/]/.test(file)) process.exit(0);

const bin = (name) => {
  const p = path.join(
    root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${name}.cmd` : name,
  );
  return fs.existsSync(p) ? p : null;
};

const run = (exe, args) => {
  try {
    execFileSync(exe, args, {
      cwd: root,
      stdio: 'ignore',
      shell: process.platform === 'win32',
      timeout: 30000,
    });
  } catch {
    // Lint errors are reported by `lint`/CI; formatting must never block an edit.
  }
};

const prettier = bin('prettier');
if (prettier) run(prettier, ['--write', file]);
const eslint = bin('eslint');
if (eslint && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) run(eslint, ['--fix', file]);

process.exit(0);
