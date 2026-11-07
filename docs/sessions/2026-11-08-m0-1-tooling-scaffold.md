# 2026-11-08: M0-1 tooling scaffold (issue #4)

**Branch:** `chore/4-tooling-scaffold`

## Task
Create the tooling foundation: package manager, TypeScript strict, ESLint/Prettier, Vitest, and a CI workflow that runs the real scripts on Windows.

## Decisions
- **Package manager: pnpm via corepack** (asked via AskUserQuestion, recorded in ADR-0007). This is the spec default.
- **License: proprietary for now** (`UNLICENSED`, all rights reserved; asked via AskUserQuestion, recorded in ADR-0008). We can open-source later. Taking back a license we've already granted isn't possible.
- **Electron build tooling deferred to M0-2.** Nothing in this task depends on it.
- **TypeScript pinned to 6.0.x, not 7.0.** `typescript-eslint` 8.72 declares support for `typescript >=4.8.4 <6.1.0`. Revisit when it supports TS 7. (Routine compatibility choice.)
- **`@types/node` 24.x**, because Electron 45 bundles Node 24. The local Node is v24.13.1.

## Plan
1. `docs(adr)`: ADR-0007 (pnpm) and ADR-0008 (license), plus a `LICENSE` file.
2. `chore`: `package.json` (`private`, `UNLICENSED`, `packageManager`, `engines`), `tsconfig.json` (strict), install TypeScript, `typecheck` script.
3. `chore(lint)`: ESLint flat config (typescript-eslint) + Prettier + eslint-config-prettier, `lint`/`format` scripts; verify the `format.mjs` hook.
4. `test`: Vitest config, a tiny `assertNever` helper, and its test (**learning piece: the user writes the test**).
5. `ci`: finalize `.github/workflows/ci.yml` to run the pnpm scripts with caching.
6. `docs`: README "Getting started" + "License", CLAUDE.md "Commands".

## Done
_(filled in as slices land)_

## Open questions
- None yet.
