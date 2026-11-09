---
name: start-task
description: Begin work on a GitHub issue. Checks readiness and dependencies, creates the feature branch, moves the issue to In Progress, and writes a plan. Use when the user says "start issue N", "work on #N", or /start-task.
argument-hint: <issue number>
---

# /start-task $ARGUMENTS

## 1. Load the task
- `gh issue view $ARGUMENTS --json number,title,body,labels,milestone,state`
- Read `docs/status/IMPLEMENTATION_STATUS.md` and `docs/pm/milestones/<milestone>.md`.
- Read the original milestone prompt mapped in `docs/prompts/PROMPTS.md` → `docs/prompts/ORIGINAL_PROMPTS.md`.

## 2. Definition of Ready check
Verify, and report any failure clearly:
- [ ] Acceptance criteria exist (if missing, draft them and ask the user to confirm)
- [ ] Every "Depends on" issue is closed (`gh issue view <n> --json state`). If not, stop and suggest a ready task instead.
- [ ] No `needs-decision` label. If there is one, run the decision through **AskUserQuestion** first and record it with `/adr`.

## 3. Branch
- Make sure the working tree is clean (`git status`). If it isn't, ask the user what to do.
- `git switch main && git pull --ff-only`
- `git switch -c <type>/<issue#>-<short-slug>`, where type comes from the label (`feat`, `fix`, `docs`, `chore`, `spike`).

## 4. Track it
- Comment on the issue: "Started on branch `<branch>`."
- If a GitHub Project exists, move the item to **In Progress** (`gh project item-list` / `gh project item-edit`). Skip quietly if the project scope is unavailable.

## 5. Plan
- Read only the docs listed on the issue plus the relevant code.
- For non-trivial work, present a plan (files to change, slices/commits, tests, how each acceptance criterion will be shown to work) and wait for approval.
- Claude implements everything in the plan; no pieces are set aside for the user to write. Raise open questions with AskUserQuestion.
- Create or append the session log `docs/sessions/<YYYY-MM-DD>-<slug>.md` with: task, plan, and decisions so far.

Then implement in small verified slices, one conventional commit each. Finish with `/ship`.
