# Implementation status

> **The handoff between sessions.** Read this first, every session. Update it before handing work back (`/ship` does it). Treat claims here as notes to verify against the code, not as facts.

**Last updated:** 2026-11-06 · **Branch:** main

## Current milestone
Setup ✅ complete → **M0 — Foundation and risk spikes** (not started)

## Implemented and demonstrated
- Repository and process setup (no application code yet):
  - Spec split into focused docs under `docs/` (verbatim, mapped in `docs/README.md`)
  - Claude Code config: `CLAUDE.md`, `.claude/settings.json` (permissions, hooks, plugins), 10 project skills, 6 subagents, `.mcp.json` (context7)
  - GitHub: CI stub, PR/issue templates, Dependabot, labels, milestones, M0 issues, branch protection

## Changed components
- `docs/**`, `.claude/**`, `.github/**`, root config files

## Verification
- Hook scripts tested with sample JSON inputs (see `docs/sessions/2026-11-06-project-setup.md`)
- CI stub runs on push/PR (no app checks yet, since there's no package.json)

## Known limitations
- No application code. Every product feature is unimplemented.
- `format.mjs` hook does nothing until M0-1 installs Prettier/ESLint.
- CI only checks docs/config until M0-1 adds real scripts.
- Stack choices (package manager, build tooling, SQLite binding, license) are still open M0 decisions.

## Data/schema changes
- None.

## Decisions
- ADR-0001 … ADR-0006 (stack defaults and approved Nov 6 product decisions)

## Next task
- **M0-1 Tooling scaffold**: run `/start-task <issue#>` (see `gh issue list --milestone M0`).
  Acceptance: `pnpm install && pnpm typecheck && pnpm lint && pnpm test` pass locally and in CI; TS strict; README and CLAUDE.md commands filled in. Start by asking about package manager and license (AskUserQuestion → ADR).
