# ADR-0007: pnpm via corepack as the package manager

- **Status:** Accepted
- **Date:** 2026-11-08
- **Milestone(s) affected:** M0 onward (all install, CI and packaging steps)
- **Decided by:** jash-aeio (asked via AskUserQuestion on 2026-11-08)

## Context
M0-1 (issue #4) needs a package manager before anything can be installed. The spec's suggested repository structure (ARCHITECTURE.md §8) lists `pnpm-lock.yaml`, and the CI stub already had a pnpm branch. The app is Electron with native modules (a SQLite binding arrives in M0-3), so the choice must work with Electron packaging on Windows.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| **pnpm via corepack** | Fast, disk-efficient (one shared store). Strict: code can only import dependencies it declares. Blocks dependency install scripts unless explicitly allowed (supply-chain safety). Corepack pins the exact version through `packageManager` in `package.json`. | Some Electron tooling expects a flat `node_modules`, which may need a config line (e.g. `node-linker=hoisted`). Contributors must enable corepack once. |
| npm | Bundled with Node, zero setup, most tutorials. | Slower, and it lets code use undeclared ("phantom") dependencies. Runs dependency install scripts by default. CI and docs would need changes. |

## Decision
We chose **pnpm, pinned through corepack** (`"packageManager": "pnpm@<version>"`), because it is the spec default and its strictness catches dependency mistakes early.

## Consequences
- Setup is `corepack enable` once, then `pnpm install`. CI uses `pnpm/action-setup`, which reads the `packageManager` field.
- Dependency build scripts must be allowed explicitly in `pnpm-workspace.yaml`. This is deliberate friction: each allowance should be justified in the commit.
- Node 25+ no longer bundles corepack. We're on Node 24 (Electron 45's bundled Node). If we move to Node 25+, install corepack separately (`npm i -g corepack`) or switch to `pnpm/action-setup` alone.
- **Signals to revisit:** Electron packaging (M0-7) fails because of pnpm's symlinked `node_modules` and `node-linker=hoisted` doesn't fix it.

## Learning note
A package manager installs the libraries your code depends on and records exact versions in a lockfile, so every machine (including CI) gets the same versions. pnpm is stricter than npm: if you forget to declare a dependency, it fails right away instead of happening to work on your machine.
