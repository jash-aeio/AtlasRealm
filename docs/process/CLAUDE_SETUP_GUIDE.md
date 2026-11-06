# Claude Code setup guide

Everything configured for Claude Code in this repo: what each piece does, **why it exists**, and where it lives. Read this to understand (and later change) how your AI teammate behaves.

## Where each automation belongs (the rule we follow)
| Mechanism | Strength | Use it for | Lives in |
|---|---|---|---|
| `CLAUDE.md` | Advice: usually followed | Conventions, the session loop, when to ask you | `CLAUDE.md` |
| **Hooks** | Enforced by the harness every time | Must-always / must-never rules | `.claude/settings.json` + `.claude/hooks/*.mjs` |
| **Skills** | Run on request (`/name`) | Repeatable multi-step procedures | `.claude/skills/<name>/SKILL.md` |
| **Subagents** | Separate context window | Focused reviews, research, parallel lanes | `.claude/agents/<name>.md` |
| **MCP servers** | External connections | Live docs, browsers, services | `.mcp.json` (project) or user scope |
| **Plugins** | Bundles of the above, from a marketplace | Ready-made official tooling | `enabledPlugins` in settings |
| **GitHub Actions** | Runs on GitHub, without Claude | CI, Dependabot | `.github/` |

> **Why the "auto-commit/push" idea became a skill + hook instead of a hook alone:** an auto-push hook would push unreviewed, possibly broken code. The standard is *commit small verified slices, review through PRs*. So `/ship` (a skill) does the commit/push/PR when work is verified, `/close-milestone` tags releases, and hooks only *prevent* the dangerous variants.

## Hooks (`.claude/hooks/`, Node scripts, so they work on Windows)
| Hook event | Script | What it does |
|---|---|---|
| SessionStart | `session-context.mjs` | Tells Claude the current branch, milestone, next task, and uncommitted changes. Warns if you're on `main`. |
| PreToolUse (Bash, PowerShell) | `guard-bash.mjs` | **Blocks:** pushing to main (except the first-ever push to an empty repo), force-push, committing on main (after the first commit), `--no-verify`, `git reset --hard` / `git clean -f`, recursive `rm` outside build folders. |
| PreToolUse (Edit, Write) | `guard-secrets.mjs` | **Blocks:** writing `.env*` (except `.env.example`), key files, and content that looks like an API key or private key. |
| PostToolUse (Edit, Write) | `format.mjs` | Runs Prettier + ESLint `--fix` on edited code files. Does nothing until M0-1 installs them. |
| Stop | `handoff-reminder.mjs` | If code changed but the status doc or session log didn't, shows a reminder to `/ship`. |

Test a hook yourself:
```bash
echo '{"tool_input":{"command":"git push --force"}}' | node .claude/hooks/guard-bash.mjs; echo "exit=$?"
```
Exit code `2` = blocked (the reason goes to Claude), `0` = allowed.

## Skills (`/name`)
| Skill | Use when |
|---|---|
| `/refine <idea>` | **Prompt optimization.** Turns a rough request into a structured spec, shows you how it was improved, asks you to confirm, then runs it. Only runs when you call it. |
| `/start-task <#>` | Begin an issue: readiness check → branch → plan |
| `/ship` | Task verified: checks → reviews → docs → commit → push → PR |
| `/close-milestone Mx` | Exit criteria proven: tag + GitHub Release + changelog + retro |
| `/plan-milestone Mx` | Break a milestone into issues with dependencies |
| `/parallel-run` | Run ready, parallel-safe issues in multiple worktrees at once |
| `/sync-pm` | Refresh `docs/pm/ROADMAP.md` from GitHub and get a progress report |
| `/adr <title>` | Record an important decision |
| `/lesson <topic>` | Get a short lesson note on a concept |
| `/pixellab-assets <family>` | Produce a reviewed art batch (M5+) |

Plugin skills you also have: `/commit` and `/commit-push-pr` (commit-commands), `/review-pr` (pr-review-toolkit), `/code-review`, `/security-review`, `/feature-dev`, `/revise-claude-md` (claude-md-management).

## Subagents
| Agent | Model | Role |
|---|---|---|
| `architect` | Opus | Reviews plans against the architecture before coding |
| `invariant-reviewer` | Sonnet | Checks diffs against the product rules |
| `security-auditor` | Opus | Electron/IPC/path/secret security review |
| `test-engineer` | Sonnet | Writes and runs risk-focused tests |
| `docs-scribe` | Haiku | Updates status, roadmap, session logs, glossary (cheap) |
| `researcher` | Sonnet | Checks current official docs and versions |

You can ask for them directly: "use the security-auditor on this diff."

## MCP servers
| Server | Scope | Purpose | Setup |
|---|---|---|---|
| context7 | project (`.mcp.json`) | Current library docs (Electron, PixiJS, React Flow…) | Approve it on first use (`/mcp`) |
| playwright | already in your user config | Browser and Electron UI testing | — |
| PixelLab | **user scope (add at M5)** | Art generation | `claude mcp add` with your token, following https://www.pixellab.ai/mcp. Never in `.mcp.json`. |

GitHub access uses the `gh` CLI (already logged in) instead of a GitHub MCP server, because it costs less context.

## Plugins enabled for this project
`commit-commands`, `pr-review-toolkit`, `security-guidance` (warns about risky patterns while editing), `typescript-lsp` (type-aware code navigation, once TS exists), `claude-md-management`, `learning-output-style` (explanations plus invitations to write code yourself), `feature-dev`.
**Disabled here:** `vercel-plugin`. This is a desktop app, not a Vercel web project.
To switch learning mode off temporarily, set it to `false` in `.claude/settings.local.json`.

## Optional later
- **Claude Code GitHub Action** (`@claude` in issues and PRs): needs an Anthropic API key as a repo secret, and it's billed. Install with `/install-github-app` when you want it.
- **GitHub MCP server**: if you want richer GitHub automation than `gh`.
- **Status line** showing branch and milestone: run `/statusline`.

## Permissions
`.claude/settings.json` pre-allows safe, routine commands (git status/diff/commit, gh views, test/lint scripts) so you get fewer prompts, and denies reading `.env`/keys and force-pushing. Anything else still asks you first. Personal tweaks go in `.claude/settings.local.json` (gitignored; see the `.example` file).
