// Runs electron-builder (used by `pnpm package`, #10). Node runs this file directly (type stripping).
//
// Why a wrapper: electron-builder finds runtime dependencies by running `pnpm list`, looked up
// on PATH. With pnpm installed only through corepack and no `corepack enable` (it needs admin
// rights when Node lives in a protected folder), there is no `pnpm` on PATH and packaging fails.
// In that case we create corepack's pnpm shims in a temporary folder and put that folder on
// PATH for the electron-builder process only. Nothing on the machine is changed.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const builderCli = require.resolve('electron-builder/cli.js');
const isWindows = process.platform === 'win32';

function pnpmOnPath(): boolean {
  // `where`/`which` exit with 0 only when the command resolves.
  return spawnSync(isWindows ? 'where' : 'which', ['pnpm'], { stdio: 'ignore' }).status === 0;
}

let shimDir: string | undefined;
const env = { ...process.env };
if (!pnpmOnPath()) {
  shimDir = mkdtempSync(join(tmpdir(), 'atlas-pnpm-shim-'));
  // Run corepack's JS entry with this Node directly: no shell, so a temp path with spaces or
  // shell characters (the Windows user name is in %TEMP%) stays one safe argument.
  const corepackJs = join(
    dirname(process.execPath),
    'node_modules',
    'corepack',
    'dist',
    'corepack.js',
  );
  const enabled = spawnSync(
    process.execPath,
    [corepackJs, 'enable', 'pnpm', '--install-directory', shimDir],
    { stdio: 'inherit' },
  );
  if (enabled.status !== 0) {
    console.error('[package] pnpm is not on PATH and corepack could not create a shim.');
    rmSync(shimDir, { recursive: true, force: true });
    process.exit(1);
  }
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = `${shimDir}${delimiter}${env[pathKey] ?? ''}`;
  console.info('[package] pnpm not on PATH: using temporary corepack shims for electron-builder');
}

function runBuilder(): number {
  try {
    const args = [builderCli, ...process.argv.slice(2)];
    return spawnSync(process.execPath, args, { stdio: 'inherit', env }).status ?? 1;
  } finally {
    // Remove the temporary shims even if spawning throws.
    if (shimDir !== undefined) rmSync(shimDir, { recursive: true, force: true });
  }
}

process.exit(runBuilder());
