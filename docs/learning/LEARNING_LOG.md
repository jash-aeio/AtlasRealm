# Learning log

Your personal trail of what you learned while building Atlas Realm. Each lesson is short: the concept, how it shows up in this project, and a tiny exercise. Claude writes one (`/lesson <topic>`) whenever a task introduces something new, and you can ask for one any time.

| # | Lesson | Milestone | Concepts |
|---|---|---|---|
| 001 | [AI-assisted development workflow](lessons/001-ai-assisted-dev-workflow.md) | Setup | spec-driven development, CLAUDE.md, skills, hooks, subagents, MCP, PR flow |
| 002 | [The quality toolchain](lessons/002-the-quality-toolchain.md) | M0 | package manager, lockfile, type check, lint, format, tests, CI, exhaustiveness checks |
| 003 | [Electron process model and safe IPC](lessons/003-electron-process-model-and-ipc.md) | M0 | main/preload/renderer, sandbox, context isolation, contextBridge, CSP, validated IPC |
| 004 | [Database migrations, transactions and safe backups](lessons/004-migrations-transactions-backups.md) | M0 | migrations, schema version, transactions, rollback, WAL, online backup, repositories |

## Suggested reading order for the docs
1. `docs/README.md`: the map
2. `docs/product/PRD.md` §2: what we're building
3. `docs/product/PRODUCT_RULES.md` §3.1: the rules
4. `docs/process/DEVELOPMENT_WORKFLOW.md`: how we work
5. `docs/process/CLAUDE_SETUP_GUIDE.md`: what each Claude tool does
