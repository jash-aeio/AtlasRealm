# Lesson 010: Worker processes, request IDs and cancellation
**Milestone:** M0 · **Date:** 2026-11-10 · **Related:** `src/worker/`, `src/main/runtime-bridge/`, `src/common/contracts/worker-protocol.ts`, ADR-0012, ARCHITECTURE §7.2, WORKFLOW_ENGINE §12.7

## The concept (plain words)
The main process runs windows, IPC and the database. If it gets stuck on long work, the whole app freezes. So long work goes to a **worker**: a separate process that does the job and reports back.

Processes don't share memory. They talk by **message passing**: one side posts a plain-data message and the other receives a copy. That raises three questions:
1. **Which reply belongs to which request?** Every request carries a random **request ID** (a UUID). The reply carries the same ID. Replies can arrive in any order.
2. **How do I stop work that's running?** Send a `cancel` message with the ID. The worker uses an `AbortController` (a standard "please stop" signal) to end the task.
3. **What if the worker dies?** Any request still waiting would wait forever. So we listen for the process's `exit` event and fail every pending request.

## Why Atlas Realm needs it
Agent runs (M4) will be long and can go wrong. One bad run must not freeze or crash the app (§7.2). The spec also says cancelled work must never restart from a late reply (§12.7).

## Where it lives in our code
- `worker-bridge.ts` (main) keeps a `pending` map: ID → who's waiting.
  ```ts
  const id = randomUUID();
  this.#pending.set(id, { method, settle });
  transport.post({ kind: 'request', id, method, payload });
  // on abort: delete from pending, post { kind: 'cancel', id }, answer "cancelled"
  // on exit:  answer every pending entry with "worker_crashed"
  ```
- `dispatcher.ts` (worker) keeps one `AbortController` per running ID. `spike.slowCount` passes the signal into `setTimeout(ms, undefined, { signal })`, so a cancel interrupts it mid-wait.
- `utility-transport.ts` forks the real Electron utility process and hands it a private `MessagePort`.

## Common mistakes
- **Delivering a late reply.** After a cancel, the worker may still answer. The bridge finds no pending entry and drops it (`staleRepliesDropped`).
- **Retrying after a crash.** The work may have been half done. We report the crash and let a person or a later step decide.
- **Trusting the other side.** Both sides validate with Zod and check the size, even though the worker is our own code.
- **Testing with timing guesses.** A "wait 50 ms, then kill" E2E test was flaky. The fix was to watch real state (`pendingRequests`) and give the test a wider window.

## Try it (10 min)
1. Run `pnpm test worker-messaging` and read the test "cancels in-flight work".
2. In `dispatcher.ts`, change `await delay(input.stepMs, undefined, { signal })` to `await delay(input.stepMs)`. Rerun. Which assertion fails, and why? Then undo the change.
3. Run `pnpm dev`, click **Run worker check**, then end the worker using the pid the panel shows (`taskkill /PID <pid> /F` in a terminal) and click **Refresh worker status**. Run the check again: what changed in the status line?

## Learn more
- [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)
- [MDN: AbortController](https://developer.mozilla.org/docs/Web/API/AbortController)
- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
