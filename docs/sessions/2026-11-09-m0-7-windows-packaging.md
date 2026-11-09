# 2026-11-09: M0-7 Windows packaging and packaged smoke test (#10)

**Branch:** `feat/10-windows-packaging` · **Issue:** [#10](https://github.com/jash-aeio/AtlasRealm/issues/10)

## Task
Prove the app works outside development mode. That means:
- A Windows build exists.
- It launches from a path with spaces and non-ASCII characters.
- SQLite works and data survives a restart.
- Bundled assets load offline.
- The commands are documented.

The task also took on the packaging follow-ups from the #16 security review: fuses, blocking `file:`, and a packaged `app://` test.

## Decisions (asked through AskUserQuestion)
- **Uncommitted process edits** (CLAUDE.md, `/start-task`: "Claude writes all the code"): these went into their own small PR (#19) first, so #10 started from a clean `main`.
- **Build target:** NSIS installer plus the unpacked folder. Tests use the unpacked folder, and the installer was checked once by hand.
- **"Shows persisted data":** a small read-only spike command `app.launchInfo`. The panel shows "Launch #N · first launched … · schema vN".
- **Hardening:** all of it here: fuses, a full `file:` block, and packaged tests for both.
- **Security review M1 (Chromium switches like `--remote-debugging-port` still work):** recorded as a known limitation with a release gate, and tracked in [#20](https://github.com/jash-aeio/AtlasRealm/issues/20). Fixing it now would need a second, test-only package, because our smoke test gets in through that same switch. That redesign deserves its own task.
- No new ADR: electron-builder was already chosen in [ADR-0009](../adr/0009-electron-vite-and-electron-builder.md).

## Routine choices (spec defaults, not asked)
- appId `io.github.jash-aeio.atlasrealm` (based on a domain the owner controls). Output goes to `release/`, and the artifact is named `AtlasRealm-Setup-<version>.exe`.
- The packaged app is named "Atlas Realm", so its data folder is separate from `pnpm dev`'s `atlas-realm`. A dev build with a newer schema then can't make the installed app refuse its database.
- Everything is bundled and all packages are devDependencies, so no `node_modules` ships. The renderer is minified.
- `electron-winstaller` install script is explicitly denied in `allowBuilds`: it's only for Squirrel installers, and we build NSIS.
- CI packages on every PR, runs the packaged tests, and uploads the unsigned installer for 7 days. The new step was pinned to `upload-artifact` v7 (the latest release).

## Plan → what was done
1. `chore(build)`: electron-builder config, bundling, scripts and fuses. The fuses went into this commit with the config rather than in slice 2.
2. `feat(security)`: block `file:` for every request, plus an E2E test with a positive control. A mutation check confirmed the test fails without the block.
3. `feat(ipc)`: `app.launchInfo`, the panel line, integration tests, and E2E checks for #1 and then #2.
4. `test(e2e)`: packaged smoke test (7 tests by the end of the session).
5. `ci`: packaging, the packaged E2E and the artifact upload.
6. `fix(security)`: review follow-ups.

## Things learned along the way
- **electron-builder runs `pnpm list` from PATH.** On this machine pnpm only exists through corepack, so packaging failed, and the fallback treats "no runtime dependencies" as an error. `scripts/electron-builder.ts` now makes temporary corepack shims for that one process. CI has pnpm on PATH anyway.
- **Missing `productName`.** The packaged `package.json` had none, so the installed app would have shared dev's data folder. `extraMetadata.productName` fixed that.
- **Fuses break the usual test tool.** Turning off `--inspect` also turns off Playwright's `_electron.launch`, which attaches that way. The packaged tests start the `.exe` themselves and connect over CDP.
- **Every fuse test needs a control.** Stock Electron must still show the dangerous behavior (run as Node, print "Debugger listening"), and the fuse-wire positions are checked against stock Electron's defaults. One package built *without* fuses made each of these tests fail.
- **Look closely at fast passes.** The tamper test passed in 280 ms. A single-instance-lock exit would also look like "exited early", so I checked the actual output: `FATAL … Integrity check failed for asar archive entry 'package.json'`. The test now asserts that message.
- **Node bug:** on Node 24.13/Windows, `fs.cpSync` silently copies nothing into a non-ASCII destination. The async `fs/promises` `cp` works. The test checks that the copied `.exe` exists, so a silent copy failure can't hide.

## Manual check
A silent install to `%TEMP%\Atlas Install Ünïcødé 测试\Atlas Realm` exited 0. The installed app created its DB in `%APPDATA%\Atlas Realm`. A silent uninstall removed the program and its registry entry and **kept** the data folder.

The project's guard hook refused my cleanup of the leftover test data folder (`%APPDATA%\Atlas Realm`, holding only launch_count 1) and an empty temp folder. The user can delete them, or leave them; they're harmless.

## Reviews
- **invariant-reviewer:** no violations. It asked for these docs and for the uninstall behavior to be shown (done manually, recorded as not automated). Its note about shim cleanup on failure is fixed with try/finally.
- **security-auditor:** approve with changes.
  - M1 (Chromium switches) → #20, release gate before M3.
  - L1: the wrapper used `shell:true` with an unquoted temp path. Fixed: corepack now runs through `process.execPath`.
  - L2: added a packaged `file:` test.
  - L3: the `file:` block covers the default session only. Now a documented rule.
  - L4: asar integrity needs signing to be a real boundary. Wording fixed and the limit documented.
  - L5: actions pinned by tag, not SHA. Listed as a known limitation.

## What the user wrote
Nothing in code. The project rule is now that Claude writes all the code (PR #19).

## Open questions
- Should #20 stay in the M0 milestone or move to M3, where its release gate applies? It sits in M0 for now.
- Code signing (costs money) and a real icon (M0-8) come before any release.
