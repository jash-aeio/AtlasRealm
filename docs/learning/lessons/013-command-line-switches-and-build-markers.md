# Lesson 013: Command-line switches, deny-lists and build-time markers
**Milestone:** M1 · **Date:** 2026-11-13 · **Related:** `src/main/bootstrap/switch-guard.ts`, `src/main/index.ts`, ADR-0015, SECURITY §21.1, lesson 006 (fuses)

## The concept (plain words)
A program's **command line** is the list of words it's started with. Electron's browser engine, Chromium, understands hundreds of **switches** such as `--remote-debugging-port=9222`. Some are harmless (`--lang`). Others switch off safety features or open a remote control door.

**Fuses** (lesson 006) can turn off Node's risky options, but Chromium switches have no fuse. So our main process checks for them itself and refuses to start.

## Why Atlas Realm needs it
Our security model says the renderer is untrusted and main validates every IPC call, including which page sent it. But if someone starts `Atlas Realm.exe --remote-debugging-port=9222`, they can connect DevTools and run code *inside our own page*. The sender check then passes, because the code really is in our page. Later, IPC will touch files, secrets and providers, so this door had to close first.

## Where it lives in our code
```ts
// src/main/index.ts: the very first thing main does
if (refuseBlockedSwitches()) {
  // app.exit(1) already running: no lock, no DB, no window
} else if (!app.requestSingleInstanceLock()) { … }
```
`findBlockedSwitches` asks `app.commandLine.hasSwitch(name)` for each name in `BLOCKED_SWITCHES`. Two details matter:
- **Use the same parser as the thing you're guarding.** On Windows, Chromium accepts `--x`, `-x`, `/x` and `--X`. Asking Chromium's parser catches every spelling Chromium itself honours. A hand-written `process.argv.includes('--remote-debugging-port')` would miss `/remote-debugging-port`.
- **Timing.** Electron opens the debugging port only after the main script runs, so exiting at the top of main means the port never opens. The E2E checks that the port doesn't answer.

**Build-time markers.** Our packaged tests *need* the debugging port. An environment variable like `ATLAS_ALLOW_DEBUG=1` would be useless, since an attacker can set it too. Instead, `pnpm package:test` writes `atlasRealm.packagedTest: true` into the package.json *inside* `app.asar`. Only that separate test build carries it.

## Common mistakes
- Guarding with a different parser than the one that acts on the input.
- A "test bypass" that's controlled at runtime (environment variable, switch, file next to the exe).
- Showing an error dialog in a guard that automation can trigger, because the process then hangs.
- Tests with no **positive control**: "exits with code 1" proves little unless the same exe without the switch is shown to keep running.

## Try it (5–15 min exercise)
1. Run `pnpm package`, then start `release\win-unpacked\Atlas Realm.exe --no-sandbox` from a terminal. Read the `[security]` line and run `echo $LASTEXITCODE`.
2. Add `'enable-logging'` to `BLOCKED_SWITCHES`. Which unit test checks it automatically? (Hint: `it.each`.) Then undo the change.

## Learn more
- Electron `app.commandLine`: https://www.electronjs.org/docs/latest/api/command-line
- Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- Electron fuses: https://www.electronjs.org/docs/latest/tutorial/fuses
