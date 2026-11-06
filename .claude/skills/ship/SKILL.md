---
name: ship
description: Finish a task. Runs checks, reviews against invariants and security, updates status/roadmap/session/lesson docs, commits, pushes the feature branch, and opens a PR linked to the issue. Use when a slice or task is verified and ready for review, or the user says /ship.
argument-hint: "[issue number, optional]"
---

# /ship: verify, document, commit, open PR

Never run on `main`. If the current branch is `main`, stop and tell the user.

## 1. Verify (report real output and never hide failures)
- Run the project's typecheck, lint and test commands (see CLAUDE.md "Commands"). Before M0-1 there are none, so say so.
- Walk through each acceptance criterion of the issue and give its **evidence**: a test name, command output, or manual steps performed.
- If anything fails, stop. Fix it or report it. Don't open a PR with failing checks unless the user explicitly asks for a draft PR.

## 2. Review
- Get the diff (`git diff main...HEAD` plus uncommitted changes).
- Run the **invariant-reviewer** subagent on the diff.
- If the diff touches `src/main`, `src/preload`, IPC contracts, file access, credentials, providers, or imports, also run **security-auditor**.
- Fix confirmed issues. List any you decide not to fix, with the reason.

## 3. Update docs (use the docs-scribe subagent for routine edits if helpful)
- `docs/status/IMPLEMENTATION_STATUS.md`: what works + evidence, changed components, verification, known limits, data/schema changes, decisions, **next task**.
- `docs/pm/ROADMAP.md`: issue counts / status for the milestone.
- `docs/sessions/<date>-<slug>.md`: what was done, decisions (with ADR links), open questions, and what the user wrote themselves.
- A lesson note (`/lesson`) if a new concept came up. Add new terms to `docs/product/GLOSSARY.md`.
- `CHANGELOG.md` → `[Unreleased]` entry for user-visible changes.

## 4. Commit and push
- Stage intentionally (no stray files). Conventional commit(s), e.g. `feat(db): add migration runner`, ending with the Co-Authored-By line from the session's attribution instructions.
- `git push -u origin <branch>`

## 5. Open the PR
`gh pr create --base main --title "<conventional title>" --body-file <tmp>`, filling `.github/pull_request_template.md`:
summary, `Closes #<issue>`, acceptance-criteria evidence, tests run, screenshots if UI, risks/limits, docs updated, and a "What to look at when reviewing" section written for a learner.
Move the project item to **In Review** if possible.

## 6. Report
Tell the user: the PR link, CI status (`gh pr checks`), what to review, and how to merge (Squash and merge, then delete the branch). The user merges; never merge it yourself unless asked.
