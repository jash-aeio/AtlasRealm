# Lesson 005: Origins, custom protocols and path traversal
**Milestone:** M0 · **Date:** 2026-11-08 · **Related:** `src/main/bootstrap/app-origin.ts`, `app-protocol.ts`, `src/main/ipc/router.ts`, SECURITY.md §21.1, issue #16

## The concept (plain words)
An **origin** is the "who are you" of a web page: scheme + host + port (`https://example.com:443`). Browsers use it for almost every security decision. Our CSP's `'self'` means "the same origin as this page".

A `file://` page has a fuzzy origin. To Chromium, `'self'` there means roughly "any file", including files on a network share (`file://server/share/x.png`). Loading one of those makes Windows try to log in to that server, which can leak your password hash.

A **custom protocol** gives the app its own clean origin. We register `app://` and serve our bundled files under `app://atlas/`. Now `'self'` means exactly our UI, nothing else on disk.

## Why Atlas Realm needs it
Later the UI will show model output, imported notes and community content. If any of it ever slipped HTML into the page, it should hit a wall. Closing this before untrusted content arrives is cheaper than fixing it after.

## Where it lives in our code
- `registerAppScheme()` runs **before** the app is ready and grants only `standard` + `secure`.
- `serveAppProtocol()` answers `app://atlas/...` requests by reading files from `out/renderer`.
- `resolveAppRequestPath()` is the guard. It decodes the URL, resolves the path, then checks it's still inside the root:
  ```ts
  const fromRoot = relative(rootDir, resolve(rootDir, requested));
  if (fromRoot === '' || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot))
    return undefined; // refuse
  ```
- The IPC router trusts senders only from `app://atlas`.

## Common mistakes
- **Path traversal:** forgetting that `..%2F..%2Fsecret` decodes to `../../secret`. Always check *after* decoding and resolving, not on the raw string.
- **Comparing `URL.origin` for custom schemes:** Node returns `"null"` for them, and `"null" === "null"` would trust every custom-scheme page. We compare protocol + host instead.
- **Granting too many scheme privileges** (`bypassCSP`, `corsEnabled`) "to make it work".
- **Vacuous tests:** our first E2E traversal test passed only because `fetch` refused *every* `app://` URL. A positive control (a real file must return 200) exposed it.

## Try it (5–15 min exercise)
In `tests/security/app-protocol.test.ts`, add a case you think might escape (try a double-encoded `%252e%252e`). Predict the result first, then run `corepack pnpm exec vitest run tests/security/app-protocol.test.ts`. Explain why it does or doesn't get through.

## Learn more
- Electron `protocol` API: https://www.electronjs.org/docs/latest/api/protocol
- Electron security checklist, "Use a custom protocol": https://www.electronjs.org/docs/latest/tutorial/security#18-avoid-usage-of-the-file-protocol-and-prefer-usage-of-custom-protocols
- OWASP Path Traversal: https://owasp.org/www-community/attacks/Path_Traversal
