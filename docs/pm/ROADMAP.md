# Roadmap & progress

> This is the **Markdown mirror** of the GitHub Milestones and [Project board](https://github.com/users/jash-aeio/projects/1). GitHub is the source of truth for issue status. Run `/sync-pm` to refresh this file.
> Full milestone specs (build, checks, exit criteria): [ROADMAP_SPEC.md](ROADMAP_SPEC.md) · Task-level dependency graphs: [DEPENDENCIES.md](DEPENDENCIES.md)

**Last synced:** 2026-11-27 · **Current milestone:** M3 (planned 2026-11-25, 24 issues). M2 closed 2026-11-25 as `v0.3.0-m2`; M1 closed 2026-11-20 as `v0.2.0-m1`; M0 closed 2026-11-10 as `v0.1.0-m0`.

## Progress overview

| Milestone | Goal | Depends on | Status | Issues (done/total) | Tag |
|---|---|---|---|---|---|
| **Setup** | Repo, docs, Claude Code config, GitHub workflow | — | ✅ Done | — | — |
| **M0** | Foundation and risk spikes: packaged Electron app with SQLite, IPC, Pixi, React Flow | Setup | ✅ Done | 9/9 (#20 moved to M1) | [v0.1.0-m0](https://github.com/jash-aeio/AtlasRealm/releases/tag/v0.1.0-m0) |
| **M1** | Profiles, worlds, project persistence (list UI, no canvas) | M0 | ✅ Done | 11/11 (#20, #29–#38) | [v0.2.0-m1](https://github.com/jash-aeio/AtlasRealm/releases/tag/v0.2.0-m1) |
| **M2** | Isometric world, placement, hotbar, library, Atlas shell | M1 | ✅ Done | 21/21 (#56–#60, #62, #66–#80) | [v0.3.0-m2](https://github.com/jash-aeio/AtlasRealm/releases/tag/v0.3.0-m2) |
| **M3** | Bundled resources, permission broker, artifacts, import inspect + commit | M1 (∥ M2) | 🔨 In progress | 4/24 (#108, #111, #119, #61 merged) | — |
| **M4** | Durable runtime, mock + Ollama + Anthropic adapter | M3 | 📋 Backlog | — | — |
| **⭐ Alpha** | *Checkpoint:* packaged app runs one real workflow → real artifact | M2, M4 | 📋 Backlog | — | — |
| **M5** | Full project experience, interiors, starter packages, art pipeline proof | M4 | 📋 Backlog | — | — |
| **M6** | Automations and background runner | M4 + core M5 | 📋 Backlog | — | — |
| **M7** | Backup/restore, recovery, packaging hardening, Obsidian O1 | M5, M6 | 📋 Backlog | — | — |
| **M8** | UI/UX polish and art integration (full PixelLab asset batch) | M7 | 📋 Backlog | — | — |
| **M9** | Provider breadth → **MVP complete** | M8 | 📋 Backlog | — | — |
| M10–M12 | Post-MVP: discovery, integrations, team/business | MVP | 🔭 Later | — | — |

Legend: ✅ Done · 🔨 In progress · ⏳ Planned (issues created) · 📋 Backlog (broken down just in time) · 🔭 Later · ⛔ Blocked

## Changes from the original spec roadmap (§23)
Recorded so the reasons stay visible:
1. **Setup phase added** before M0 (this repository setup).
2. **Import inspection moved out of M1** into separate issues: `IMP-1 inspect` and `IMP-2 commit`. M1 focuses on profiles, worlds and projects. On 2026-11-20 (M2 planning) IMP-1 moved into M3 next to IMP-2, because inspection is only useful once the reviewed commit exists.
3. **Alpha checkpoint** after M4 + M2: the first "real app" moment before the long M5–M9 stretch. It changes no scope.
4. Each milestone is broken into ½–1 day issues **when it starts** (`/plan-milestone`), not all up front. This is just-in-time planning, because later plans improve with what earlier milestones teach.
5. **M8 UI/UX polish and art integration added** on 2026-11-23 ([ADR-0027](../adr/0027-ui-ux-polish-and-art-milestone.md)), so the whole app gets one design, art and accessibility pass before MVP. The original M8–M11 became M9–M12. M5 now only proves the art pipeline with a small slice.

## Current milestone detail
M3: [milestones/M3.md](milestones/M3.md) (planned 2026-11-25; 21 new issues #111–#131 plus #61, #106, #108; graph in [DEPENDENCIES.md](DEPENDENCIES.md#task-level-m3)). The prompt-side part of #106 moved to #132 (M4). Previous: [milestones/M2.md](milestones/M2.md) (closed 2026-11-25, all 21 issues merged; graph in [DEPENDENCIES.md](DEPENDENCIES.md#task-level-m2)), [milestones/M1.md](milestones/M1.md) (closed 2026-11-20), [milestones/M0.md](milestones/M0.md) (closed).
