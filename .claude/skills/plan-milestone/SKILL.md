---
name: plan-milestone
description: Break a milestone into half-day-to-one-day GitHub issues with acceptance criteria, dependencies, file ownership and parallel-safe flags; create them on GitHub and update the milestone breakdown and dependency graph. Use for /plan-milestone Mx or when a milestone has no issues yet.
argument-hint: <M1|M2|...>
---

# /plan-milestone $ARGUMENTS

## 1. Inputs
- `docs/pm/ROADMAP_SPEC.md` → the milestone's Build / Checks / Exit.
- `docs/pm/ROADMAP.md` (adjustments from the original roadmap), `docs/pm/DEPENDENCIES.md`.
- The architecture docs the milestone touches. Current code structure (`src/`).
- Lessons from the previous milestone's retrospective (`docs/sessions/`).

## 2. Draft the breakdown
For each task (target ½–1 day; split anything bigger):
- ID `Mx-n`, title, type label, area label
- **Goal** (1–2 sentences) and **acceptance criteria** (checkable, including the relevant spec §22.2 scenarios)
- **Depends on** (IDs), **Files owned** (paths), **Docs to read**
- **parallel-safe**: yes only if no dependency on another open task, its files are disjoint from them, and it adds no concurrent DB migration
- Mark 1–2 tasks `good-first-code` that the user could implement themselves with guidance.
Also list **decisions needed** (these get the `needs-decision` label).

Draw the Mermaid dependency graph and identify the **critical path** and the possible parallel lanes (max 3).

## 3. Review with the user
Present the table and graph. Use AskUserQuestion for any scope question, then **Create issues (Recommended)** / **Adjust first**.

## 4. Create on GitHub
For each task: `gh issue create --title "Mx-n: …" --milestone "$ARGUMENTS" --label … --body-file <tmp>` using the task-template sections. Then add "Depends on #a, #b" with the real numbers. Add the issues to the project board if available (`gh project item-add`).

## 5. Update the docs
- Write `docs/pm/milestones/$ARGUMENTS.md` (goal, exit, decisions, task table with issue numbers, expected lessons).
- Add the task table and graph to `docs/pm/DEPENDENCIES.md`.
- Update `docs/pm/ROADMAP.md` (status ⏳ Planned, issue counts).
- Commit on a `docs/plan-<milestone>` branch and open a PR (or include it in the current task's PR).
