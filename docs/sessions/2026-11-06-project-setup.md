# Session 2026-11-06: Project setup

**Goal:** Turn the Atlas Realm build plan into a standard, AI-assisted-development-ready repository before writing any app code.

## What you asked for
- Review and improve the 2,131-line build plan for AI-assisted development, split into proper `.md` docs
- Keep every document and discussion understandable (learning experience) while staying professional
- Set up Claude Code: CLAUDE.md, skills (including a prompt-optimization skill), subagents, hooks, MCP servers
- Project management docs for progress, multi-agent work, and dependencies
- Always use AskUserQuestion for important decisions
- GitHub automation for commits/pushes at milestones, with advice on where each piece belongs

## Decisions made (via questions)
| Question | Your choice |
|---|---|
| How automatic should commits/pushes be? | **Branch + PR flow**: commit per verified slice, PR per task, tag per milestone, hooks block pushes to main |
| Where should PM live? | **GitHub (Issues, Milestones, Project board) + Markdown mirror** in `docs/pm/` |
| Learning style | **Explain + occasional hands-on** (at most one "you write this" piece per task) |
| Prompt optimization | **Only when you call `/refine`** |

## What was done
1. Read the full spec. Archived it unchanged at `docs/archive/`. Split all 35 sections **verbatim** into focused docs (mapping table in `docs/README.md`).
2. Improvements to the plan (see `docs/pm/ROADMAP.md`, "Changes from the original spec"): task layer under milestones, ADRs instead of one decisions file, Definition of Ready/Done, CI from day 1, open M0 decisions listed, dependency graph and parallel lanes, M1 untangled from import inspection, Alpha checkpoint after M4, prompts turned into skills, and a session/learning trail.
3. New process docs: development workflow, git workflow, multi-agent guide, Claude setup guide, PM guide.
4. Claude Code config: `CLAUDE.md`, `.claude/settings.json` (permissions, 5 hooks, plugins), 10 skills, 6 subagents, `.mcp.json` (context7).
5. GitHub: CI (Windows runner), Dependabot, PR and issue templates, labels, milestones, M0 issues, project board, branch protection.

## Verification
- Hook scripts were tested with sample inputs: force-push, `--no-verify`, `rm -rf src`, `git reset --hard`, writing `.env`, and an API-key-looking string were all **blocked** (exit 2). Safe commands were allowed (exit 0). The session-context hook printed the milestone and next task.
- `settings.json` and `.mcp.json` are valid JSON. CI validates them on every push.

## Things to know
- The first commit went straight to `main`, since the repo was empty. Everything after it goes through PRs.
- The PixelLab MCP is not installed yet (it's needed at M5, user scope, with your token).
- The `format.mjs` hook and the CI app checks switch on automatically once M0-1 adds `package.json`.

## Open questions → M0
Package manager, Electron build tooling, SQLite binding, license. Each will be asked via AskUserQuestion and recorded as an ADR.

## Next step
Run `/start-task 4` (M0-1) in a new session. Also review and merge the 3 Dependabot PRs (#1–#3) as a first practice with PR review.

## Follow-up: project board
- You added the `project` scope to the gh login (`gh auth refresh -h github.com -s project`). The `-h github.com` was needed because the command ran outside an interactive terminal.
- Created **[Atlas Realm Roadmap](https://github.com/users/jash-aeio/projects/1)**, linked to the repo. Status columns: Backlog / Ready / In Progress / In Review / Done. Custom fields: **Lane** (A/B/C/D/Integrator) and **Parallel-safe** (Yes/No).
- Issues #4–#11 and PR #12 are on the board. #4 (M0-1) and #11 (M0-8) are **Ready**: their dependencies are done. The rest are in Backlog until M0-1 merges.
