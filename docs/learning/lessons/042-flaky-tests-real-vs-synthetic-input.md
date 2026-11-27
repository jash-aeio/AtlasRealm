# Lesson 042: Finding a flaky test's cause: real vs synthetic input
**Milestone:** M3 · **Date:** 2026-11-25 · **Related:** `tests/e2e/world.spec.ts`, issue #108, lesson 041

## The concept (plain words)
A **flaky test** passes most of the time and fails now and then with no code change. Rerunning
it until it goes green hides the problem. The useful question is: *what was different on the run
that failed?*

Here the difference was a person. Playwright moves the pointer with **synthetic input**: it
sends "the mouse moved to (560, 390)" straight into the page over CDP (the Chrome DevTools
Protocol). But the test window is a real window on the desktop, so **real input** from the
operating system reaches the page too. If you move your physical mouse over the window during a
long run, or the window appears under your cursor, the page gets a real move or a "pointer left"
event. That overwrites where the test put the pointer, so the hover readout went back to idle.

## Why Atlas Realm needs it
Our pointer tests (hover, zoom, middle-drag pan, Atlas drags) check exact positions. One stray
event is enough to fail them, or worse, to end a middle-drag pan halfway. The full E2E run takes
about ten minutes, so someone using the computer meanwhile is normal.

## Where it lives in our code
- `launch()` in `tests/e2e/world.spec.ts` calls `BrowserWindow.setIgnoreMouseEvents(true)` on
  the test window. The OS now sends real mouse input to whatever is behind the window. CDP input
  doesn't go through the OS, so the test's pointer still arrives.
- The fix is in the test only. The app must keep accepting real mouse input, of course.

## How the cause was found
1. **Read the code first.** One `pointermove` over the map always sets the readout, so the app
   logic wasn't the problem. The event was going missing or being overwritten.
2. **Try to reproduce.** 20 repeats passed 140/140, so it couldn't be forced.
3. **Write a probe**, a throwaway spec that logs every pointer event the map receives, then try
   each theory: cover the window, minimize it, restore it.
4. **Read the evidence.** A restore produced a `pointermove` at (200, 643) that the test never
   sent. The real cursor was at screen (528, 816) and the window started at (328, 173):
   528 − 328 = 200, 816 − 173 = 643. A match.
5. **Test the fix the same way.** With `setIgnoreMouseEvents(true)` the stray event stopped and
   the test's moves still worked. Then 20 repeats of the whole file: 380/380.

## Common mistakes
- **Adding retries or longer waits.** That makes a real cause harder to see, and waiting longer
  doesn't help when the wrong event already arrived.
- **Changing the app to suit the test** (for example, ignoring pointer-leave). Real users need it.
- **Keeping the probe as a test.** It depended on where the real cursor happened to be, so it
  would be flaky itself. Write the evidence in the session log instead.

## Try it (5–15 min exercise)
After `corepack pnpm build`, temporarily change `setIgnoreMouseEvents(true)` to `false` in
`world.spec.ts`. Run
`corepack pnpm exec playwright test tests/e2e/world.spec.ts -g "hover, wheel"` and, while it
runs, move your mouse over the app window and then off it. It will probably fail on a hover
check (timing matters, so it may take a try or two). Put the line back.

## Learn more
- Electron, `win.setIgnoreMouseEvents`: https://www.electronjs.org/docs/latest/api/browser-window#winsetignoremouseeventsignore-options
- Playwright, Mouse: https://playwright.dev/docs/api/class-mouse
