# Lesson 023: Cheap checks first, and what a flaky test is telling you
**Milestone:** M2 · **Date:** 2026-11-20 · **Related:** `src/main/ipc/router.ts`, `src/common/contracts/json-size.ts`, `tests/integration/ipc-router.test.ts`, `tests/integration/worker-messaging.test.ts`, #56

## The concept (plain words)
A **flaky test** passes sometimes and fails sometimes, with no code change. It's tempting to re-run it until it goes green, or to raise its timeout. Before doing that, ask *why* it is slow or racy. Sometimes the test is wrong. Sometimes it has found a real problem that only shows up under load.

**Cheap checks first** is the rule that untrusted input should meet its cheapest, bounded checks before any expensive work. "Bounded" means the cost has a ceiling, however big the input is. Otherwise an attacker sends a big input and makes your program do a lot of work for free: an **algorithmic-complexity denial of service**.

## Why Atlas Realm needs it
The main process is the trusted part of the app, and the renderer is not (SECURITY.md §21.1). If one IPC message can make the main process busy for seconds, a compromised page can freeze the whole app, including saving runs and approvals.

## Where it lives in our code
The router used to check, in order: sender → Zod schema → size (64 KiB). The test "rejects a huge binary payload" sent a 10 MB `Uint8Array` and failed now and then with a 5 s timeout. Measuring it showed:

```text
Uint8Array of 10,485,760 bytes → zod strictObject.safeParse: 3518 ms (idle), 5.7–7.3 s under load
```

Zod treats a typed array as an "object", and the strict check then lists **every index** as an unknown key. The size limit couldn't help, because it ran *after* Zod. So the flaky test had found a real stall.

The fix puts a bounded gate first (`checkPlainJson`):

```ts
const gate = checkPlainJson(raw, MAX_PAYLOAD_BYTES); // stops after ~64 KiB of work
if (gate === 'not_plain') return fail('invalid_payload', …);  // typed arrays, Map, Date, cycles…
if (gate === 'too_large') return fail('payload_too_large', …);
const parsed = definition.input.safeParse(raw);               // only plain, small data gets here
```

Its byte count is a **lower bound**: it may count fewer bytes than the real JSON, never more. So "too large" is always true, and valid payloads are never refused. The exact size check still runs after Zod.

The worker test was flaky in a different way. It slept a fixed 30 ms and then expected progress. On a busy machine the timers ran late. Now it **waits for the condition** (`vi.waitUntil(() => steps > 0)`). A fixed sleep is still fine when you check that something *stopped*: a slow machine can only make that check weaker, never make it fail.

## Common mistakes
- Raising the timeout until the flaky test passes. Here that would have hidden a real stall.
- Checking an expensive thing (schema, `JSON.stringify`) before a cheap bounded one (type, size).
- Asserting a spy after `mockRestore()`. In Vitest 5, restoring also clears the call history, so `expect(spy).not.toHaveBeenCalled()` always passes (a vacuous pass, see lesson 022). Read `spy.mock.calls.length` first.

## Try it (5–15 min exercise)
In `src/main/ipc/router.ts`, temporarily move the `checkPlainJson` block below `safeParse`. Run `corepack pnpm exec vitest run tests/integration/ipc-router.test.ts`. Which tests fail, and how long does the 10 MB test take? Then put it back.

## Learn more
- OWASP, Denial of Service cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html
- Vitest, `vi.waitUntil`: https://vitest.dev/api/vi.html#vi-waituntil
