// PreToolUse(Bash): blocks git/shell commands that bypass the branch + PR workflow or destroy work.
// See docs/process/GIT_WORKFLOW.md "Safety rails".
import { readInput, git, block } from './lib.mjs';

const input = await readInput();
const cmd = String(input?.tool_input?.command ?? '');
const cwd = input?.cwd || process.cwd();

// Examine each chained sub-command separately (&&, ||, ;, |, newlines).
const parts = cmd.split(/&&|\|\||;|\||\n/).map((s) => s.trim()).filter(Boolean);

const currentBranch = () => git('rev-parse --abbrev-ref HEAD', cwd);
const repoHasCommits = () => git('rev-parse --verify HEAD', cwd) !== null;
const remoteHasMain = () => {
  const out = git('ls-remote --heads origin main master', cwd);
  return out === null || out.length > 0; // unknown → assume it exists (safer)
};

for (const p of parts) {
  if (/\bgit\b/.test(p) && /--no-verify\b/.test(p)) {
    block('`--no-verify` skips git hooks. Fix the failing check instead, or ask the user to run it deliberately.');
  }

  if (/\bgit\s+push\b/.test(p)) {
    if (/(\s|^)(--force|-f)(\s|$)/.test(p) || /\s\+\S+/.test(p)) {
      block('Force-push rewrites shared history. Use `--force-with-lease` on your own feature branch only, and only if the user agrees.');
    }
    const explicitMain = /(\s|:)(main|master)(\s|$)/.test(p);
    const implicitMain = !/\s(origin|upstream)\s+\S+/.test(p) && ['main', 'master'].includes(currentBranch());
    if ((explicitMain || implicitMain) && remoteHasMain()) {
      block('Direct pushes to main are not allowed. Push a feature branch and open a PR (`/ship`).');
    }
  }

  if (/\bgit\s+commit\b/.test(p) && ['main', 'master'].includes(currentBranch()) && repoHasCommits()) {
    block('You are on main. Create a branch first: `git switch -c feat/<issue#>-<slug>` (or use `/start-task`).');
  }

  if (/\bgit\s+reset\s+--hard\b/.test(p) || /\bgit\s+clean\s+-[a-z]*f/.test(p) || /\bgit\s+checkout\s+--\s+\./.test(p)) {
    block('This discards uncommitted work permanently. Ask the user first; they can run it themselves if intended.');
  }

  const rm = p.match(/\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*)\s+(.+)/);
  if (rm) {
    const targets = rm[2].split(/\s+/).filter((t) => !t.startsWith('-'));
    const safe = /^(\.\/)?(node_modules|dist|out|build|release|coverage|\.vite|playwright-report|test-results|resources\/assets\/_staging)(\/.*)?$/;
    const unsafe = targets.filter((t) => !safe.test(t.replace(/["']/g, '')));
    if (unsafe.length) {
      block(`Recursive delete of ${unsafe.join(', ')} is not allowed automatically. Only build/cache folders may be removed. Ask the user.`);
    }
  }
}

process.exit(0);
