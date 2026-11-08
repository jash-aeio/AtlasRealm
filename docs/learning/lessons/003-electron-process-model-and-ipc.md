# Lesson 003: The Electron process model and safe IPC
**Milestone:** M0 · **Date:** 2026-11-08 · **Related:** `src/main/`, `src/preload/index.ts`, `src/main/ipc/router.ts`, `src/common/contracts/`, ADR-0009, ARCHITECTURE.md §7.2, SECURITY.md §21.1

## The concept (plain words)
An Electron app is three programs that trust each other differently:

| Process | Can do | Trusted? |
|---|---|---|
| **Main** (Node.js) | Files, database, shell, secrets, windows | Yes |
| **Preload** | A few Electron APIs, runs before the page | Bridge only |
| **Renderer** (Chromium page) | Draw UI, run React | **No.** Treat it like a website |

They talk through **IPC** (inter-process communication): the renderer sends a named message, and the main process answers. Security comes from making that channel narrow and checked.

## Why Atlas Realm needs it
The UI will show model output and imported files, which are untrusted content. If a bug lets that content run script in the renderer, the damage must stop there. So the renderer has no `require`, no `process`, and no filesystem. All it can do is ask the main process, which checks every request.

## Where it lives in our code
- `src/main/bootstrap/window.ts` turns on `sandbox` and `contextIsolation` and turns off `nodeIntegration`. It also blocks navigation, pop-ups and permissions.
- `src/preload/index.ts` exposes exactly one function:
  ```ts
  contextBridge.exposeInMainWorld('atlas', {
    app: { ping: (input) => ipcRenderer.invoke('app.ping', input) },
  });
  ```
  There is no generic `invoke(channel, data)`. That would hand a compromised page every channel.
- `src/main/ipc/router.ts` runs every request through these checks: **sender** (is it our page?) → **size** → **Zod schema** → handler → **output schema**. Errors come back as `{ ok: false, error: { code } }` and never include stack traces.
- A **CSP** (`src/common/security/csp.ts`) stops injected `<script>` tags from running at all.

## Common mistakes
- Exposing `ipcRenderer` itself, or a pass-through `invoke`, from the preload.
- Validating in the renderer only. The renderer is the attacker in this model, so validation must happen in main.
- Using `z.object` (silently drops unknown keys) when you mean `z.strictObject` (rejects them).
- Writing security tests that can't fail. We switched each protection off once and watched 7 of 8 E2E tests fail.

## Try it (5–15 min exercise)
1. Run `corepack pnpm dev`, open DevTools (Ctrl+Shift+I) and type `typeof require`. Then try `await window.atlas.app.ping({ message: '   ' })`. What error code comes back, and which check produced it?
2. In `src/common/contracts/channels.ts`, imagine adding `app.quit`. List the four files you'd touch, and the test you'd write first.

## Learn more
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation) · [Process sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox)
