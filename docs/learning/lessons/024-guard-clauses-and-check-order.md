# Lesson 024: Guard clauses in a trusted service: check order and failing closed
**Milestone:** M2 · **Date:** 2026-11-20 · **Related:** `src/main/services/project-service.ts`, `tests/integration/project-contract.test.ts`, issue #59 (F5), ADR-0020, PRODUCT_RULES §3.1

## The concept (plain words)
A **guard clause** is an early "no" at the top of a function: if a rule is broken, throw and stop before anything changes. When one function has several guards, their **order** decides which answer the caller gets, so the order is a design choice, not an accident. A guard should also **fail closed**: if it can't tell whether the rule holds, it refuses instead of letting the change through.

## Why Atlas Realm needs it
The renderer is untrusted (PRODUCT_RULES §3.1), so rules like "you can't edit projects in an archived world" must live in the main process. A disabled button in the UI isn't enough, because a forged IPC message would skip it. Putting the rule in `ProjectService` means every future screen gets it for free.

## Where it lives in our code
`ProjectService.mutable()` runs before each of the six project changes:

```ts
private mutable(projects, worldId, projectId): Project {
  const project = this.owned(projects, worldId, projectId); // 1. is it yours? else not_found
  const world = new WorldRepository(this.db()).get(worldId);
  if (world === undefined) throw new RepositoryError('not_found', …); // fail closed
  if (world.archivedAt !== null) {                          // 2. is the world archived?
    throw new CommandError('invalid_transition', ARCHIVED_WORLD_REFUSAL);
  }
  return project;                                           // 3. the repository then checks the revision
}
```

Why this order:
1. **Ownership first.** Otherwise "this world is archived" could tell someone that a project in another world exists, which is an *information leak*.
2. **Archived before revision.** If both are wrong, "restore the world first" is the real blocker. "Reload and try again" would just fail again.

There's no race between check and change: `node:sqlite` is synchronous, and nothing is awaited between the guard and the write. JavaScript runs one task at a time, so nothing can archive the world in between. This is the opposite of a TOCTOU bug (see the glossary).

## Common mistakes
- Guarding only in the UI (hide the button) and not in the trusted service.
- Writing `if (world && world.archivedAt)`, which lets the change through when the world is missing (fails open).
- Putting the guard in one method and forgetting the other five. A test that loops over every command catches that.
- Adding an `await` between the check and the write, which opens a window for a race.

## Try it (5–15 min exercise)
In `project-contract.test.ts`, the test "refuses every project mutation…" loops over six commands. Temporarily remove `this.mutable` from `restore()` (use `this.owned`) and run `corepack pnpm exec vitest run tests/integration/project-contract.test.ts`. Which assertion fails, and does its message name the command? Then put it back.

## Learn more
- [MDN: Guard clauses via early `return`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/return)
- [OWASP: Failing securely (fail closed)](https://owasp.org/www-community/Fail_securely)
- [MDN: The JavaScript event loop](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Event_loop)
