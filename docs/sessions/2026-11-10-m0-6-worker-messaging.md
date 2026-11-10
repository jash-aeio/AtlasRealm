# 2026-11-10 · M0-6 worker messaging spike (#9)

## Task
Prove the main process can run trusted work off the main thread: a worker process, request IDs, schema validation, bounded message size, cancellation of in-flight work, and crash detection (issue #9, ARCHITECTURE §7.2, §7.4, WORKFLOW_ENGINE §12.7).

## Plan (approved)
1. Protocol schemas (`src/common/contracts/worker-protocol.ts`), worker dispatcher (`src/worker/`), main-side bridge (`src/main/runtime-bridge/`). Unit tests over an in-memory transport.
2. Real Electron utility process, build entry, an **M0 spike** IPC command `runtime.workerCheck` and a "Worker check (M0 spike)" panel. E2E: round-trip, cancel, kill the worker → crash reported → next check recovers.
3. Packaged smoke test: the worker loads from inside `app.asar` with our fuses on.
4. ADR, lesson, glossary, status.

## Decisions
- **Worker type: Electron `utilityProcess`** (user choice via AskUserQuestion). A separate OS process isolates crashes and gives an exit code. It's Electron's recommended replacement for `child_process.fork` when the RunAsNode fuse is off. `worker_threads` was rejected: it shares the main process (a native crash takes the app down), and Electron APIs aren't available inside it. → ADR-0012.
- Routine (spec defaults): main hands the worker a private `MessagePort`. Only main and the worker hold it, which authenticates the channel without a localhost server (§7.2). Request IDs are random UUIDs. A crash fails every pending request with `worker_crashed`, and work is never replayed automatically ("never blindly repeat"). The next request starts a fresh worker.

- Routine: `runtime.workerCheck` takes an optional, bounded `cancelAfterMs` (10–5000 ms, default 100), so E2E can crash the worker during a known in-flight window. `pendingRequests` was added to the worker status for the same reason.
- ADR: [ADR-0012](../adr/0012-electron-utility-process-worker.md).

## What was done
1. `46d88ce` protocol, dispatcher and bridge, with 15 tests over an in-memory transport. Mutation checks found two weak tests: a size test that the schema already covered (removed) and a stale-worker test that passed with the guard removed (fixed by sending the messages in the other order).
2. `0557d16` real utility process, spike IPC commands and panel. E2E with 5 tests. The tests found three things:
   - Our `serviceName` appears in the metrics' `name` field.
   - A "wait 50 ms, then kill" test was flaky. It now waits for real pending state and uses a 3 s window.
   - The check handler kept waiting its cancel delay after a crash. Fixed with `Promise.race`.
3. `f2e4cd8` packaged smoke test: the worker loads from inside `app.asar` with the fuses on, answering the open question from the plan.
4. Docs: ADR-0012, lesson 010, 7 glossary terms, status, roadmap and changelog.

Housekeeping: a parallel M0-8 session briefly switched this shared checkout to its own branch. The uncommitted M0-6 work was moved back to `spike/9-worker-messaging` before the first commit, and M0-8 now lives in its own worktree.

Electron itself ends utility processes on app exit (seen in E2E), so `worker.stop()` on quit only labels the exit as deliberate. An earlier code comment said the opposite and was corrected.

## Open questions
- `pnpm dev` with the worker wasn't checked by hand (a background dev launch was blocked by the permission check). Try it once: the panel should show "Worker running".
- When real run commands arrive (M4), remove or rate-limit `runtime.workerCheck` and add crash-loop backoff.
