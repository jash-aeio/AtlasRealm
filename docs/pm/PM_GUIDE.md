# Project management guide (learning doc)

How Atlas Realm is managed, and why each practice is used in real teams.

## The tools
| Tool | What it is | Where |
|---|---|---|
| **Issues** | One unit of work (a task, bug, or spike) | GitHub → Issues |
| **Milestones** | A group of issues that together deliver a demo-able outcome | GitHub → Issues → Milestones |
| **Labels** | Tags for filtering (`type:`, `area:`, `parallel-safe`, `blocked`…) | GitHub → Labels |
| **Project board** | A Kanban view of all issues: Backlog → Ready → In Progress → In Review → Done | GitHub → Projects → "Atlas Realm Roadmap" |
| **Markdown mirror** | `docs/pm/ROADMAP.md`, so you (and Claude) can see progress offline and in the repo | `/sync-pm` |
| **Dependency graph** | What blocks what, and so what can run in parallel | `docs/pm/DEPENDENCIES.md` |

## The lifecycle of a task
```
Backlog ──(acceptance criteria written, deps clear)──▶ Ready
Ready ──(/start-task)──▶ In Progress ──(/ship opens PR)──▶ In Review ──(you merge)──▶ Done
```
`Closes #N` in a PR moves the issue to Done automatically when you merge.

## Key PM concepts
- **Scope:** what's in and what's out. The spec's "Later expansions" table protects scope. When a new idea comes up, put it in `BACKLOG.md` instead of building it now.
- **Just-in-time planning:** only the *current* milestone is broken into detailed tasks. Later milestones stay coarse, because you'll know more by then.
- **Critical path:** the longest chain of dependent tasks. It decides how fast a milestone can finish. Parallel work only helps on tasks *off* the critical path.
- **Definition of Done:** a shared checklist so "done" means the same thing every time (see `process/DEVELOPMENT_WORKFLOW.md`).
- **Risk register:** `RISKS.md`. Known risks and how we respond to them. Review it at each milestone close.
- **Retrospective:** at milestone close, write 3 bullets in the session log: what went well, what didn't, and what to change. This is the habit that makes teams improve.

## Measuring progress
- Issues done / total per milestone (ROADMAP table)
- Milestone exit criteria proven (not just issues closed)
- Optional later: time per issue, so you learn to estimate. Write your guess on the issue *before* starting, and compare after.

## Your weekly routine (suggested)
1. `/sync-pm` → look at ROADMAP.md and the board.
2. Pick the next Ready issue (or run `/parallel-run` if several are ready).
3. At the end of the week, skim `docs/sessions/` and `docs/learning/` to review what you learned.
