# 2026-11-08: M0-9 Serve the renderer from `app://` (#16)

**Branch:** `feat/16-app-protocol` · **Issue:** [#16](https://github.com/jash-aeio/AtlasRealm/issues/16)

## Task
Load the built UI from a custom `app://atlas/` origin instead of `file://`, so the CSP source `'self'` stops matching any file on disk or on a network share. The IPC sender check should trust only that origin in builds.

## Decisions (routine, from the plan)
- Origin `app://atlas`, entry `app://atlas/index.html`. The scheme is registered as `standard` + `secure` only (no `bypassCSP`, no `corsEnabled`, no service workers).
- The handler is registered only when the build entry is in use; `pnpm dev` keeps the localhost dev server.
- The router's `file:` trust branch is removed: builds no longer load from `file://`, so no `file:` page is trusted.

## Plan
Slices:
1. Pure path resolver `resolveAppRequestPath` + unit tests (traversal, encoded traversal, wrong host, root → index.html).
2. Register the scheme and handler in main; `rendererEntryUrl()` returns `app://atlas/index.html`.
3. Router trusts `app://atlas` exactly; tests updated.
4. E2E: page origin is `app://atlas`, `file:` script and img fail to load; existing probes still pass.

## What was done
- Slices as planned, in four commits: resolver + tests; scheme/handler wiring together with the router change; E2E proofs; review fixes.
- The router change went in the same commit as the wiring. The router now refuses `file:` entries, so on its own the app wouldn't start. And switching the entry first would briefly have compared Node's `"null"` origins, which trusts any custom scheme.

## Things learned along the way
- **URL parsing collapses dots before our code runs.** `app://atlas/%2e%2e/x` and `assets/..` arrive already normalized and stay inside the root; my first tests wrongly expected them to be refused. The dangerous forms are the ones that survive parsing (`..%2F`, `%5C`, drive letters), and the resolver refuses those.
- **`file:` loads are blocked before CSP.** From an `app://` page, Chromium refuses `file:` subresources outright ("Not allowed to load local resource"), so no CSP violation event fires. The E2E test asserts the outcome (the load fails), not a CSP event.
- **A test that can't fail proves nothing.** The renderer can't `fetch` `app://` at all (no `supportFetchAPI`), so the first traversal test passed for the wrong reason. A positive control (`index.html` must return 200) caught it; the probe now drives the real handler from the main process.

## Reviews
- security-auditor: approve with two Low fixes, both applied. The sender check ignored `user:pw@` (now a shared `isAppOrigin`), and asset reads now bypass custom protocol handlers so a future `file:` blocker can't break them. Packaging follow-ups are recorded in the status doc for #10.
- invariant-reviewer: no violations. Asked for precise wording about the `file:` block (fixed here) and for the status doc update.

## What the user wrote
- Nothing this time: the user asked me to write all the tests.

## Open questions
- Blocking the `file:` protocol outright and Electron fuses (`GrantFileProtocolExtraPrivileges`) belong to packaging (#10).
