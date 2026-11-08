# Changelog

All notable changes to Atlas Realm are recorded here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/) with milestone tags (`v0.1.0-m0`, `v0.2.0-m1`, …).

## [Unreleased]

### Added
- Electron app shell (M0-2, #5): a window titled "Atlas Realm" with a sandboxed, isolated renderer, a strict CSP, and blocked navigation and pop-ups. A single Zod-validated IPC command (`app.ping`, an M0 spike) round-trips from the UI to the main process. Covered by unit tests and Playwright E2E tests. Build tooling: electron-vite (ADR-0009).
- Developer tooling (M0-1, #4): pnpm via corepack, strict TypeScript, ESLint + Prettier, Vitest, and CI running all checks on Windows. No runnable app yet.
- License: proprietary, all rights reserved (ADR-0008).
- Project setup: split product spec into focused docs, AI-assisted development process, Claude Code configuration (CLAUDE.md, skills, subagents, hooks, MCP), GitHub workflow (CI, templates, labels, milestones).
