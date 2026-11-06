---
name: sync-pm
description: Refresh the Markdown project-management mirror (docs/pm/ROADMAP.md, milestone files) from GitHub issues, milestones and PRs. Use for /sync-pm or when the user asks about project progress.
---

# /sync-pm: GitHub → Markdown mirror

GitHub is the source of truth. Only the docs are updated here; never change issue state from this skill.

1. Gather:
   - `gh api repos/jash-aeio/AtlasRealm/milestones?state=all --jq '.[] | {title, number, state, open_issues, closed_issues, due_on}'`
   - `gh issue list --state all --limit 200 --json number,title,state,milestone,labels,closedAt`
   - `gh pr list --state open --json number,title,headRefName,isDraft`
2. Update `docs/pm/ROADMAP.md`:
   - "Last synced" date and current milestone
   - Status emoji and `done/total` per milestone (✅ when the milestone is closed, 🔨 when any issue is in progress or closed, ⏳ when issues exist but none have started)
3. Update the task table in `docs/pm/milestones/<current>.md` with issue numbers and states (✅ closed, 🔨 has an open PR or branch, ⬜ open, ⛔ `blocked`).
4. Print a short progress report for the user: the milestone %, what's ready next (deps closed), what's blocked and why, and which ready tasks are `parallel-safe` (a hint for `/parallel-run`).
5. If the docs changed, commit them on the current feature branch, or on a `docs/sync-pm-<date>` branch with a PR if you're on main.
