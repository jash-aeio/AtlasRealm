# Roadmap & progress

> This is the **Markdown mirror** of the GitHub Milestones and [Project board](https://github.com/users/jash-aeio/projects/1). GitHub is the source of truth for issue status. Run `/sync-pm` to refresh this file.
> Full milestone specs (build, checks, exit criteria): [ROADMAP_SPEC.md](ROADMAP_SPEC.md) · Task-level dependency graphs: [DEPENDENCIES.md](DEPENDENCIES.md)

**Last synced:** 2026-11-13 · **Current milestone:** M1 (in progress: 11 issues). M0 closed 2026-11-10 as `v0.1.0-m0`.

## Progress overview

| Milestone | Goal | Depends on | Status | Issues (done/total) | Tag |
|---|---|---|---|---|---|
| **Setup** | Repo, docs, Claude Code config, GitHub workflow | — | ✅ Done | — | — |
| **M0** | Foundation and risk spikes: packaged Electron app with SQLite, IPC, Pixi, React Flow | Setup | ✅ Done | 9/9 (#20 moved to M1) | [v0.1.0-m0](https://github.com/jash-aeio/AtlasRealm/releases/tag/v0.1.0-m0) |
| **M1** | Profiles, worlds, project persistence (list UI, no canvas) | M0 | 🔨 In progress | 6/11 (#20, #29–#33 done; #34 in review; #35–#38 open) | — |
| **M2** | Isometric world, placement, hotbar, library, Atlas shell | M1 | 📋 Backlog | — | — |
| **M3** | Bundled resources, permission broker, artifacts, import commit | M1 (∥ M2) | 📋 Backlog | — | — |
| **M4** | Durable runtime, mock + Ollama + Anthropic adapter | M3 | 📋 Backlog | — | — |
| **⭐ Alpha** | *Checkpoint:* packaged app runs one real workflow → real artifact | M2, M4 | 📋 Backlog | — | — |
| **M5** | Full project experience, interiors, starter packages, assets | M4 | 📋 Backlog | — | — |
| **M6** | Automations and background runner | M4 + core M5 | 📋 Backlog | — | — |
| **M7** | Backup/restore, recovery, packaging hardening, Obsidian O1 | M5, M6 | 📋 Backlog | — | — |
| **M8** | Provider breadth → **MVP complete** | M7 | 📋 Backlog | — | — |
| M9–M11 | Post-MVP: discovery, integrations, team/business | MVP | 🔭 Later | — | — |

Legend: ✅ Done · 🔨 In progress · ⏳ Planned (issues created) · 📋 Backlog (broken down just in time) · 🔭 Later · ⛔ Blocked

## Changes from the original spec roadmap (§23)
Recorded so the reasons stay visible:
1. **Setup phase added** before M0 (this repository setup).
2. **Import inspection moved out of M1** into separate issues: `IMP-1 inspect` (after M1, can run parallel to M2) and `IMP-2 commit` (in M3, as the spec already says). M1 focuses on profiles, worlds and projects.
3. **Alpha checkpoint** after M4 + M2: the first "real app" moment before the long M5–M8 stretch. It changes no scope.
4. Each milestone is broken into ½–1 day issues **when it starts** (`/plan-milestone`), not all up front. This is just-in-time planning, because later plans improve with what earlier milestones teach.

## Current milestone detail
[milestones/M1.md](milestones/M1.md): 11 issues, critical path M1-1 (#20) → M1-2 → M1-6 → M1-7 → M1-10 → M1-11. Done: #20, #29–#33. In review: #34 (M1-7). Ready next (all dependencies closed): #35 (M1-8), #36 (M1-9). Blocked: #37 (needs #34, #36), #38 (needs #35, #37). Previous: [milestones/M0.md](milestones/M0.md) (closed).
