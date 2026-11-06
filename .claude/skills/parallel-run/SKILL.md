---
name: parallel-run
description: Multi-agent development. Finds ready, parallel-safe issues, proposes up to 3 lanes with disjoint files, and after the user confirms runs one subagent per lane in its own git worktree, then integrates the results. Use for /parallel-run or when the user wants tasks done simultaneously.
disable-model-invocation: true
argument-hint: "[milestone, optional]"
---

# /parallel-run: coordinated multi-agent work

Read `docs/process/MULTI_AGENT_GUIDE.md` first. You are the **integrator**.

## 1. Find candidates
- Open issues in the current milestone: `gh issue list --milestone <M> --state open --json number,title,labels,body`.
- **Ready** = every "Depends on" issue is closed. Candidates must also carry `parallel-safe`.
- Using "Files owned" from `docs/pm/DEPENDENCIES.md` and the issues, group them into **at most 3 lanes** with no overlapping files and no concurrent migrations. Shared contracts must already exist on `main`.

## 2. Propose and confirm
Show a table (lane, issues, files owned, expected output, risk of conflict) plus a note on usage cost (each lane is a full agent).
AskUserQuestion: **Run these lanes (Recommended)** / **Run fewer lanes** / **Do them one at a time instead**.

## 3. Launch
For each lane, start an `Agent` with `isolation: "worktree"` (general-purpose, or `test-engineer` for test-only lanes). Run them in the background, in a single message so they go in parallel. Give each agent a self-contained prompt:
- the issue number(s) and full acceptance criteria
- its **files owned**, plus the instruction "do not edit files outside this list. If you must, stop and report."
- read CLAUDE.md, the listed docs, and the session loop; create branch `<type>/<issue#>-<slug>` in its worktree
- verify (typecheck/lint/tests), commit with conventional commits, push the branch, open a PR with `Closes #N`
- report back: PR URL, evidence per criterion, deviations, anything left undone

## 4. Integrate
As agents finish (don't poll, wait for notifications):
- Review each PR diff, run **invariant-reviewer** (and **security-auditor** where relevant).
- Recommend a merge order (dependencies first). After the user merges each PR, rebase the remaining branches if needed and re-run the tests.
- If two lanes conflicted, resolve the conflict deliberately and note it.

## 5. Record the learning
Add to the session log: lanes run, time taken, conflicts, and whether parallel actually beat serial. Update ROADMAP via `/sync-pm`.
