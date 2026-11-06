# Git & GitHub workflow

We use **GitHub Flow**: a protected `main` branch, short-lived feature branches, and Pull Requests. This is the most common workflow in professional teams.

## Branches
| Branch | Purpose | Example |
|---|---|---|
| `main` | Always working, protected. Changes arrive **only** through PRs. | — |
| `feat/<issue>-<slug>` | New feature or task | `feat/12-sqlite-migrations` |
| `fix/<issue>-<slug>` | Bug fix | `fix/31-hotbar-overwrite` |
| `docs/<slug>` | Docs-only change | `docs/update-roadmap` |
| `chore/<slug>` | Tooling, deps, config | `chore/eslint-config` |
| `spike/<issue>-<slug>` | Experiment to answer a question (may be thrown away) | `spike/9-react-flow-perf` |

## Commits: Conventional Commits
Format: `type(scope): short summary in the imperative mood`

```
feat(db): add migration runner with pre-migration backup
fix(world): revalidate placement in command handler
docs(adr): record SQLite binding decision
test(ipc): reject forged renderer commands
chore(deps): bump electron to 3x.y
```
Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`, `build`.
Commits made by Claude end with a `Co-Authored-By: Claude …` line, so the history is honest about AI involvement.

> **Why:** consistent messages make the history readable and make CHANGELOG writing almost automatic.

## Commit frequency
- **One commit per verified slice.** Small commits are easy to review and easy to revert.
- Never commit broken code to a shared branch on purpose. On your feature branch, a `wip:` commit is fine before switching tasks.

## Pull Requests
1. `/ship` pushes the branch and opens a PR using `.github/pull_request_template.md`.
2. The PR description links the issue with `Closes #N`, which closes the issue automatically on merge.
3. **CI** (`.github/workflows/ci.yml`) must pass.
4. You read the diff on GitHub, leave comments if anything is unclear, then **Squash and merge** (one clean commit on `main`).
5. Delete the branch after merging (GitHub offers a button).

## Milestones, tags, and releases
- When a milestone's exit criteria are proven, `/close-milestone Mx` tags `main` (`v0.1.0-m0`, `v0.2.0-m1`, …), creates a GitHub Release with notes, and updates `CHANGELOG.md`.
- Version scheme before 1.0: `0.<milestone+1>.<patch>`.

## Safety rails (enforced by hooks, not just rules)
The `guard-bash` hook blocks these. They need a human to run them deliberately:
- pushing directly to `main`/`master`
- `git push --force` (use `--force-with-lease` on your *own* feature branch if you must)
- committing while on `main`
- `--no-verify` (skipping git hooks)

Branch protection on GitHub enforces the same rules server-side.

## Useful commands (learning)
```bash
git status                    # what changed?
git switch -c feat/12-thing   # new branch
git log --oneline --graph -15 # recent history
gh issue list --milestone M0  # tasks in M0
gh pr status                  # my PRs
gh pr checks                  # CI status of the current PR
```
