# Session 2026-11-08: M0-2 Electron shell + typed IPC (#5)

**Branch:** `feat/5-electron-shell-ipc` · **Issue:** [#5](https://github.com/jash-aeio/AtlasRealm/issues/5)

## Task
Prove the boundary between the privileged main process and the unprivileged renderer with one validated command: a secure window titled "Atlas Realm", a minimal preload API, one Zod-validated command that round-trips, and tests that show the renderer cannot reach `require` or `process`.

## Decisions
- **Electron build tooling → electron-vite + electron-builder** ([ADR-0009](../adr/0009-electron-vite-and-electron-builder.md)), chosen via AskUserQuestion. electron-vite 6 supports Vite 8 (our pinned version). Forge's Vite plugin is still experimental. electron-builder comes in M0-7.
- E2E tooling: Playwright `_electron` (the M0 default; no alternative was seriously considered).

## Plan (approved)
1. `docs(adr)`: ADR-0009 + this log.
2. `chore(deps)`: Electron, electron-vite, React, Zod, Playwright; split tsconfig by environment (node vs web); `dev` / `build` / `test:e2e` scripts.
3. `feat(shell)`: secure BrowserWindow (sandbox, contextIsolation, no nodeIntegration, CSP, navigation and new windows blocked) and a minimal React page.
4. `feat(ipc)`: `app.ping` contract (Zod) in `src/common/contracts`, main-process command router (sender check + payload validation + typed result), preload API `window.atlas.app.ping`. Unit tests.
5. `test(e2e)`: Playwright launches the built app: title, round-trip, invalid payload rejected, `require`/`process` unreachable, `window.open` blocked. CI step.

Learning-mode piece for the user: the `PingInput` Zod schema (rules are spelled out by tests written first).

## Done
- Branch created, issue moved to In Progress, ADR-0009 written.
- Slices committed: deps + tsconfig split, secure shell, IPC router + contract + preload, E2E + CI step.
- Routine choices (no ADR needed): preload built as one CommonJS file (sandboxed preloads can't load ES modules); CSP kept in `src/common/security/csp.ts` and written into index.html at build time, relaxed only for the dev server; 64 KiB IPC payload limit; separate `tsconfig.e2e.json` because Playwright tests mix Node and page code.
- Didn't rely on `webContents.getLastWebPreferences()`: it isn't in Electron's typings (internal API). The sandbox check uses the documented `app.getAppMetrics()[].sandboxed` instead.

## Verification (2026-11-08, local Windows 11)
- typecheck (node + web + e2e), lint and format:check pass. Unit tests: 26 passed, 5 skipped (the user's exercise).
- E2E: 8/8 pass against the built app.
- Negative check: with sandbox and isolation off, Node on, `unsafe-inline` and the guards removed, 7 of 8 E2E tests fail. So the probes really test the protections.
- Dev mode: `pnpm dev` serves the dev CSP; a Playwright-driven dev window showed the title and a successful round-trip with no console errors.
- CI: not run yet (runs on the PR).

## Open questions
- The renderer bundle isn't minified (electron-vite's default, ~567 kB). Revisit in M0-7 packaging.
- `react` / `react-dom` are in `dependencies` although they're bundled into the renderer. M0-7 should decide what electron-builder ships.
- Single-instance lock (ARCHITECTURE §7.4) isn't in this task. It belongs with the DB work (M0-3) or later.
