# 2026-11-20 — Refuse project changes inside an archived world (#59, F5)

**Branch:** `fix/59-archived-world-guard` · **Milestone:** M2 (must land before M2-3 #68)

## Task
Open question F5 from M1: projects inside an archived world could still be renamed, re-goaled,
archived/restored and trashed through the `project.*` commands. The user decided (2026-11-20, during
M2 planning) to enforce the rule in the trusted service now instead of waiting for a world-archive UI.

## Plan
1. Add one guard in `ProjectService` that every mutation goes through.
2. Contract tests for each mutation against an archived world, plus reads and a no-change check.

## What was done
- `src/main/services/project-service.ts`: a private `mutable()` helper runs the existing ownership
  check (`owned`) first and then refuses with `invalid_transition` and the exported message
  `ARCHIVED_WORLD_REFUSAL` if the world is archived. Rename, updateGoal, archive, restore, trash and
  restoreFromTrash use it. `get` and `list` are unchanged.
- `tests/integration/project-contract.test.ts`: a new `projects inside an archived world` block. It
  aims each of the six commands at a project in a state where the command would otherwise succeed,
  and checks that every one is refused with the same code and message. It also checks that the
  `projects` rows are byte-for-byte unchanged and no graph entity disappears, that a stale revision
  still gets the archived-world reason, that another world's project is still `not_found`, that
  reads work for all three statuses, and that changes work again after the world is restored.
- Mutation check: with the guard switched off, the two refusal tests fail, so the tests catch the bug.

## Decisions (routine; spec defaults, not asked)
- **Error code:** reuse `invalid_transition`, the same code `project.create` already uses for an
  archived world (ADR-0020). Adding a new code like `world_archived` would change the IPC contract;
  the stable message constant is enough for now.
- **Check order:** ownership → archived world → revision/state. Ownership comes first so a project
  from another world never reveals its state. The world check comes before the revision check, so
  the user is told the real blocker ("restore the world") instead of "reload and try again".
- **No race:** the world check and the update run in the same synchronous call on the main process
  (`node:sqlite` is synchronous), so nothing can archive the world in between. No extra transaction
  is needed.
- The create message ("Restore it before adding projects.") stays as it is, because it's more specific.

## Verification
`pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm format:check` ✅ · `pnpm test` 741/741 ✅ (40 files).

## Open questions
- There is no `world.archive` / `world.restore` IPC command yet, so a world can only become archived
  through the repository (for example a future restore from backup). When a world-archive UI arrives,
  it should explain this rule and offer "restore the world".
