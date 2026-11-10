# ADR-0016: Project lifecycle states, and where a restore from trash goes

- **Status:** Accepted
- **Date:** 2026-11-11
- **Milestone(s) affected:** M1 (M1-3 #30, M1-7 #34, M1-10 #37)
- **Decided by:** jash-aeio (asked via AskUserQuestion on 2026-11-11, during #30)

## Context
Schema v2 (#30) stores a project's lifecycle in `projects.status` plus `archived_at` and `trashed_at`. PRD §5.6 separates archive (hide, keep everything) from trash (recoverable removal), and M1 has no permanent delete (M1 decision table). PRODUCT_RULES §3.1 says hiding, archiving and deleting are separate operations. One question was left open: a project can be archived and *then* trashed. When it comes out of the trash, should it go back to Archived or straight to Active?

## Options considered
| Option | Pros | Cons |
|---|---|---|
| **Back to its prior state** (archived if it was archived, else active) | Undo really is undo. A project the user deliberately archived doesn't reappear in active views | `archived_at` must be kept while trashed, and the rule takes one sentence to explain |
| Always to Active | The simplest rule | An archived project the user trashed comes back "live", which reverses a choice they made earlier |

## Decision
We chose **back to its prior state**.
- Statuses are a closed list: `active`, `archived`, `trashed` (a CHECK constraint).
- `active ⇄ archived`. Either of those can be trashed. `trashed` returns to `archived` when `archived_at` is set, else to `active`.
- `archived_at` is kept while a project is in the trash. A table CHECK keeps status and timestamps consistent (e.g. `archived` always has `archived_at` and no `trashed_at`).
- A trashed project can't be renamed or have its goal edited until it's restored (`invalid_transition`).
- No delete method exists. The trash retention and permanent-delete design comes later, with its own decision.

## Consequences
- The project commands (M1-7) and the project list UI (M1-10) can describe a restore truthfully: "Restores to Archived" or "Restores to Active", based on `archivedAt`.
- PRD §5.6's "schedules remain paused until explicitly re-enabled" still applies on any restore, once schedules exist (M6).
- Revisit if users find a restore that lands in Archived confusing (for example, "I restored it but can't see it"). The UI should then say where the project went rather than change the rule.

## Learning note
Soft delete means "mark it as removed, keep the row". It makes undo possible, but undo only feels right if it puts things back exactly where they were. That's why we remember the earlier state instead of guessing.
