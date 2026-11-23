# 2026-11-24 · CSP: remove `data:` from `img-src` (#58)

**Branch:** `chore/58-csp-img-src` · **Issue:** #58 (M2, parallel-safe follow-up)

## Task
The security auditor has suggested since M0 that we drop `data:` from the Content Security Policy's `img-src`. A `data:` URL puts a whole image inside the URL text itself, so allowing it lets injected markup create images without any file. The user decided on 2026-11-20: verify that no library needs it, then remove it.

## What we checked (acceptance criterion 1)
- **Our renderer code:** no `data:` images anywhere in `src/renderer`.
- **PixiJS 8.22:** `data:` URIs appear only in the `Assets` loader (AVIF/WebP format probes, the SVG and GIF loaders) and in `ExtractSystem` (canvas to image export). We use neither: `grid-scene.ts` loads art with a plain `<img>` (decided in M0-8 for other CSP reasons).
- **React Flow (`@xyflow/react` 13):** no `data:` URIs in its JS or CSS.
- **Vite:** `assetsInlineLimit: 0` was already set, so small images are emitted as real files, not inlined as `data:` URLs.

Nothing needs it, so it was removed.

## What was done
- `src/common/security/csp.ts`: `img-src 'self'` (production and dev), with a comment explaining the evidence.
- `tests/security/csp.test.ts`: asserts `img-src 'self'` and no `data:` anywhere in either policy.
- `tests/e2e/shell.spec.ts`: new test that a valid 1×1 `data:` GIF is refused while a bundled PNG loads. The bundled image is a **positive control**: if image loading were broken, a "blocked" result for `data:` would prove nothing. We checked that the test **fails** when `data:` is put back (`data: "loaded"`), then restored the change.
- The world and atlas E2E already fail on any `securitypolicyviolation` while Pixi and React Flow render real art, so they cover "no CSP errors for images".

## Evidence
- typecheck, lint, format:check pass
- unit/integration 1134/1134
- E2E 109/109 (full suite); built `out/renderer/index.html` contains `img-src 'self'`
- packaged E2E 15/15

## Decisions
- None new. The user's 2026-11-20 decision ("verify, then remove") was followed. No ADR needed.
- Routine: the E2E check went into `shell.spec.ts` (outside the issue's "files owned" list) because that's where the other CSP probes live.

## Open questions
- None.
