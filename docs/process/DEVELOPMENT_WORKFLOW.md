# Development workflow (AI-assisted)

This is **how we build Atlas Realm with Claude Code**. It follows the standard practice for AI-assisted development: *spec → small task → plan → implement → verify → document → review → merge*.

> **Why this matters (learning note):** AI produces code fast, so the hard part is keeping it *correct and understandable*. Each step below is a checkpoint where a mistake gets caught early, while it's still cheap to fix.

---

## 1. The layers of planning

```
Product spec (docs/product, docs/architecture)     ← WHAT and WHY (rarely changes)
   └─ Milestone (M0, M1, …)  docs/pm/ROADMAP.md     ← a demo-able outcome, about 1–3 weeks
        └─ Task = GitHub Issue                      ← about half a day to one day, one PR
             └─ Slice = one commit                  ← one small verified step
```

- A **milestone** has *exit criteria* (copied from the spec, §23).
- A **task** has *acceptance criteria*: checkable statements like "creating a project then restarting shows it in the library."
- A **slice** is the smallest change that still leaves the app working.

## 2. Definition of Ready (before starting a task)
A task is ready when:
- [ ] It's a GitHub Issue with a clear goal and **acceptance criteria**
- [ ] All its `Depends on` issues are merged
- [ ] The docs to read are listed
- [ ] Open decisions are resolved (no `needs-decision` label)

## 3. The session loop

Every Claude Code session follows this loop:

| Step | What happens | Tool / command |
|---|---|---|
| 0. Orient | Claude reads `docs/status/IMPLEMENTATION_STATUS.md` (the SessionStart hook shows a summary) | automatic |
| 1. (Optional) Refine | You turn a rough idea into a clear request | `/refine <idea>` |
| 2. Start | Pick an issue, check its dependencies, create a branch, write a short plan | `/start-task <#>` |
| 3. Explore | Claude reads the relevant code and docs before editing | — |
| 4. Plan | For anything non-trivial: a plan you approve (Plan Mode, `Shift+Tab`) | Plan Mode |
| 5. Implement | Small slices; one commit per verified slice | — |
| 6. Verify | Tests, typecheck, lint, and actually running the feature | `pnpm test` etc. |
| 7. Review | Subagents check product invariants and security | `invariant-reviewer`, `security-auditor` |
| 8. Ship | Update docs, push the branch, open a PR | `/ship` |
| 9. Merge | **You** review the PR on GitHub and merge once CI is green | GitHub |

**Important decisions** (architecture, dependencies, scope, security, cost, anything hard to undo) are always asked through a multiple-choice question with a recommended option. Small reversible choices follow the spec defaults and get noted in the session log.

## 4. Definition of Done (before a PR is opened)
- [ ] Every acceptance criterion is shown to work, with evidence (test name, command output, or manual steps)
- [ ] `typecheck`, `lint`, and `test` pass locally
- [ ] New risky behavior has a focused test (see `docs/quality/TEST_PLAN.md`)
- [ ] No secrets, no unlabeled mocks, no claims without evidence
- [ ] `docs/status/IMPLEMENTATION_STATUS.md` updated (what works, evidence, limits, next task)
- [ ] Session log written in `docs/sessions/`
- [ ] Lesson note added if a new concept came up
- [ ] An ADR exists for any important decision
- [ ] Conventional commits on a feature branch; PR links the issue (`Closes #N`)

## 5. Honesty rules (from the spec)
- Label mock providers, placeholders, and untested paths **explicitly**.
- "Done" means the code exists *and* was demonstrated, not that an agent said so.
- Earlier completion claims are notes to re-check, not facts.

## 6. When things go wrong
- **Tests fail:** fix them, or report the failure honestly. Never delete a test to make it pass.
- **A task is bigger than expected:** stop, split the issue (`/plan-milestone` can help), and ship the part that's done.
- **The spec seems wrong:** don't silently deviate. Raise it as a question and record the outcome in an ADR.
- **Claude goes off track:** press `Esc` to interrupt, or `Esc Esc` to rewind. Rewinding is a normal part of working with AI.

## 7. Context hygiene (keeping Claude sharp)
- One task per session when possible. Use `/clear` between unrelated tasks.
- Point Claude at specific docs ("read GRAPH_MODEL.md §30.4") instead of "read everything."
- Long sessions get compacted automatically. The status doc and session log are what carry the work over to the next session.
