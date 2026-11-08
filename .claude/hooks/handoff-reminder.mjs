// Stop: non-blocking reminder when code changed but the handoff docs did not.
// Keeps docs/status/IMPLEMENTATION_STATUS.md trustworthy between sessions.
import { readInput, git } from './lib.mjs';

const input = await readInput();
if (input?.stop_hook_active) process.exit(0);
const root = process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd();

const changed = (git('status --porcelain', root) ?? '')
  .split('\n')
  .filter(Boolean)
  .map((l) => l.slice(3).trim());

const codeChanged = changed.some((f) => /^(src|resources|tests)\//.test(f));
const statusChanged = changed.some((f) => f === 'docs/status/IMPLEMENTATION_STATUS.md');
const sessionLogged = changed.some((f) => f.startsWith('docs/sessions/'));

if (codeChanged && (!statusChanged || !sessionLogged)) {
  const missing = [!statusChanged && 'IMPLEMENTATION_STATUS.md', !sessionLogged && 'a session log']
    .filter(Boolean)
    .join(' and ');
  process.stdout.write(
    JSON.stringify({
      systemMessage: `Reminder: code has uncommitted changes but ${missing} wasn't updated. Run /ship when the slice is verified.`,
    }),
  );
}
process.exit(0);
