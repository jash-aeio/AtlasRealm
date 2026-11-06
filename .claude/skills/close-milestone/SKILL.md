---
name: close-milestone
description: Close a milestone. Verifies exit criteria with evidence, tags a release on main, publishes GitHub release notes, updates CHANGELOG/ROADMAP, runs a short retrospective, and prepares the next milestone. Use for /close-milestone Mx.
disable-model-invocation: true
argument-hint: <M0|M1|...>
---

# /close-milestone $ARGUMENTS

## 1. Evidence check
- Read the milestone's **Checks** and **Exit** in `docs/pm/ROADMAP_SPEC.md` and the task table in `docs/pm/milestones/$ARGUMENTS.md`.
- `gh issue list --milestone "$ARGUMENTS" --state all --json number,title,state`. Every issue must be closed or explicitly moved (ask the user).
- For each exit criterion, cite evidence (test, command, manual demo). For anything missing, report what's missing and **stop**. A milestone isn't closed on claims.
- Check the relevant release-gate items in `docs/quality/RELEASE_GATES.md`.

## 2. Confirm with the user
Use AskUserQuestion to show the evidence summary: **Close milestone (Recommended)** / **Not yet**.

## 3. Release
- `git switch main && git pull --ff-only`
- Version: `v0.<N+1>.0-m<N>` (M0 → `v0.1.0-m0`, M1 → `v0.2.0-m1`).
- Move `CHANGELOG.md` `[Unreleased]` entries under the new version heading with today's date. Commit it on a `chore/release-<tag>` branch → PR → ask the user to merge. Then tag the merge commit:
  `git tag -a <tag> -m "<milestone title>"` and `git push origin <tag>` (pushing tags is allowed; pushing to main is not).
- `gh release create <tag> --title "<tag>: <milestone title>" --notes-file <notes>` with highlights, known limitations, and evidence links.
- `gh api -X PATCH repos/jash-aeio/AtlasRealm/milestones/<number> -f state=closed`

## 4. Retrospective (learning)
Append to the session log: **went well / didn't go well / change next time** (3 bullets each max). Review `docs/pm/RISKS.md` and update it.

## 5. Next milestone
Update `docs/pm/ROADMAP.md` and `docs/status/IMPLEMENTATION_STATUS.md`, then suggest running `/plan-milestone <next>`.
