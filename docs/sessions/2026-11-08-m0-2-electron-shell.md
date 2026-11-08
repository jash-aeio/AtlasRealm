# Session 2026-11-08: M0-2 Electron shell + typed IPC (#5)

**Branch:** `feat/5-electron-shell-ipc` · **Issue:** [#5](https://github.com/jash-aeio/AtlasRealm/issues/5)

## Task
Prove the boundary between the privileged main process and the unprivileged renderer with one validated command: a secure window titled "Atlas Realm", a minimal preload API, one Zod-validated command that round-trips, and tests that show the renderer cannot reach `require` or `process`.

## Decisions
- **Electron build tooling → electron-vite + electron-builder** ([ADR-0009](../adr/0009-electron-vite-and-electron-builder.md)), chosen via AskUserQuestion. electron-vite 6 supports Vite 8 (our pinned version). Forge's Vite plugin is still experimental. electron-builder comes in M0-7.
- E2E tooling: Playwright `_electron` (the M0 default; no alternative was seriously considered).

## Plan (awaiting approval)
1. `docs(adr)`: ADR-0009 + this log.
2. `chore(deps)`: Electron, electron-vite, React, Zod, Playwright; split tsconfig by environment (node vs web); `dev` / `build` / `test:e2e` scripts.
3. `feat(shell)`: secure BrowserWindow (sandbox, contextIsolation, no nodeIntegration, CSP, navigation and new windows blocked) and a minimal React page.
4. `feat(ipc)`: `app.ping` contract (Zod) in `src/common/contracts`, main-process command router (sender check + payload validation + typed result), preload API `window.atlas.app.ping`. Unit tests.
5. `test(e2e)`: Playwright launches the built app: title, round-trip, invalid payload rejected, `require`/`process` unreachable, `window.open` blocked. CI step.

Learning-mode piece for the user: the `PingInput` Zod schema (rules are spelled out by tests written first).

## Done
- Branch created, issue moved to In Progress, ADR-0009 written.

## Open questions
- None yet.
