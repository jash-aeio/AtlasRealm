# Atlas Realm: An Agentic AI Ecosystem

A beginner-friendly, **local-first Windows desktop app** where your projects are buildings in a fantasy isometric world. You can enter a building's 2.5D interior, look at how things connect in the Realm Atlas, assign AI agents with skills and tools, supervise their work, and turn workflows into automations.

> **Status:** M0 in progress. A secure Electron shell with a local SQLite database, packaged as a Windows installer. The window shows only M0 test panels (IPC check, launch count): no world or projects yet.
> See [docs/status/IMPLEMENTATION_STATUS.md](docs/status/IMPLEMENTATION_STATUS.md) for where things stand right now.

## Planned stack (confirmed during M0)
Electron · React · TypeScript · Vite · PixiJS (world/interiors) · React Flow (Realm Atlas) · SQLite · Zod · Vitest · Playwright

## Getting started
**Prerequisites:** Windows 10/11, [Node.js 24](https://nodejs.org/) (it includes corepack), Git.

```sh
# One time: let corepack provide the exact pnpm version pinned in package.json.
# If Node is installed in a protected folder, run this in an administrator terminal.
corepack enable pnpm

pnpm install          # install dependencies (exact versions from pnpm-lock.yaml)
pnpm typecheck        # TypeScript type check (strict)
pnpm lint             # ESLint
pnpm format:check     # Prettier check (`pnpm format` fixes formatting)
pnpm test             # Vitest, once (`pnpm test:watch` re-runs on save)
pnpm dev              # run the app with hot reload (electron-vite)
pnpm build            # build main/preload/renderer into out/
pnpm test:e2e         # build, then Playwright launches the real app
pnpm package          # Windows installer + unpacked app in release/ (about 1 minute)
pnpm test:e2e:packaged # smoke-test the packaged app (run `pnpm package` first)
```

Can't run `corepack enable`? Prefix the commands with `corepack` instead, e.g. `corepack pnpm install`.

### Packaging (Windows)
`pnpm package` builds `release/AtlasRealm-Setup-<version>.exe` (an NSIS installer: per-user, no admin rights, choosable folder) and `release/win-unpacked/` (the app, runnable without installing).
- **Unsigned:** Windows SmartScreen warns on first run ("More info" → "Run anyway"). Code signing is a later release decision.
- **Placeholder icon:** Electron's default until the M0-8 art lands.
- The installed app keeps its data in `%APPDATA%\Atlas Realm` (dev runs use `%APPDATA%\atlas-realm`). Uninstalling keeps that folder.
- `pnpm test:e2e:packaged` runs the packaged `.exe` from a folder with spaces and non-ASCII characters. It checks that data survives a restart, that assets load only from inside the app, and that the security fuses are on. CI does the same on every PR and attaches the unsigned installer as a 7-day artifact.

## Documentation
Start at **[docs/README.md](docs/README.md)**. It's a map of every document with a "read this when…" guide.

| I want to… | Read |
|---|---|
| Understand the product | [docs/product/PRD.md](docs/product/PRD.md) |
| Know the rules that must never break | [docs/product/PRODUCT_RULES.md](docs/product/PRODUCT_RULES.md) |
| See progress and what's next | [docs/pm/ROADMAP.md](docs/pm/ROADMAP.md) · [GitHub Project board](https://github.com/users/jash-aeio/projects/1) |
| Learn how we work with Claude | [docs/process/DEVELOPMENT_WORKFLOW.md](docs/process/DEVELOPMENT_WORKFLOW.md) |
| Learn the concepts | [docs/learning/LEARNING_LOG.md](docs/learning/LEARNING_LOG.md) |

## How development works (short version)
1. Every piece of work is a **GitHub Issue** in a **Milestone** (M0, M1, …).
2. In Claude Code: `/start-task <issue#>` creates a branch and a plan.
3. Claude implements a small slice and verifies it. You learn along the way.
4. `/ship` runs the checks, updates the docs, commits, pushes, and opens a **Pull Request**.
5. You review and merge. CI must pass. `main` is protected.
6. `/close-milestone` tags a release when a milestone's exit criteria are proven.

## License
Proprietary, all rights reserved (see [LICENSE](LICENSE) and [ADR-0008](docs/adr/0008-proprietary-license-for-now.md)).
