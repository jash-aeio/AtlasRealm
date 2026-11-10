// PreToolUse(Bash): blocks git/shell commands that bypass the branch + PR workflow or destroy work.
// See docs/process/GIT_WORKFLOW.md "Safety rails".
import { resolve } from 'node:path';

import { readInput, git, block } from './lib.mjs';

const input = await readInput();
const cmd = String(input?.tool_input?.command ?? '');
const sessionCwd = input?.cwd || process.cwd();

// Examine each chained sub-command separately (&&, ||, ;, |, newlines).
const parts = cmd
  .split(/&&|\|\||;|\||\n/)
  .map((s) => s.trim())
  .filter(Boolean);

/** Git Bash writes D:\x as /d/x; Node on Windows needs D:/x. Quotes are stripped. */
function nativePath(raw) {
  const path = raw.replace(/^["']|["']$/g, '');
  const drive = process.platform === 'win32' && path.match(/^\/([a-zA-Z])(\/.*)?$/);
  return drive ? `${drive[1].toUpperCase()}:${drive[2] ?? '/'}` : path;
}

/**
 * The repository a sub-command really acts on. A `git worktree` lane runs commands like
 * `cd ../AtlasRealm-m0-8 && git commit`, so the branch must be read there, not in the session
 * folder. If that folder isn't a git checkout, fall back to the session folder (the old,
 * stricter behaviour), so a bad path can never switch the checks off.
 */
function repoDir(dir) {
  return git('rev-parse --git-dir', dir) === null ? sessionCwd : dir;
}

/** Matches `git <sub>` also when global options come first, e.g. `git -C dir commit`. */
const GIT_SUB = (sub) =>
  new RegExp(String.raw`\bgit\s+(?:-C\s+(?:"[^"]+"|'[^']+'|\S+)\s+|-c\s+\S+\s+)*${sub}\b`);

let dir = sessionCwd;
for (const p of parts) {
  const cd = p.match(/^cd\s+("[^"]+"|'[^']+'|\S+)$/);
  if (cd) {
    dir = resolve(dir, nativePath(cd[1]));
    continue;
  }
  const gitC = p.match(/\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/);
  const cwd = repoDir(gitC ? resolve(dir, nativePath(gitC[1])) : dir);

  const currentBranch = () => git('rev-parse --abbrev-ref HEAD', cwd);
  const repoHasCommits = () => git('rev-parse --verify HEAD', cwd) !== null;
  const remoteHasMain = () => {
    const out = git('ls-remote --heads origin main master', cwd);
    return out === null || out.length > 0; // unknown → assume it exists (safer)
  };

  if (/\bgit\b/.test(p) && /--no-verify\b/.test(p)) {
    block(
      '`--no-verify` skips git hooks. Fix the failing check instead, or ask the user to run it deliberately.',
    );
  }

  if (GIT_SUB('push').test(p)) {
    if (/(\s|^)(--force|-f)(\s|$)/.test(p) || /\s\+\S+/.test(p)) {
      block(
        'Force-push rewrites shared history. Use `--force-with-lease` on your own feature branch only, and only if the user agrees.',
      );
    }
    const explicitMain = /(\s|:)(main|master)(\s|$)/.test(p);
    const implicitMain =
      !/\s(origin|upstream)\s+\S+/.test(p) && ['main', 'master'].includes(currentBranch());
    if ((explicitMain || implicitMain) && remoteHasMain()) {
      block(
        'Direct pushes to main are not allowed. Push a feature branch and open a PR (`/ship`).',
      );
    }
  }

  if (
    GIT_SUB('commit').test(p) &&
    ['main', 'master'].includes(currentBranch()) &&
    repoHasCommits()
  ) {
    block(
      'You are on main. Create a branch first: `git switch -c feat/<issue#>-<slug>` (or use `/start-task`).',
    );
  }

  if (
    /\bgit\s+reset\s+--hard\b/.test(p) ||
    /\bgit\s+clean\s+-[a-z]*f/.test(p) ||
    /\bgit\s+checkout\s+--\s+\./.test(p)
  ) {
    block(
      'This discards uncommitted work permanently. Ask the user first; they can run it themselves if intended.',
    );
  }

  const rm = p.match(/\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*)\s+(.+)/);
  if (rm) {
    const targets = rm[2].split(/\s+/).filter((t) => !t.startsWith('-'));
    const safe =
      /^(\.\/)?(node_modules|dist|out|build|release|coverage|\.vite|playwright-report|test-results|resources\/assets\/_staging)(\/.*)?$/;
    const unsafe = targets.filter((t) => !safe.test(t.replace(/["']/g, '')));
    if (unsafe.length) {
      block(
        `Recursive delete of ${unsafe.join(', ')} is not allowed automatically. Only build/cache folders may be removed. Ask the user.`,
      );
    }
  }
}

process.exit(0);
