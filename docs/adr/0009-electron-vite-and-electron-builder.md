# ADR-0009: electron-vite for builds, electron-builder for packaging

- **Status:** Accepted
- **Date:** 2026-11-08
- **Milestone(s) affected:** M0-2 (dev shell), M0-7 (Windows packaging), all later milestones
- **Decided by:** jash-aeio (asked via AskUserQuestion on 2026-11-08)

## Context
M0-2 (issue #5) needs a way to build the three Electron processes (main, preload, renderer) with Vite and run them in development. M0-7 needs a way to package a Windows build that loads a native SQLite module. ADR-0001 picked Electron + React + TypeScript + Vite and left the build tooling open. The repo already pins Vite 8.3.6 (M0-1), so the tool must support Vite 8. Security rules (SECURITY.md §21.1) require a sandboxed preload, which needs its own build settings separate from the renderer's.

Versions checked on 2026-11-08 (npm registry and the projects' docs): electron 45.2.3, electron-vite 6.0.0, electron-builder 26.18.0, @electron-forge/cli and plugin-vite 8.0.1.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| **electron-vite + electron-builder** | electron-vite 6 says it supports `vite ^6 \|\| ^7 \|\| ^8` in its peer dependencies. One config file sets up main, preload and renderer separately, and dev mode reloads them. electron-builder is widely used for Windows NSIS installers and rebuilding native modules. | Two community-maintained tools instead of one official one. Two configs to learn. |
| Electron Forge + Vite plugin | Official Electron project. Build, package and publish in one tool. | Forge has marked its Vite plugin *experimental* since v7.5.0: minor versions may break things. Vite 8 support isn't documented. We might have to downgrade Vite. |

## Decision
We chose **electron-vite (build and dev server) + electron-builder (packaging)**. It is the only option with confirmed Vite 8 support, and its separate per-process build settings fit the main / preload / renderer security boundary.

## Consequences
- `electron.vite.config.ts` defines the main, preload and renderer builds. `pnpm dev` runs `electron-vite dev`.
- electron-builder is added in M0-7, not M0-2, so we only add dependencies when they're needed.
- Electron's postinstall downloads its binary. It must be listed under `allowBuilds` in `pnpm-workspace.yaml` (ADR-0007).
- **Signals to revisit:** electron-vite stops releasing versions for new Vite/Electron majors. electron-builder can't package the pnpm layout or the native SQLite module in M0-7. Forge's Vite plugin leaves experimental status and becomes clearly better supported.

## Learning note
An Electron app is really three programs: the privileged main process, a small preload bridge, and the web-page renderer. Each one is built for a different environment. A build tool like electron-vite builds all three at once with the right settings, and a packager like electron-builder bundles them with Electron into a single installable `.exe`.
