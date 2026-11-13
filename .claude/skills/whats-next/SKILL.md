---
name: whats-next
description: Read-only project status check. Reports where the current milestone stands, what to do next, which tasks can run in parallel and which must run in order. Use for /whats-next, or when the user asks "what's the status", "what's next" or "what can run in parallel".
---

# /whats-next: status, next tasks, parallel lanes

This skill is **read-only**. It never edits files, commits, or changes issue state. To update the docs mirror, the user runs `/sync-pm`.

GitHub and git are the source of truth. The docs (`IMPLEMENTATION_STATUS.md`, milestone files, the session-start hook output) can be out of date. Where they disagree with GitHub, trust GitHub and point out the difference.

## 1. Gather (run these in parallel)
- The current milestone plan: `docs/pm/milestones/<current>.md` (find it from `docs/pm/ROADMAP.md`). Use its task table for dependencies, lanes and `parallel-safe` flags.
- Issues: `gh issue list --milestone "<current>" --state all --limit 50 --json number,title,state,labels,closedAt`
- PRs: `gh pr list --state all --limit 15 --json number,title,headRefName,state,isDraft,mergedAt`
- Local work: `git branch --show-current`, `git status --short`, `git log --oneline main..HEAD`, `git worktree list`, `git branch -a`
- If needed for parallel checks: `docs/pm/DEPENDENCIES.md` and the "file ownership" section of each open issue (`gh issue view <#>`).

## 2. Classify every issue in the milestone
- ✅ **Done**: issue closed or PR merged.
- 🚧 **In progress**: has an open PR, a local or remote branch `*/<#>-*`, or a worktree. Mention committed slices and uncommitted changes.
- 🟢 **Ready**: open, nobody is working on it, and every dependency is ✅.
- ⏳ **Waiting**: open, with at least one dependency not done. Name the blocking issue(s).

## 3. Work out order and parallelism
- **Critical path**: the longest chain of unfinished dependent issues. Every delay on this chain delays the milestone.
- **Can run in parallel**: ready or in-progress issues that don't depend on each other **and** have disjoint files (check the `parallel-safe` label and file ownership). Respect the 3-lane maximum from `docs/process/MULTI_AGENT_GUIDE.md`. If two lanes might touch the same file (for example `src/main/index.ts`, the IPC router, or the renderer root), say so.
- **Must run in order**: dependency chains, and issues without `parallel-safe` that share files.
- Also list small side tasks that fit in a free lane (flaky tests, follow-ups from the status doc).

## 4. Report (short, plain language, no file edits)
Use this format:

```
**<Milestone> — <done>/<total> done**

| Status | Issues |
|---|---|
| ✅ Done | ... |
| 🚧 In progress | ... (branch / worktree, what's left) |
| 🟢 Ready | ... |
| ⏳ Waiting | ... (blocked by #N) |

**Next, in order:** numbered steps
**Parallel now:** lanes that can run at the same time, plus any file-overlap warning
**Must be sequential:** the critical path as #A → #B → #C
**Stale docs:** where the docs or hook disagree with GitHub (suggest /sync-pm)
**Suggested now:** one concrete action (e.g. finish #N and /ship, then /start-task M)
```

Keep it short enough to read in under a minute. Explain any jargon in one plain sentence.
