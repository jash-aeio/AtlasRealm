# Lesson 015: Paired writes, savepoints and tombstones
**Milestone:** M1 · **Date:** 2026-11-13 · **Related:** `src/main/storage/database.ts`, `repositories/graph-entity-repository.ts`, migration 3, ADR-0018, GRAPH_MODEL §30.5

## The concept (plain words)
Some writes only make sense together. A project without its graph entity is a hole in the Realm Atlas, and an entity without its project points at nothing. A **transaction** makes them all-or-nothing: if the second write fails, the first is undone too.

Transactions don't nest in SQLite: `BEGIN` inside a `BEGIN` is an error. A **savepoint** is the nestable version, a named checkpoint inside a transaction. `ROLLBACK TO` undoes only the writes since the checkpoint, and the outer transaction carries on. `RELEASE` keeps them as part of the outer transaction.

A **tombstone** marks a row as gone (here, a timestamp) without deleting it. The graph can hide the node, and restoring brings back the same ID.

## Why Atlas Realm needs it
- Every world and project must have a graph entity from day one (spec §23 M1), so the Atlas and imports never have to add IDs to old data later.
- Repositories pair their own writes, and the M1-7 services will group several repository calls into one bigger action. Savepoints let both work at once.
- Nothing is deleted in M1. Trash is reversible, so the graph node is tombstoned, not removed.

## Where it lives in our code
```ts
// project-repository.ts (simplified): two writes, one unit
return withSavepoint(this.db, (db) => {
  const project = toProject(insertProjectRow(db));      // write 1
  this.graph.createForProject(project.id, project.worldId, at); // write 2
  return project;
});
```
`withSavepoint` (`database.ts`) calls `withTransaction` when no transaction is open. Inside one, it runs `SAVEPOINT nested_write` … `RELEASE nested_write`, or `ROLLBACK TO nested_write` if `work` throws.

The tests prove it by forcing write 2 to fail: they queue an entity ID that already exists (`storage-graph-entity-repository.test.ts`, "saves no project if its entity cannot be saved"). A *mutation check* (removing the transaction on purpose) made exactly those tests fail.

## Common mistakes
- Opening a second `BEGIN` inside a transaction, or catching an error and carrying on as if the half-done write never happened.
- Using `DELETE` for "remove from view". The ID is lost, so links and history break.
- Storing layout (x/y) on the entity. Positions are cosmetic and change all the time, while identity must not.
- `await` inside a transaction. Other code would run while it is still open, so our helpers refuse promises.

## Try it (5–15 min exercise)
In the test file, write a test that creates a world inside `withTransaction`, then creates a project whose entity insert fails (queue a taken entity ID), catches that error, and commits. Predict the counts of `worlds`, `projects` and `graph_entities` first, then run `corepack pnpm vitest run tests/integration/storage-graph`.

## Learn more
- SQLite SAVEPOINT: https://www.sqlite.org/lang_savepoint.html
- SQLite transactions: https://www.sqlite.org/lang_transaction.html
