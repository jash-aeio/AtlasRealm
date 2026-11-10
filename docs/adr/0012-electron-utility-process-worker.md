# ADR-0012: Electron `utilityProcess` for the trusted worker

- **Status:** Accepted
- **Date:** 2026-11-10
- **Milestone(s) affected:** M0-6 (worker spike), M4 (workflow engine), M6 (automations)
- **Decided by:** jash-aeio (asked via AskUserQuestion on 2026-11-10)

## Context
ARCHITECTURE §7.2 puts a **trusted orchestration worker** next to the main process. CPU-heavy work stays off the main thread. Messaging must have schema validation, bounded sizes, request IDs and cancellation, and no localhost server. Issue #9 had to choose how to run that worker.

Constraints from earlier decisions:
- The packaged app has the **RunAsNode fuse off** (M0-7). This breaks `child_process.fork`, which relies on `ELECTRON_RUN_AS_NODE`.
- `OnlyLoadAppFromAsar` and asar integrity are on, and only `out/**` is packaged.
- The worker is **not** a security sandbox and must never load community code (§7.2).

Evidence (researcher subagent, Electron and electron-vite docs, 2026-11-10):
- `utilityProcess.fork(modulePath, args, options)` starts a Node-capable child process from main after `ready`.
  - `exit` reports the exit code (`GetExitCodeProcess` on Windows), and `kill()` ends the process.
  - `postMessage` can transfer a `MessagePortMain`.
  - The Fuses docs recommend it as the replacement for `child_process.fork` when RunAsNode is off.
- `worker_threads` share the main process. Electron APIs aren't available inside them, and loading native modules in threads is unsafe.
- electron-vite 6 builds a file imported with `?modulePath` as a separate bundle and returns its output path. No extra config is needed.
- **Not documented:** whether `utilityProcess` can load a script inside `app.asar` with OnlyLoadAppFromAsar on. A packaged smoke test checks it (below).

## Options considered
| Option | Pros | Cons |
|---|---|---|
| **`utilityProcess`** | A separate OS process: a crash, busy loop or out-of-memory can't take main down. Exit code for crash detection. Works with RunAsNode off. Electron's recommended API. | Slower to start than a thread. It runs only inside Electron, so the logic needs a fake transport for unit tests. |
| `worker_threads` | Fast to start. Plain Vitest can test it. | Same process: a native crash kills the app. No Electron APIs. Unsafe with native modules. Weaker crash signal. |
| `child_process.fork` | Familiar Node API | Broken by the RunAsNode fuse (M0-7). Re-enabling the fuse would weaken hardening. |

## Decision
We chose **Electron `utilityProcess`** because the worker's main job is to isolate failures: one bad run must not freeze or crash the app. It's also the only option compatible with our fuses.

How it's built (M0-6):
- Main creates a `MessageChannelMain` and sends one end to the worker in a single `connect` message. Only main and the worker hold the port, which authenticates the channel.
- The message logic (`src/worker/dispatcher.ts`, `src/main/runtime-bridge/worker-bridge.ts`) has no Electron imports. Only `utility-transport.ts` and `src/worker/index.ts` touch Electron.

## Consequences
- Crash handling is explicit. A worker exit fails every pending request with `worker_crashed`, increments a crash count and logs. Nothing is retried automatically (PRODUCT_RULES: never blindly repeat an action with an unknown outcome). The next request starts a fresh worker.
- Verified on 2026-11-10: the packaged app runs the worker from inside `app.asar`, at a non-ASCII install path, with nothing unpacked (`tests/e2e-packaged`).
- Electron ends utility processes when the app exits (seen in E2E). We still call `stop()` on `will-quit`, so a deliberate stop isn't recorded as a crash.
- In the metrics, `app.getAppMetrics()` reports our `serviceName` option in the `name` field. Its `serviceName` field is Electron's own (`node.mojom.NodeService`).
- Follow-ups:
  - M4 replaces the spike methods with real orchestration methods, leases and persisted run state. Durable state lives in SQLite (owned by main), never only in the worker.
  - There's no crash-loop backoff yet.
- **Revisit if:**
  - Worker start-up time matters (e.g. many short jobs). Keep one long-lived worker instead.
  - We need many parallel CPU tasks. A worker pool, or threads inside the utility process, could fit.
  - A future Electron version stops loading utility scripts from asar. The packaged test would catch this.

## Learning note
A thread shares its process's fate. A separate process can crash on its own. Since the job here is "don't let one bad task take the app down", process isolation matters more than start-up speed.
