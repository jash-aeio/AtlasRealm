# Lesson 012: Optimistic concurrency and soft delete
**Milestone:** M1 · **Date:** 2026-11-11 · **Related:** `src/main/storage/repositories/repository-support.ts` (`guardedUpdate`), `project-repository.ts`, migration 2, ADR-0016, DATA_MODEL §9.2, PRD §5.6

## The concept (plain words)
**Optimistic concurrency.** Every row has a `revision` number. When you read a project you also get its revision, say 3. When you save, you say "change it, *but only if* it's still revision 3". If someone else saved in between, the revision is now 4, your save changes nothing, and you get a `revision_conflict` error. It's called *optimistic* because nothing is locked while you edit: you assume conflicts are rare and check for one at the moment you save.

**Soft delete.** Instead of `DELETE`, you mark the row: `status = 'trashed'`, `trashed_at = now`. The data stays, so undo is just another update.

## Why Atlas Realm needs it
- Two windows, or a window plus a background run, can edit the same project. Without a revision check the later save silently overwrites the earlier one (a **lost update**).
- PRD §5.6 promises a recoverable trash, and PRODUCT_RULES §3.1 says archiving and deleting are different. A real `DELETE` would make both impossible.

## Where it lives in our code
Each update is one SQL statement, so it's atomic without a transaction:
```sql
UPDATE projects
SET name = :name, updated_at = :updated_at, revision = revision + 1
WHERE id = :key AND revision = :expected_revision AND (status <> 'trashed')
RETURNING *
```
If no row comes back, `guardedUpdate` reads the row once to explain why: the row is missing (`not_found`), its revision moved on (`revision_conflict`, with `currentRevision`), or its status forbids the change (`invalid_transition`). Nothing was written in any of those cases.

The database also guards itself. A CHECK makes `status` and the timestamps agree, so `archived` without `archived_at` is impossible even through raw SQL.

## Common mistakes
- Reading the revision, then checking it in JavaScript, then updating. Something can change between those steps. Put the check *in* the `WHERE`.
- Forgetting `revision = revision + 1`, so the next stale write still matches.
- Retrying a conflict automatically with the old data. Reload, show the user, and let them decide.
- Soft-deleting but forgetting to filter: lists must say which statuses they want (`listByWorld(worldId, ['active'])`).

## Try it (5–15 min exercise)
In `tests/integration/storage-project-repository.test.ts`, write a test where "window A" and "window B" both `get()` the same project (revision 1). A renames it, then B sets the goal using revision 1. Predict which error B gets and what `currentRevision` is, then run `corepack pnpm test storage-project`.

## Learn more
- SQLite `RETURNING`: https://www.sqlite.org/lang_returning.html
- SQLite CHECK constraints: https://www.sqlite.org/lang_createtable.html#check_constraints
- Martin Fowler, "Optimistic Offline Lock": https://martinfowler.com/eaaCatalog/optimisticOfflineLock.html
