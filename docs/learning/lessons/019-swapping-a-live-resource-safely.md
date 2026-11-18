# Lesson 019: Swapping a live resource safely (gates, ordering, reloads)
**Milestone:** M1 · **Date:** 2026-11-18 · **Related:** `src/main/services/profile-session.ts`, `src/main/profiles/active-profile.ts`, `src/main/runtime-bridge/worker-bridge.ts`, ADR-0014, ADR-0021

## The concept (plain words)
A profile switch replaces things that are in use right now: the open database, the background worker and everything the UI is showing. Three ideas make that safe.

1. **Prepare before you let go (make-before-break).** Open the new database *first*. Only when it is fully ready do you close the old one. If opening fails, nothing has been lost, because the old one was never closed.
2. **A gate.** While the swap runs, every incoming request is refused with a clear code (`profile_switching`) instead of running against something half-swapped. Refusing beats queueing: a queued request was meant for the old profile and might run on the new one.
3. **Throw state away instead of cleaning it.** Instead of remembering to clear every UI store, the window reloads. A fresh page can't remember the old profile.

## Why Atlas Realm needs it
TEST_PLAN §22.2 #23 says one profile's projects and settings must never leak into another. PRODUCT_RULES says never fall back to an empty database, and never blindly repeat work with an unknown outcome. The switch has to satisfy all three, even when the target profile is damaged.

## Where it lives in our code
```ts
// src/main/services/profile-session.ts (simplified)
if (!active.beginSwitch()) throw profileSwitchingError();      // close the gate
const opened = await openProfile(userDataDir, target);         // make...
await writeProfilesIndex(userDataDir, { ...index, lastUsedProfileId: target });
worker.pause();            // pending requests fail with worker_stopped, never retried
current.db.close();                                           // ...before break
active.replace({ profileId: target, db: opened.db });
worker.resume();
// reply, then reload the window; the gate opens once the old page is gone
```
If `openProfile` throws, the code before `worker.pause()` simply stops. The old database is still open, the worker never stopped, and the index is unchanged.

The gate has two layers. `refuseWhileSwitching` wraps every IPC handler, so new requests are refused. `ActiveProfile.current()` throws too, which covers a handler that was already running when the switch began.

## Common mistakes
- **Break-before-make.** Closing the old resource first means a failure leaves you with nothing, plus recovery code that can fail too.
- **Opening the gate too early.** If requests are allowed again before the old page is gone, that page can act on the new profile with stale state.
- **Gates that never open.** Always open in `finally`, and use a timeout when you wait for an outside event such as a reload.
- **Retrying the old worker's requests on the new worker.** Their outcome is unknown, so they fail visibly instead.

## Try it (5–15 min exercise)
1. In `src/main/profiles/active-profile.ts`, change `refuseWhileSwitching` so it never throws.
2. Run `corepack pnpm vitest run tests/integration/profile-switch.test.ts` and read which tests fail and why.
3. Undo the change. Then, in `profile-session.ts`, move `this.#worker.pause()` above the `openProfile` call, and see which "cannot be opened" test catches it.

## Learn more
- Electron `webContents` navigation events: https://www.electronjs.org/docs/latest/api/web-contents#navigation-events
- Martin Fowler on blue-green deployment (the same make-before-break idea at server scale): https://martinfowler.com/bliki/BlueGreenDeployment.html
