# Changelog

All notable changes to Atlas Realm are recorded here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/) with milestone tags (`v0.1.0-m0`, `v0.2.0-m1`, …).

## [Unreleased]

### Added
- Placeholder world view (M0-4, #7): the window now shows a 64 × 64 isometric grid drawn with PixiJS (WebGL, falling back to Canvas2D). Hover a tile to see its grid position, zoom with the wheel or the Zoom buttons, and pan with the middle mouse button. If graphics can't start or the GPU context is lost, the world area shows a message and the rest of the app keeps working. The grid is an M0 placeholder: no projects or buildings yet, and nothing in the view is saved. ADR-0011.
- Windows packaging (M0-7, #10): `pnpm package` produces an unsigned NSIS installer (per-user, no admin) and an unpacked app. The packaged app is hardened with Electron fuses: no run-as-Node, no `NODE_OPTIONS` or `--inspect` code injection, and a modified app archive refuses to start. `file:` requests are blocked everywhere. The window now shows the launch count stored in the local database (an M0 sample). A packaged smoke test runs the real `.exe` from a folder with spaces and non-ASCII characters, both locally and in CI. Uninstalling keeps your data. Uses Electron's default icon for now.
- Safer UI loading (M0-9, #16): the built app now loads its interface from its own `app://atlas` origin instead of `file://`. The page can no longer load scripts or images from local files or network shares (closing a Windows login-hash leak route), and IPC commands are accepted only from that origin.
- Local database (M0-3, #6): the app keeps a SQLite database in its user-data folder (built-in `node:sqlite`, ADR-0010). It has versioned migrations that run in transactions, an automatic backup before upgrading an existing database, and a clear error (no silent reset) if the database can't be opened. For now it stores only launch facts. Only one copy of the app can run at a time.
- Electron app shell (M0-2, #5): a window titled "Atlas Realm" with a sandboxed, isolated renderer, a strict CSP, and blocked navigation and pop-ups. A single Zod-validated IPC command (`app.ping`, an M0 spike) round-trips from the UI to the main process. Covered by unit tests and Playwright E2E tests. Build tooling: electron-vite (ADR-0009).
- Developer tooling (M0-1, #4): pnpm via corepack, strict TypeScript, ESLint + Prettier, Vitest, and CI running all checks on Windows. No runnable app yet.
- License: proprietary, all rights reserved (ADR-0008).
- Project setup: split product spec into focused docs, AI-assisted development process, Claude Code configuration (CLAUDE.md, skills, subagents, hooks, MCP), GitHub workflow (CI, templates, labels, milestones).
