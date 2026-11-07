// Shared helpers for Atlas Realm Claude Code hooks.
// Hooks receive a JSON payload on stdin and signal decisions via exit codes:
//   exit 0 = allow (stdout may add context), exit 2 = block (stderr is shown to Claude).
import { execSync } from 'node:child_process';

export async function readInput() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

export function git(args, cwd) {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

export function block(reason) {
  process.stderr.write(`[Atlas Realm hook] BLOCKED: ${reason}\n`);
  process.exit(2);
}
