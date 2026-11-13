# Lesson 017: Domain errors across the IPC boundary
**Milestone:** M1 · **Date:** 2026-11-13 · **Related:** `src/main/ipc/router.ts`, `src/main/ipc/repository-errors.ts`, `src/common/contracts/ipc-result.ts`, ADR-0019, ARCHITECTURE §16.1, lesson 012 (expected revisions)

## The concept (plain words)
Not every failure is a bug. "That world doesn't exist" or "someone saved this first" are **expected outcomes** of a well-formed request. A **domain error code** is a short, stable word for one of those outcomes (`not_found`, `revision_conflict`). The UI branches on the code, so the code is part of the contract, just like a field name.

Bugs are different: they become one generic `internal_error`, and the details stay in the main-process log.

## Why Atlas Realm needs it
The renderer is untrusted and only sees what crosses IPC. If every failure looked the same, the UI couldn't offer "reload and try again" after a stale edit (lesson 012). Exposing raw error messages would be worse: they can name tables, file paths or the Windows user name.

## Where it lives in our code
A handler, or the service it calls, throws a `CommandError` with a code and a fixed message:

```ts
// src/main/ipc/router.ts
} catch (error) {
  if (error instanceof CommandError) return { ok: false, error: { code, message, currentRevision } };
  console.error(...);              // a bug: log it, and tell the UI nothing specific
  return fail('internal_error', 'Something went wrong. The error was logged.');
}
```

Repositories have their own codes. `withRepositoryErrors` translates them and **replaces the message** with fixed text:

```ts
// src/main/ipc/commands/world.ts
withRepositoryErrors(() => ({ world: worlds(active).rename(worldId, expectedRevision, name) }));
```

A world ID from another profile isn't in the active database, so it comes back as `not_found`. That is the same answer as for a made-up ID, so nobody can probe whether another profile has a world.

## Common mistakes
- **Forwarding `error.message`.** It was written for developers. Map codes to fixed messages instead.
- **Matching on message text** (`if (msg.includes('revision'))`). Messages change; codes don't.
- **Turning bugs into domain codes.** A `TypeError` must stay `internal_error`, or real bugs hide behind "not found".
- **Different answers for "forbidden" and "missing"** when the difference itself is secret.

## Try it (5–15 min exercise)
1. In `tests/integration/world-contract.test.ts`, find "reports a stale revision with the current one".
2. Change the second `expectedRevision` to `2`, predict the result, then run `corepack pnpm vitest run tests/integration/world-contract.test.ts`.
3. Now make the handler throw `new Error('boom')` and see which code the test receives. Undo afterwards.

## Learn more
- Zod error handling: https://zod.dev/basics#handling-errors
- Electron IPC security: https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages
- OWASP error handling: https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html
