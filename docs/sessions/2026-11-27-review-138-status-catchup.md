# 2026-11-27: Review of PR #138 and status catch-up for #111, #119, #61

## Task
Review PR #138 (#61, list limits, opened by X4stra) and bring the living docs up to date. Main's status doc still said #111 was in review, had no #119 entry and nothing on #61. No issue of its own: a docs-only branch `docs/status-catchup-111-119-61` (GIT_WORKFLOW allows `docs/<slug>`).

## What happened
- Read the PR #138 diff and checked the code it relies on: the world repository already lists in creation order, the database uses `node:sqlite` (so the E2E test can open it directly), and CI runs E2E and packaged E2E.
- Ran two review agents on PR #138:
  - **security-auditor:** nothing blocking. Low 1: `world.list` loads every row, then keeps 100. Low 2: `profiles-index.json` is read with no size cap. Info: the warning repeats on every list call.
  - **invariant-reviewer:** re-ran typecheck, lint, 1440/1440 tests, build and the new E2E spec on the branch, all passing. No code violations. One docs-honesty problem: the PR body and its session log say hidden worlds can be reached "until others are archived", but the app has no world archive command.
- Posted both results as a comment on PR #138 and asked for the wording fix. Did not push to the author's branch.
- Filed **#139** (reach hidden worlds and profiles; needs a decision) and **#140** (bound the two unbounded reads). Both are in M3 and on the board, because they gate restore and import commit (M3-18).
- Status doc: #111 marked merged; #119 gets its entries (components, verification, data, next task) plus three review points that were raised on #137 and are still in the code; #61 gets an "in review" entry with the review results.
- M3 milestone and roadmap: 3/24 merged (#108, #111, #119), #61 in review.
- **After-the-fact security review of #119** (you asked for it). Verdict: not ready for callers. The reviewer reproduced each finding with probe scripts on real NTFS folders (kept in the scratchpad, not the repo):
  - High: a dangling junction inside the root makes `create` build something outside it, with no race needed. I confirmed the cause in `resolveMissing` by reading the code.
  - Medium: the create race leaves a leftover; hard links pass `read`; `ApprovedRoot` can be forged; there are no safe mkdir, list or rename building blocks.
  - Low: the whole drive and the home folder can be approved; error causes keep full paths; the root's identity isn't pinned.
- Filed **#142** (path-policy hardening, M3, on the board). Commented "Depends on #142" on #122, #123, #126 and #128.

## Decisions
| Question | Choice |
|---|---|
| Run the reviews, file the follow-ups, do one docs catch-up PR | You said yes |
| Run security-auditor on #119 after merge | You asked for it |
| File one hardening issue that M3-12 and M3-13 depend on, and add the findings to this PR | You said yes |

Routine choices (no question asked):
- #139 and #140 put in M3, because #61 was a gate before restore and import, and these finish that job. Easy to move.
- #61 recorded as "in review", not merged: the PR isn't merged yet.
- No CHANGELOG change: #61's line belongs in its own PR, and #119 changes nothing users can see.
- The milestone file's issue count (24) isn't changed for #139/#140; `/sync-pm` adds them to the table.

## Why it matters (learning notes)
- **A display list is not an authorization list.** Switching profiles checks the full index on disk, so cutting the list for the screen can't weaken a permission check.
- **Bound before reading.** Slicing after `SELECT *` still loads everything; `LIMIT` and `COUNT(*)` keep a huge restored file from freezing the app.
- **Docs must not promise a feature that doesn't exist.** "Until archived" reads like a way out, but there isn't one yet.
- **"It doesn't exist" and "it can't be resolved" are different.** A broken shortcut can't be resolved, but it is there, and Windows follows it when a file is created. Check with `lstat` (which looks at the name itself) before creating.
- **Review before merge, not after.** #119 merged without a security review, and the problems surfaced only now. Run security-auditor on every PR that touches `src/main/security`.

## Open questions
- #139: archive command, paging or search? Decide when the task starts.
- #142: should hard links be refused outright, or allowed with a visible opt-in (pnpm's `node_modules` is full of them)? Decide when #142 starts.
