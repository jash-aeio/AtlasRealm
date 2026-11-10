# 2026-11-11: M1-1 Chromium switch guard (#20)

## Task
Stop the packaged app from starting with Chromium switches that bypass its security boundary (for example `--remote-debugging-port`, which would let another program run code inside our trusted page). Release gate before the M3 permission broker.

## Decisions (you, via AskUserQuestion)
- **Smoke tests:** a test-only package variant. `pnpm package:test` writes `atlasRealm.packagedTest: true` into the package.json inside its `app.asar` and outputs a folder in `release/test`. It allows `--remote-debugging-port` only. It's never installed or uploaded. → [ADR-0015](../adr/0015-chromium-switch-guard-and-test-variant.md)
- **Switch list:** a named deny-list (19 switches in four groups), not an allowlist. → ADR-0015

Routine choices (not asked):
- Exit with code 1 and one stderr line, **no dialog**. A modal box would hang automated launches, and a person who typed a debug switch by mistake can read the log.
- `--inspect` is now refused too, on top of its fuse (defense in depth). The packaged `--inspect` test now expects a refusal.
- `package:test` rebuilds `out/` first (about 10 s) so the variant can never wrap a stale build.

## What was done
1. `feat(shell)`: `src/main/bootstrap/switch-guard.ts` with the list, `findBlockedSwitches` and `isPackagedTestBuild`. The guard runs at the very top of `src/main/index.ts`. 31 unit tests.
2. `test(packaged)`: the `package:test` script and a CI step. The packaged spec copies both builds. Smoke tests use the variant. New guard tests use the shipped build, with a positive control (starts normally without switches).
3. `docs`: SECURITY §21.1 rule, ADR-0015, glossary (Chromium switch, deny-list/allowlist), IMPLEMENTATION_STATUS, the builder-config comment, the M1 decision table.

## Things learned
- Electron applies `--remote-debugging-port` only after the main script has run, so exiting at the top of main means the port never opens. The E2E checks this.
- On Windows, Chromium accepts `--x`, `-x`, `/x` and any letter case. Asking `app.commandLine.hasSwitch` (Chromium's own parser) catches every spelling Chromium itself honours. A hand-written `process.argv` check would have missed some.

## Open questions
- One unit-test run failed once (1/224) and couldn't be reproduced. Watch CI.
