# Lesson 006: Packaging, asar and fuses
**Milestone:** M0 · **Date:** 2026-11-09 · **Related:** `electron-builder.yml`, `scripts/electron-builder.ts`, `tests/e2e-packaged/packaged.spec.ts`, issue #10, ADR-0009

## The concept (plain words)
During development, `pnpm dev` runs our code with the Electron that sits in `node_modules`. Users don't have that. **Packaging** turns the project into something a normal person can install: one folder with `Atlas Realm.exe`, the Electron runtime, and our app inside it, wrapped in an **installer** (`AtlasRealm-Setup-0.0.0.exe`).

Three ideas make a packaged app different from a dev run:

1. **asar archive.** Our built files (`out/main`, `out/preload`, `out/renderer`, `package.json`) are packed into one read-only file, `resources/app.asar`. Electron reads it like a folder. It's like a zip file without compression.
2. **asar integrity.** At package time, electron-builder writes a hash (fingerprint) of every file in the archive into the `.exe`. At startup, Electron checks each file it reads against it. Change one byte, and the app stops with `Integrity check failed`.
3. **Fuses.** Electron's binary contains a row of on/off switches. Some features are handy for developers but dangerous in a shipped app. For example, `ELECTRON_RUN_AS_NODE=1` turns any Electron app into plain Node.js, so malware could run its own code through *our* trusted-looking `.exe`. Fuses are flipped once, at package time, and can't be turned back on by environment variables or command-line flags.

## Why Atlas Realm needs it
The M0 exit criterion is "a packaged app opens offline and shows persisted sample data". Things that work in dev can break when packaged: paths inside `app.asar`, the built-in `node:sqlite`, and folders with spaces or non-English letters (`C:\Users\Zoë\…`). And because Atlas Realm will later hold API keys and run agents, its `.exe` must not be easy to hijack.

## Where it lives in our code
- `electron-builder.yml`: what goes into the package (`out/**` and `package.json`, with no `node_modules` because everything is bundled), the NSIS installer settings, and the fuses:
  ```yaml
  electronFuses:
    runAsNode: false
    enableNodeOptionsEnvironmentVariable: false
    enableNodeCliInspectArguments: false
    enableEmbeddedAsarIntegrityValidation: true
    onlyLoadAppFromAsar: true
    grantFileProtocolExtraPrivileges: false
  ```
- `nsis.deleteAppDataOnUninstall: false`: uninstalling removes the program, never your projects or database.
- `tests/e2e-packaged/packaged.spec.ts`: copies the packaged app to `…\atlas packaged Ünïcødé 测试…\Program Fïles (x86) 地图\Atlas Realm` and runs the real `.exe`. It checks:
  - "Launch #1" and then "Launch #2", so data survives a restart.
  - Assets come only from `app://atlas`.
  - The fuses hold.
  - A damaged `app.asar` refuses to start.

## Common mistakes
- **Testing only in dev.** Dev mode doesn't use asar, fuses or the installer, so it can't catch packaging bugs. That's why there's a separate packaged test.
- **Shipping `node_modules` you don't need.** Vite already copies libraries into the bundle, so shipping them again adds size and more files that can break.
- **Fuses break your test tools.** Turning off `--inspect` also stops Playwright's usual Electron launcher, which attaches through it. We connect over Chromium's DevTools port instead.
- **Tests that can't fail.** Every fuse test has a *control*: stock Electron must still show the dangerous behavior, otherwise the test might be checking nothing. We also packaged once *without* fuses and saw the tests fail.

## Try it (5–15 min exercise)
Run `corepack pnpm package`, then open `release\win-unpacked\resources\`. Copy `app.asar` somewhere safe, open the original in a hex editor (or Notepad, carefully) and change one letter near the end. Start `release\win-unpacked\Atlas Realm.exe`. What happens? Put the copy back and start it again. Then explain in one or two sentences what this catches (corruption, casual edits) and what it doesn't while the app is unsigned. An attacker could also patch the hash stored in the `.exe`; code signing is what makes Windows notice that.

## Learn more
- Electron fuses: https://www.electronjs.org/docs/latest/tutorial/fuses
- Electron asar integrity: https://www.electronjs.org/docs/latest/tutorial/asar-integrity
- electron-builder, adding fuses: https://www.electron.build/tutorials/adding-electron-fuses
- electron-builder NSIS options: https://www.electron.build/nsis
