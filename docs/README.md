# Atlas Realm documentation map

This folder holds the spec (what to build), the process (how we build it), project management (where we are), and the learning trail (what you learned along the way).

> **Tip for Claude and humans:** don't read everything. Find your task in the table below and read only those docs.

## Read this when…

| Working on… | Read first | Also useful |
|---|---|---|
| Anything (every session) | [status/IMPLEMENTATION_STATUS.md](status/IMPLEMENTATION_STATUS.md) | [pm/ROADMAP.md](pm/ROADMAP.md) |
| Any feature | [product/PRODUCT_RULES.md](product/PRODUCT_RULES.md) | [product/PRD.md](product/PRD.md) |
| Electron shell, IPC, preload, folder structure | [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) | [architecture/SECURITY.md](architecture/SECURITY.md) |
| Database, migrations, manifests | [architecture/DATA_MODEL.md](architecture/DATA_MODEL.md) | |
| World canvas, hotbar, library, UI panels | [product/UI_SPEC.md](product/UI_SPEC.md) | [art/ART_BIBLE.md](art/ART_BIBLE.md) |
| Permissions, approvals, file access, secrets | [architecture/SECURITY.md](architecture/SECURITY.md) | |
| AI providers (mock, Ollama, Anthropic, OpenAI) | [architecture/AI_PROVIDERS.md](architecture/AI_PROVIDERS.md) | |
| Runs, workflows, queue, schedules | [architecture/WORKFLOW_ENGINE.md](architecture/WORKFLOW_ENGINE.md) | |
| Offline behavior, backup, restore | [architecture/OFFLINE_AND_RECOVERY.md](architecture/OFFLINE_AND_RECOVERY.md) | |
| Realm Atlas / graphs | [architecture/GRAPH_MODEL.md](architecture/GRAPH_MODEL.md) | |
| Interiors / Blueprint mode | [architecture/INTERIORS.md](architecture/INTERIORS.md) | |
| Obsidian export | [architecture/OBSIDIAN_BRIDGE.md](architecture/OBSIDIAN_BRIDGE.md) | |
| Import Existing Project | [architecture/IMPORT_SPEC.md](architecture/IMPORT_SPEC.md) | |
| Art / PixelLab | [art/ART_BIBLE.md](art/ART_BIBLE.md) | [art/ASSET_PROVENANCE.md](art/ASSET_PROVENANCE.md) |
| Writing tests | [quality/TEST_PLAN.md](quality/TEST_PLAN.md) | |
| Closing a milestone or release | [quality/RELEASE_GATES.md](quality/RELEASE_GATES.md) | [pm/ROADMAP_SPEC.md](pm/ROADMAP_SPEC.md) |
| Planning / parallel work | [pm/DEPENDENCIES.md](pm/DEPENDENCIES.md) | [process/MULTI_AGENT_GUIDE.md](process/MULTI_AGENT_GUIDE.md) |
| A big decision | [adr/](adr/) | |

## Folder guide

| Folder | What's inside | Who changes it |
|---|---|---|
| `product/` | What the app is and the rules it must follow | Changes only with an ADR |
| `architecture/` | How the app is built, one doc per subsystem | Changes with an ADR when the design changes |
| `art/` | Art direction and asset provenance | Updated during asset work |
| `quality/` | Test strategy and release gates | Rarely |
| `pm/` | Roadmap, dependency graph, milestone breakdowns, backlog, risks, PM guide | Updated every task (`/ship`, `/sync-pm`) |
| `status/` | **Where are we right now?** The handoff between sessions | Every session |
| `adr/` | Architecture Decision Records: one file per important decision | `/adr` |
| `process/` | How we work: the session loop, git, multi-agent, Claude setup | When the process changes |
| `prompts/` | Ready-made prompts, now mostly replaced by skills | Rarely |
| `sessions/` | One summary per working session/discussion with Claude | Every session |
| `learning/` | Lesson notes for you, the developer | When a new concept comes up |
| `archive/` | The original spec, never edited | Never |

## Spec section → document mapping

The original 35-section spec was split **verbatim**. Section numbers are kept inside each doc.

| § | Topic | Now lives in |
|---|---|---|
| 1, 2, 4, 5, 18 | Usage, vision, scope, journeys, starter packages | product/PRD.md |
| 3 | Vocabulary and invariants | product/PRODUCT_RULES.md |
| 6, 17 | Interface and isometric rendering | product/UI_SPEC.md |
| 7, 8, 16 | Architecture, repo structure, IPC/events | architecture/ARCHITECTURE.md |
| 9, 10 | Storage, schema, resource packages | architecture/DATA_MODEL.md |
| 11 | AI providers | architecture/AI_PROVIDERS.md |
| 12, 15 | Workflow engine, automations | architecture/WORKFLOW_ENGINE.md |
| 13, 14, 21 | Permissions, integrations, security | architecture/SECURITY.md |
| 19, 20 | Offline/failure, artifacts, backups | architecture/OFFLINE_AND_RECOVERY.md |
| 22 | Verification strategy | quality/TEST_PLAN.md |
| 23 | Milestone roadmap | pm/ROADMAP_SPEC.md (status tracked in pm/ROADMAP.md) |
| 24 | Backlog | pm/BACKLOG.md |
| 25, 29 | Metrics, release gates, checklist | quality/RELEASE_GATES.md |
| 26 | Risks and decision log | pm/RISKS.md (new decisions → adr/) |
| 27, 28 | Copy-ready prompts, handoff template | prompts/ORIGINAL_PROMPTS.md (now → skills; template → status/) |
| 30 | Realm Atlas | architecture/GRAPH_MODEL.md |
| 31 | Interiors | architecture/INTERIORS.md |
| 32 | Obsidian bridge | architecture/OBSIDIAN_BRIDGE.md |
| 33 | Import wizard | architecture/IMPORT_SPEC.md |
| 34 | Art and PixelLab | art/ART_BIBLE.md |
| 35 | References | REFERENCES.md |
