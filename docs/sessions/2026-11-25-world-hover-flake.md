# 2026-11-25: World hover flake (#108)

Branch `chore/108-world-hover-flake`, milestone M3 (lane A, first slice).

## Task

`world.spec.ts` "hover, wheel zoom and middle-drag pan follow the real camera" failed once in
#80's full E2E run. The hover readout stayed idle ("Hover the map to see a tile…") after the
test moved the pointer to the map centre.

## What we found

- The app's hover code was fine: one `pointermove` over the map always sets the readout
  (`src/renderer/world/use-world-scene.ts`, `onPointerMove` → `applyHover`).
- 20 repeats of the graphics tests passed 140/140 before any change, so it couldn't be
  reproduced on demand.
- A throwaway probe spec logged every pointer event on the map host:
  - Covering the window with another window, or minimizing it, did **not** stop the test's
    pointer events (`document.visibilityState` stayed `visible`).
  - Restoring the window under a still cursor delivered a `pointermove` the test never sent.
    The cursor was at screen (528, 816) and the window content started at (328, 173), so that
    event was exactly the real cursor's position in the window (200, 643).
  - With `BrowserWindow.setIgnoreMouseEvents(true)` the stray event didn't arrive, and the
    test's own moves still updated the readout.
- **Root cause:** the test window is a real window on the desktop. The physical mouse's own
  moves and leaves (someone using the computer during a long run, or a window appearing under
  the cursor) reach the page and overwrite Playwright's simulated pointer. A real move off the
  map, or a leave, sets the readout back to idle. That explains why it was rare and why quiet
  reruns passed.

## Fix

In `world.spec.ts`'s `launch()`, the test window ignores OS mouse input
(`setIgnoreMouseEvents(true)`). Playwright sends its pointer straight to the page over CDP
(the Chrome DevTools Protocol, the channel Playwright uses to drive Chromium), so the test's
input still arrives. The fix is in the test, not the app: real users must still be able to use
the mouse.

## Verification

- `world.spec.ts --repeat-each=20`: 380/380 passed (9.5 min).
- typecheck, lint, format:check: pass.
- The probe spec was deleted; it isn't committed. It depended on where the real cursor
  happened to be, so it can't be a reliable regression test.

## Decisions

- Test-only, reversible fix in the issue's owned file, so no ADR. Lesson: [042](../learning/lessons/042-flaky-tests-real-vs-synthetic-input.md).
- Moving the real OS cursor from a script was not used (it was blocked, and it would take over
  the user's mouse). The read-only cursor position plus a window restore gave the same evidence.

## Open questions / follow-ups

- Four other specs use pointer input and have the same risk: `atlas.spec.ts`,
  `atlas-connections.spec.ts`, `m2-acceptance.spec.ts`, `placement.spec.ts`. They are outside
  this issue's files. Proposed follow-up: a shared helper in `tests/e2e/support/` applied in
  each launch.
