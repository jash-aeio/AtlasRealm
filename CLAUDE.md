# Atlas Realm: Claude Code project instructions

Atlas Realm is a **local-first Windows desktop app** (Electron + React + TypeScript + Vite, PixiJS world, React Flow Realm Atlas, SQLite) where projects are buildings in a fantasy isometric world and AI agents do bounded, permission-controlled work.

The developer is a **student learning professional development**. Work to industry standards *and* teach along the way.

## Commands
_Filled in during M0-1 (package manager decision pending)._
```
# install:    (tbd)
# dev:        (tbd)
# typecheck:  (tbd)
# lint:       (tbd)
# test:       (tbd)
# package:    (tbd)
```

## Session loop (always)
1. **Orient:** read `docs/status/IMPLEMENTATION_STATUS.md`. Treat its claims as notes to verify against the code.
2. **Scope:** work on one GitHub issue at a time (`/start-task <#>`). If there's no issue, propose creating one.
3. **Explore before editing:** read the relevant code and *only* the relevant docs (see the map below).
4. **Plan** anything non-trivial and get approval before writing code.
5. **Implement in small slices**; one conventional commit per verified slice, on a feature branch.
6. **Verify:** run typecheck/lint/tests and demonstrate the acceptance criteria. Report real results, including failures.
7. **Hand off:** `/ship` updates status, roadmap, session log and lesson note, then opens a PR.

## Asking the user (important)
**Use the AskUserQuestion tool whenever a decision is important**: architecture, adding or replacing a dependency, license, data schema, security/permission behavior, anything that costs money or API usage, scope changes, deviating from the spec, or anything hard to reverse. Put the recommended option first with "(Recommended)" and explain trade-offs in plain language. Record the outcome with `/adr`.
Routine, reversible choices: follow the spec defaults, don't ask, and mention them in the session log.

## Learning mode
- Explain the **why** behind non-obvious choices in 1–3 plain sentences. Define jargon on first use and add new terms to `docs/product/GLOSSARY.md`.
- **At most once per task**, invite the user to write a small, meaningful piece themselves (a function, a test, a validation rule). Leave a `TODO(you):` with hints and explain what to look for. Skip this if the user says they're in a hurry.
- When a task introduces a new concept, write a lesson with `/lesson`.
- Every working session gets a summary in `docs/sessions/YYYY-MM-DD-<topic>.md` (decisions, what was done, open questions), written in plain language.

## Docs map: read only what the task needs
| Task touches | Read |
|---|---|
| any feature | `docs/product/PRODUCT_RULES.md` (§3.1 invariants) |
| shell, IPC, preload, folders | `docs/architecture/ARCHITECTURE.md`, `SECURITY.md` §21.1 |
| DB, migrations, manifests | `docs/architecture/DATA_MODEL.md` |
| world, hotbar, panels | `docs/product/UI_SPEC.md`, `docs/art/ART_BIBLE.md` |
| permissions, files, secrets | `docs/architecture/SECURITY.md` |
| providers | `docs/architecture/AI_PROVIDERS.md` |
| runs, queue, schedules | `docs/architecture/WORKFLOW_ENGINE.md` |
| offline, backup, restore | `docs/architecture/OFFLINE_AND_RECOVERY.md` |
| Atlas / interiors / Obsidian / import | `GRAPH_MODEL.md` / `INTERIORS.md` / `OBSIDIAN_BRIDGE.md` / `IMPORT_SPEC.md` |
| tests, milestone close | `docs/quality/TEST_PLAN.md`, `RELEASE_GATES.md`, `docs/pm/ROADMAP_SPEC.md` |
Full index: `docs/README.md`. Never edit `docs/archive/`.

## Non-negotiable product rules (condensed; full list in PRODUCT_RULES.md)
- Local-first: offline management never depends on a cloud login.
- Projects exist independently of buildings, hotbar slots and avatar position. Removing a representation never deletes a project or stops a run.
- The renderer has **no** direct filesystem, database, shell or secret access. Validate every IPC command (Zod) and authorize every tool/provider operation in trusted services.
- A model response is a proposal until application code validates it. Never blindly repeat an external action with an unknown outcome.
- Community content and imported files are untrusted. No arbitrary scripts or shell execution in the MVP. Imports never run scripts.
- Graph layout and interior positions are cosmetic: they never move files or grant permissions.
- Obsidian and PixelLab are optional; the core app works without them, and bundled assets work offline.
- Persist runs, approvals, schedules and outputs outside UI state.
- Show real status and real artifact files. **Label mocks, placeholders and untested paths.** Never claim something works without evidence.
- No credentials in source, logs, backups, fixtures or renderer state.
- Check current official docs (use the context7 MCP) before using a dependency API; pin versions in the lockfile.

## Git rules
- Never commit to `main` directly. Branch per issue: `feat|fix|docs|chore|spike/<issue#>-<slug>`.
- Conventional Commits (`feat(db): …`). See `docs/process/GIT_WORKFLOW.md`.
- PRs link their issue with `Closes #N`; the user merges. Milestones close with `/close-milestone` (tag + release).
- Hooks block pushing to main, force-pushing, `--no-verify`, and writing secrets. If a hook blocks you, explain why to the user. Don't work around it.

## Multi-agent
Parallel work only for `parallel-safe` issues with disjoint files (`docs/process/MULTI_AGENT_GUIDE.md`); at most 3 lanes, each in its own worktree. Use the project subagents for reviews: `invariant-reviewer`, `security-auditor`, `architect`, `test-engineer`, `docs-scribe`, `researcher`.
