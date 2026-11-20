# 2026-11-20: M1 follow-ups as issues, and the flaky router test (#56)

## What happened
- This ran alongside `/plan-milestone M2` in another session. The code work used its own worktree (`AtlasRealm-56`) so the two sessions never shared files.
- **Follow-ups → issues** (your decisions, via AskUserQuestion). Every open M1 follow-up now has an issue with a deadline gate:
  - M2: #56 flaky timing tests, #57 packaged offline test checks a real list, #58 remove `data:` from CSP `img-src` after verifying, #59 refuse project changes inside an archived world (F5).
  - M3 (the planner later moved #60 and #62 to M2, your choice): #60 hidden Unicode in names and goals (gate: before goals reach prompts), #61 profile/world caps on read (gate: before import commit/restore), #62 UI note that profiles aren't encrypted.
  - M4: #63 switch-guard hardening (the argv allowlist is marked needs-decision), #82 the same plain-data gate on worker messages (found in this review).
  - M7: #64 app icon, #65 E2E for the startup error dialogs.
  - Dropped on purpose: a tie-breaker for two worlds created in the same millisecond (only a script can do that; the order is still stable).
- **#56: the flaky router test was a real bug.** Zod 4.6.7 took 3.5 s (idle) to refuse a 10 MB `Uint8Array`. It treats a typed array as an object, and the strict check lists every index as an unknown key. The 64 KiB size limit only ran after Zod. So one message from a compromised renderer could freeze the trusted main process for seconds, and the test's 5 s timeout failed whenever the machine was busy.
  - Fix (your choice: fix the router rather than shrink the test): `checkPlainJson` in `src/common/contracts/json-size.ts` runs before Zod. It refuses non-plain values (typed arrays, Map, Set, Date, class instances, BigInt, functions, nesting over 64, which also catches cycles). It stops once the JSON would be over the limit, or once it has visited more keys and slots than the limit. Its byte count is a lower bound, so valid payloads are never refused as too large.
  - The worker cancellation test now waits for conditions (`vi.waitUntil`) instead of fixed sleeps.
  - Found on the way: Vitest 5's `mockRestore()` clears a spy's call history, so "never called" checks made after restoring always pass. The new tests read counts first.

## Evidence
- typecheck, lint, format:check pass. Unit/integration 736/736, E2E 52/52, packaged E2E 15/15.
- 20 consecutive runs of the three changed test files with all 8 CPU cores busy: 20/20 pass. The old code under the same load: 0/10.
- Mutation checks: disabling the gate fails 7 router tests; removing the per-key step fails the "undefined values" test.

## Decisions
- Router fix inside #56 rather than a test-only change (AskUserQuestion). No ADR: it's a hardening of the existing router checks (ARCHITECTURE §16.1), not a new design.
- Accepted behaviour change (security review L2): the 64 KiB limit now measures the payload **as sent**, before `.trim()`. Only a whitespace-padded `app.ping` (an M0 spike command) over 64 KiB is affected; it is now refused instead of trimmed.

## Open questions
- None new. `ROADMAP.md` and the milestone files were left to the M2 planning PR (#81) to avoid conflicts.

## Lesson
- [Lesson 023: Cheap checks first, and what a flaky test is telling you](../learning/lessons/023-cheap-checks-first-and-flaky-tests.md)
