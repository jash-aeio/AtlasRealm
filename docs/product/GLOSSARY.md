# Glossary

Two kinds of terms: **product terms** (what things mean inside Atlas Realm; the authoritative table is in [PRODUCT_RULES.md §3](PRODUCT_RULES.md)) and **developer terms** (concepts you'll meet while building). Claude adds new developer terms here the first time they come up.

## Product terms (quick reference)
| Term | Plain meaning |
|---|---|
| World | A workspace, shown as a village/city/kingdom |
| Project | A goal plus its files, team, tasks and workflows. Shown as a building, but it exists even without one. |
| Agent template / instance | A recruitable role (Guild card) / that role hired into one specific project |
| Skill | Instructions (and assets) that teach an agent how to do something |
| Tool | A callable, permission-controlled capability (e.g. "read project files") |
| Workflow / Run | A reusable procedure / one execution of it |
| Automation | A trigger (schedule) that starts a workflow run |
| Artifact | A real saved output file, with version history |
| Realm Atlas | Upper-right panel: Map (where?) and Connections (how related?) |
| Blueprint mode | Simplified structural view of a project interior |

## Developer terms
| Term | Meaning | Where it shows up |
|---|---|---|
| **ADR** | Architecture Decision Record: a short file explaining one important decision and why | `docs/adr/` |
| **Acceptance criteria** | Checkable statements that define when a task is done | every issue |
| **Branch / PR** | A separate line of work / a request to merge it into `main`, with review | GitHub |
| **CI** | Continuous Integration: automatic checks on every push or PR | `.github/workflows/ci.yml` |
| **Conventional Commits** | A commit message format: `type(scope): summary` | `process/GIT_WORKFLOW.md` |
| **Electron main / preload / renderer** | The privileged Node process / a tiny bridge script / the web page UI (no privileges) | `architecture/ARCHITECTURE.md` §7.2 |
| **IPC** | Inter-Process Communication: messages between renderer and main | §16 |
| **Hook (Claude Code)** | A script the harness runs automatically on events (before a tool runs, at session start…) | `.claude/hooks/` |
| **Idempotent** | Doing it twice has the same effect as doing it once | workflow engine §12.6 |
| **Invariant** | A rule that must *always* hold (e.g. "removing a building never deletes a project") | `PRODUCT_RULES.md` §3.1 |
| **MCP** | Model Context Protocol: a standard way to give AI tools access to external services | `.mcp.json` |
| **Migration** | A versioned script that changes the database schema safely | §9 |
| **Mock** | A fake implementation used in tests (must be labeled as such) | providers |
| **Skill (Claude Code)** | A packaged procedure Claude runs on request, e.g. `/ship` | `.claude/skills/` |
| **Spike** | A short experiment to reduce risk before committing to a design | M0 |
| **Subagent** | A helper Claude with its own context, used for focused tasks | `.claude/agents/` |
| **Worktree** | An extra checkout of the repo on another branch, used for parallel agents | `process/MULTI_AGENT_GUIDE.md` |
| **Zod** | A TypeScript library that validates data at runtime | IPC contracts |
