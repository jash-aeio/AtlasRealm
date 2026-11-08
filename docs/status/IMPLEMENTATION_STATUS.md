# Implementation status

> **The handoff between sessions.** Read this first, every session. Update it before handing work back (`/ship` does it). Treat claims here as notes to verify against the code, not as facts.

**Last updated:** 2026-11-08 · **Branch:** feat/5-electron-shell-ipc (PR for #5)

## Current milestone
**M0 — Foundation and risk spikes** (🔨 in progress; M0-1 done, M0-2 in review)

## Implemented and demonstrated
- Repository and process setup (2026-11-06): spec docs, Claude Code config, GitHub workflow. See `docs/sessions/2026-11-06-project-setup.md`.
- **M0-1 tooling scaffold (#4, merged):** developer tooling.
  - pnpm 12.18.0 pinned through corepack (`packageManager` in `package.json`). Dependency install scripts are blocked unless allowed in `pnpm-workspace.yaml` (none allowed so far).
  - TypeScript 6.0.3 with `strict` and extra safety flags (`tsconfig.json`).
  - ESLint 10 flat config with typescript-eslint `strictTypeChecked`, plus Prettier (`eslint.config.js`, `.prettierrc.json`).
  - Vitest 5 (`vitest.config.ts`). First tested code: `src/common/errors/assert-never.ts`.
  - CI (`.github/workflows/ci.yml`) runs install → typecheck → lint → format:check → test on windows-latest.

- **M0-2 Electron shell + typed IPC (#5):** `pnpm dev` opens a window titled "Atlas Realm". It shows only an "IPC check (M0 spike)" panel: no world, projects or data.
  - Renderer: sandboxed (the OS reports it), context isolation on, no Node integration, strict CSP (`src/common/security/csp.ts`, relaxed only for the Vite dev server). Navigation, redirects, pop-ups, webviews and permission requests are denied.
  - Preload exposes only `window.atlas.app.ping` (built as a single CommonJS file, as the sandbox requires).
  - IPC router (`src/main/ipc/router.ts`): sender check (our page's main frame only; rejects UNC look-alikes) → Zod schema → 64 KiB size limit → handler → output schema. Typed `IpcResult` with stable error codes.
  - `app.ping` is an **M0 spike command** with no product meaning.
  - Build tooling: electron-vite 6 (ADR-0009). Packaging (electron-builder) is not set up yet.

## Changed components
- M0-2: `electron.vite.config.ts`, `playwright.config.ts`, `tsconfig.{base,node,web,e2e}.json` (tsconfig split per environment), `pnpm-workspace.yaml` (`allowBuilds: electron`), `package.json` scripts
- `src/main/` (bootstrap, ipc), `src/preload/`, `src/renderer/`, `src/common/contracts/`, `src/common/security/`
- `tests/integration/`, `tests/security/`, `tests/e2e/`; CI gains an E2E step
- M0-1: root tooling config, `src/common/errors/`, `tests/domain/`, `.github/workflows/ci.yml`

## Verification
- 2026-11-08, local Windows 11: typecheck (node + web + e2e), lint and format:check pass. Unit tests 42/42. E2E (Playwright + Electron, built app) 8/8.
- E2E probes: title, OS sandbox, no `require`/`process`/`module`/`Buffer` in the page, preload API shape, `app.ping` round-trip, invalid payload rejected, injected inline script blocked by CSP, `window.open` and navigation blocked.
- The probes were shown to fail: with sandbox/isolation off, Node on, `unsafe-inline` and guards removed, 7 of 8 E2E tests failed. The UNC sender test fails without its fix.
- Dev mode checked: dev CSP served; a dev window showed the title and a successful round-trip with no console errors.
- CI: see the PR checks (first CI run with E2E on windows-latest).

## Known limitations
- No product features yet: no DB, world, projects, Pixi or React Flow.
- **Security follow-up (not yet an issue):** the built UI loads from `file://`. On a file page, CSP `'self'` covers other local and UNC files. Serve it from a custom `app://` protocol before rendering any untrusted content (security review of #5).
- Renderer bundle isn't minified (~567 kB, electron-vite default). `react`/`react-dom` sit in `dependencies` although they're bundled. Decide both in M0-7 packaging.
- No single-instance lock yet (ARCHITECTURE §7.4).
- TypeScript is held at 6.0.x until typescript-eslint supports 7.x.
- On this machine, `corepack enable` needs an admin terminal (Node is in `D:Node`). `corepack pnpm …` works without it.

## Data/schema changes
- None.

## Decisions
- ADR-0001 … ADR-0006 (stack defaults and approved Nov 6 product decisions)
- [ADR-0007](../adr/0007-pnpm-via-corepack.md): pnpm via corepack
- [ADR-0008](../adr/0008-proprietary-license-for-now.md): proprietary license for now
- [ADR-0009](../adr/0009-electron-vite-and-electron-builder.md): electron-vite for builds, electron-builder for packaging

## Next task
- After the #5 PR is merged: create the `app://` protocol follow-up issue (draft from the #5 session), then pick one of the now-unblocked M0 tasks:
  - **M0-3 SQLite + migrations (#6)**: decide better-sqlite3 vs `node:sqlite` first (AskUserQuestion → ADR; Electron 45 bundles Node 24).
  - M0-4 Pixi canvas (#7), M0-5 React Flow spike (#8), M0-6 worker messaging (#9), M0-8 art placeholders (#11).
