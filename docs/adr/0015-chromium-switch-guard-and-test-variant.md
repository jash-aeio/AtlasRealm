# ADR-0015: Chromium switch guard: a named deny-list, plus a test-only package variant

- **Status:** Accepted
- **Date:** 2026-11-11
- **Milestone(s) affected:** M1 (M1-1 #20); release gate for M3 (permission broker)
- **Decided by:** jash-aeio (asked via AskUserQuestion on 2026-11-11, during #20)

## Context
Fuses turn off Node's back doors (`ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, `--inspect`), but Chromium's command-line switches have no fuse. Any program running as the same Windows user could start `Atlas Realm.exe --remote-debugging-port=9222`, connect over CDP, and run code inside the trusted `app://atlas` page. The IPC sender check would pass, because the code really runs in our frame. `--no-sandbox`, `--disable-web-security` and proxy switches are similar (#10 security review, M1 finding).

Two questions:
1. **Which switches to refuse.** Refuse a named list, or refuse anything not on an allowlist?
2. **How the packaged smoke tests keep running.** They drive the real `.exe` over `--remote-debugging-port`, which is exactly what we block.

## Options considered
**Which switches**
| Option | Pros | Cons |
|---|---|---|
| **Named deny-list** | Predictable. Won't break future legitimate arguments (deep links, file associations, Windows restart arguments) | A dangerous switch nobody listed gets through |
| Allowlist (refuse anything unknown) | Stronger in principle | Can break launches when Windows, an updater or a future feature adds arguments. Each one needs a list change |

**Smoke tests**
| Option | Pros | Cons |
|---|---|---|
| **Test-only package variant** | Keeps the UI, asset and worker smoke tests on a real packaged build. The shipped build still gets the guard tests and fuse readout | The smoke tests run on a build whose package.json differs by one field. Extra `electron-builder --dir` run (~13 s locally) |
| No CDP tests on packaged builds | Tests exactly what ships. Cheapest | Loses evidence that packaged UI, `app://` assets and the worker work |
| Environment-variable bypass | Simplest | An attacker can set the same variable, so the guard protects nothing |

## Decision
- **Named deny-list** in `src/main/bootstrap/switch-guard.ts`, grouped as debuggers, sandbox/isolation, child-process injection and traffic interception. When `app.isPackaged` and any is present, main writes one line to stderr and calls `app.exit(1)` before the single-instance lock, DB, protocol or any window. Detection uses `app.commandLine.hasSwitch`, Chromium's own parser, so `-x`, `/x` and upper-case spellings are caught too (checked by E2E).
- **Test-only variant:** `pnpm package:test` runs `electron-builder --win dir` into `release-test/` with `-c.extraMetadata.atlasRealm.packagedTest=true`. The marker lives in the package.json inside `app.asar`; it is never read from the environment. The variant allows only `remote-debugging-port`; every other blocked switch stays blocked. It's a folder only: no installer, never uploaded by CI. It has its own identity (`AtlasRealmTest.exe`, appId `…atlasrealm.test`, its own data folder) and lives outside `release/`, so it can't be mistaken for, or packaged with, the real app. A packaged test checks that the shipped `app.asar` has no marker (with the variant as positive control).

## Consequences
- The shipped build can't be debugged with Chromium switches. Debug with `pnpm dev`, or build the variant.
- Adding a switch to the list is a one-line change plus a unit test (`tests/security/switch-guard.test.ts` runs over the whole list).
- `--js-flags` reaches V8 at process start, before the guard runs. Refusing it still keeps the flags out of renderers and ends the process at once. Every other listed switch acts later (DevTools server, child processes).
- `allow-file-access-from-files` can't be listed: Electron adds it to its own command line, so refusing it stopped every launch (found by the packaged positive control). `file:` loads are blocked separately.
- Asar integrity protects the marker only as far as it protects the asar: until the `.exe` is code-signed, a local attacker who can patch files could also flip it. Same limit as every other asar-based check.
- Revisit if: a new Chromium switch turns out to bypass the boundary (add it), or legitimate arguments start appearing that an allowlist could describe cleanly.

## Learning note
A **deny-list** names what's forbidden, while an **allowlist** names what's permitted. Allowlists are usually safer, but here the inputs (OS and future feature arguments) are hard to predict, so a well-documented deny-list was the practical choice. The test variant is "marked at build time" because anything an honest test can set at runtime (an environment variable, a switch), an attacker can set too.
