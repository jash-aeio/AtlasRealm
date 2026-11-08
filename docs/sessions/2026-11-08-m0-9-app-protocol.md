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
4. E2E: page origin is `app://atlas`, `file:` script and img are blocked by CSP; existing probes still pass.

## Open questions
- Blocking the `file:` protocol outright and Electron fuses (`GrantFileProtocolExtraPrivileges`) belong to packaging (#10).
