# Implementation status

> **The handoff between sessions.** Read this first, every session. Update it before handing work back (`/ship` does it). Treat claims here as notes to verify against the code, not as facts.

**Last updated:** 2026-11-08 · **Branch:** chore/4-tooling-scaffold (PR for #4)

## Current milestone
**M0 — Foundation and risk spikes** (🔨 in progress; M0-1 in review)

## Implemented and demonstrated
- Repository and process setup (2026-11-06): spec docs, Claude Code config, GitHub workflow. See `docs/sessions/2026-11-06-project-setup.md`.
- **M0-1 tooling scaffold (#4):** developer tooling only. **There is no runnable app yet.**
  - pnpm 12.18.0 pinned through corepack (`packageManager` in `package.json`). Dependency install scripts are blocked unless allowed in `pnpm-workspace.yaml` (none allowed so far).
  - TypeScript 6.0.3 with `strict` and extra safety flags (`tsconfig.json`).
  - ESLint 10 flat config with typescript-eslint `strictTypeChecked`, plus Prettier (`eslint.config.js`, `.prettierrc.json`).
  - Vitest 5 (`vitest.config.ts`). First tested code: `src/common/errors/assert-never.ts`.
  - CI (`.github/workflows/ci.yml`) runs install → typecheck → lint → format:check → test on windows-latest.

## Changed components
- Root config: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `vitest.config.ts`, `LICENSE`
- `src/common/errors/`, `tests/domain/`
- `.github/workflows/ci.yml`. Formatting-only changes in `.claude/hooks/*`, `.claude/settings.json`, `.github/**/*.yml`.

## Verification
- Locally, after a clean `pnpm install --frozen-lockfile`: `typecheck`, `lint`, `format:check` and `test` pass (2 tests).
- Each check was shown to fail on purpose: a type error → typecheck exit 2; a failing probe test → test exit 1; an empty catch → lint error.
- `tests/domain/assert-never.test.ts`: the runtime throw, and a compile-time check via `@ts-expect-error` (proven: handling every case makes typecheck fail with TS2578).
- `format.mjs` hook reformats edited files. `guard-bash.mjs` still blocks pushes to main after reformatting.
- CI on the PR: see the PR checks.

## Known limitations
- No application code: no Electron, React, Pixi, DB or IPC yet. Every product feature is unimplemented.
- `tsconfig.json` is a single base config. M0-2 splits it per process (main / preload / renderer).
- TypeScript is held at 6.0.x until typescript-eslint supports 7.x.
- On this machine, `corepack enable` needs an admin terminal (Node is in `D:\Node`). `corepack pnpm …` works without it.

## Data/schema changes
- None.

## Decisions
- ADR-0001 … ADR-0006 (stack defaults and approved Nov 6 product decisions)
- [ADR-0007](../adr/0007-pnpm-via-corepack.md): pnpm via corepack
- [ADR-0008](../adr/0008-proprietary-license-for-now.md): proprietary license for now

## Next task
- After the #4 PR is merged: **M0-2 Electron shell + typed IPC**, run `/start-task 5` (issue #5).
  Start by deciding the Electron build tooling (electron-vite + electron-builder vs Electron Forge) via AskUserQuestion → ADR. Check Vite 8 compatibility.
  M0-3 (#6, SQLite) and M0-8 (#11, art placeholders) also only depend on M0-1.
