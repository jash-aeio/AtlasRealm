# Atlas Realm: An Agentic AI Ecosystem

A beginner-friendly, **local-first Windows desktop app** where your projects are buildings in a fantasy isometric world. You can enter a building's 2.5D interior, look at how things connect in the Realm Atlas, assign AI agents with skills and tools, supervise their work, and turn workflows into automations.

> **Status:** Pre-M0. The repository and process are set up; no application code exists yet.
> See [docs/status/IMPLEMENTATION_STATUS.md](docs/status/IMPLEMENTATION_STATUS.md) for where things stand right now.

## Planned stack (confirmed during M0)
Electron · React · TypeScript · Vite · PixiJS (world/interiors) · React Flow (Realm Atlas) · SQLite · Zod · Vitest · Playwright

## Getting started
_Commands get added here in M0 once the app is scaffolded._

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
Not yet selected. This is a decision scheduled for M0 (see [ADR process](docs/adr/0000-template.md)).
