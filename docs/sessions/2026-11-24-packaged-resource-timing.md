# 2026-11-24 · Packaged offline test checks real loaded URLs (#57)

**Branch:** `chore/57-packaged-resource-timing` (worktree `D:/MyProjectsJCB/AtlasRealm-57`)

## Task
Since M0-7, the packaged test "loads the UI and its bundled assets only from app://atlas (works offline)" looped over `performance.getEntriesByType('resource')`, but that list was always empty, so the loop checked nothing. Goal: make the test prove something real.

## What we found (cause)
A probe against the packaged test build showed:
- First, uncached load: **0** resource-timing entries (only the navigation entry for `index.html`).
- After one reload: **5** entries (4 scripts and 1 stylesheet), all with `transferSize` 0, so they came from the cache.
- Playwright's network recorder (the DevTools protocol) saw all **6** requests on the reload, including the page itself.

So Chromium records no resource-timing entry for an uncached `app://` fetch. Cache hits are recorded. This matches what M1-9 saw for images. We confirmed the behaviour but not the exact line in Chromium. Our best guess is that responses from Electron's `protocol.handle` don't go down the path that creates timing entries.

A `fetch()` of an `app://` URL also fails in the page. That's expected, because the scheme isn't registered with `supportFetchAPI` (M0-9).

## Decision
The user chose **network recorder + reload** over "resource timing after a reload only". With two independent sources, a failed or blocked request is caught as well.

## What was done
- The test records `request`, `requestfailed` and CSP console errors, then reloads (`networkidle`).
- Positive controls: the request list must contain `index.html` plus every DOM script and stylesheet. The resource-timing list must contain every DOM script and stylesheet. Only after that does it check that every URL starts with `app://atlas/`. It also asserts that there are no failed requests and no CSP errors.
- Recorder control: an injected `https://example.invalid/outside.png` image must show up both as a CSP error and as a failed request (error `csp`). The CSP blocks it before any network access, so it works offline.
- Mutation check: without the reload, the test fails with `Received: []`.

## Something learned
The first version of the control **failed**, and that was useful. It filtered console errors for "Refused to", but this Chromium writes "Loading the image '…' violates the following Content Security Policy directive". Without the control, the recorder would have missed real CSP blocks. The filter now matches "Content Security Policy".

## Process note
While the package was building, a peer session (#58) switched the shared checkout to `chore/58-csp-img-src`. #57 moved to its own worktree and rebuilt both packages there. The peer's files were not touched.

## Evidence
On `chore/57-packaged-resource-timing` @ 28f0524 (worktree): typecheck, lint and format:check pass. Packaged E2E 15/15. Unit tests and the unpackaged E2E were not rerun, because only the packaged spec changed.

## Open questions
None.
