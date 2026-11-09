# Implementation status

> **The handoff between sessions.** Read this first, every session. Update it before handing work back (`/ship` does it). Treat claims here as notes to verify against the code, not as facts.

**Last updated:** 2026-11-09 · **Branch:** feat/10-windows-packaging (PR for #10)

## Current milestone
**M0 — Foundation and risk spikes** (🔨 in progress; M0-1, M0-2, M0-3, M0-9 done; M0-7 in review)

## Implemented and demonstrated
- Repository and process setup (2026-11-06): spec docs, Claude Code config, GitHub workflow. See `docs/sessions/2026-11-06-project-setup.md`.
- **M0-1 tooling scaffold (#4, merged):** developer tooling.
  - pnpm 12.18.0 pinned through corepack (`packageManager` in `package.json`). Dependency install scripts are blocked unless allowed in `pnpm-workspace.yaml` (none allowed so far).
  - TypeScript 6.0.3 with `strict` and extra safety flags (`tsconfig.json`).
  - ESLint 10 flat config with typescript-eslint `strictTypeChecked`, plus Prettier (`eslint.config.js`, `.prettierrc.json`).
  - Vitest 5 (`vitest.config.ts`). First tested code: `src/common/errors/assert-never.ts`.
  - CI (`.github/workflows/ci.yml`) runs install → typecheck → lint → format:check → test on windows-latest.

- **M0-2 Electron shell + typed IPC (#5, merged):** `pnpm dev` opens a window titled "Atlas Realm". It shows only an "IPC check (M0 spike)" panel: no world, projects or data.
  - Renderer: sandboxed (the OS reports it), context isolation on, no Node integration, strict CSP (`src/common/security/csp.ts`, relaxed only for the Vite dev server). Navigation, redirects, pop-ups, webviews and permission requests are denied.
  - Preload exposes only `window.atlas.app.ping` (built as a single CommonJS file, as the sandbox requires).
  - IPC router (`src/main/ipc/router.ts`): sender check (our page's main frame only; rejects UNC look-alikes) → Zod schema → 64 KiB size limit → handler → output schema. Typed `IpcResult` with stable error codes.
  - `app.ping` is an **M0 spike command** with no product meaning.
  - Build tooling: electron-vite 6 (ADR-0009). Packaging (electron-builder) came in M0-7.

- **M0-3 SQLite + migrations (#6, merged):** the app now keeps a local database. It has no product data yet, only launch facts.
  - Binding: built-in `node:sqlite` (ADR-0010). Only `src/main/storage/database.ts` imports it. Foreign keys, WAL, busy timeout, defensive mode, `trusted_schema = OFF`.
  - File: `userData/profiles/default/app.sqlite` (DATA_MODEL §9.1 layout; `default` is a placeholder profile ID until profiles exist in M1).
  - Migration runner (`migrate.ts`): one transaction per migration with its `schema_migrations` row and `PRAGMA user_version` bump. An existing DB is backed up first to `profiles/default/backups/`, using the online backup API; the copy is checked. A DB from a newer app is refused untouched. A failing migration leaves the old version and keeps the backup.
  - Schema v1: `app_meta` (key/value), accessed only through `AppMetaRepository`. Startup records `launch_count`, `first_launched_at`, `last_launched_at`.
  - If the DB can't be opened, startup shows an error box (a fixed message, no paths) and quits. It never creates an empty replacement.
  - Single-instance lock: a second copy focuses the first and quits, so two instances can't race through migrations.

- **M0-9 UI served from `app://` (#16, merged):** the built UI loads from `app://atlas/index.html`, not `file://`.
  - `app` is registered before ready as `standard` + `secure` only (no CSP bypass, CORS, fetch or service workers). `protocol.handle` serves GET-only from `out/renderer`; everything else gets an empty 404/405.
  - `resolveAppRequestPath` (`src/main/bootstrap/app-origin.ts`) decodes, resolves and confines each path to the renderer folder (encoded `..`, backslashes, drive letters, UNC and NUL bytes are refused).
  - IPC trusts only the `app://atlas` origin in builds (shared `isAppOrigin`, which also rejects `user:pw@`). The router refuses to build a check for a `file:` entry. `pnpm dev` still uses the localhost dev server.
  - Rule written in `app-protocol.ts`: only build output may be served under `app://atlas`, because IPC trusts that whole origin.

- **M0-7 Windows packaging (#10):** `pnpm package` builds `release/AtlasRealm-Setup-0.0.0.exe` (NSIS) and `release/win-unpacked/`.
  - electron-builder 26.18.0 (`electron-builder.yml`, ADR-0009). Only `out/**` and `package.json` go into `app.asar`, with no `node_modules`. Main bundles zod, and all packages are devDependencies. The renderer is minified (567 → 220 kB).
  - Fuses: RunAsNode, `NODE_OPTIONS` and `--inspect` are off. `file:` extra privileges are off. Embedded asar integrity and OnlyLoadAppFromAsar are on.
  - `file:` is blocked for every request in the default session (`blockFileProtocol`). The `app://` handler bypasses the block for its own files.
  - NSIS installs per-user (no admin) into a folder you can choose. `deleteAppDataOnUninstall: false`.
  - The packaged app is named "Atlas Realm", so its data lives in `%APPDATA%\Atlas Realm`. Dev uses `%APPDATA%\atlas-realm`.
  - The UI shows "Launch #N · first launched … · schema vN" through the new **M0 spike** command `app.launchInfo`. It is read-only, takes no payload, and reads the DB on every call.
  - Placeholders: **unsigned** (SmartScreen warns) and Electron's **default icon**.
  - `scripts/electron-builder.ts`: electron-builder runs `pnpm list` from PATH. When pnpm exists only through corepack, the script makes temporary corepack shims for that one process.

## Changed components
- M0-7: `electron-builder.yml`, `scripts/electron-builder.ts` (new), `electron.vite.config.ts`, `package.json` (scripts, deps), `pnpm-workspace.yaml`, `tsconfig.{node,e2e}.json`, `playwright.packaged.config.ts` + `tests/e2e-packaged/` (new), `.github/workflows/ci.yml`; `src/main/bootstrap/app-protocol.ts`, `src/main/index.ts`, `src/main/ipc/{register.ts,commands/app-launch-info.ts}`, `src/common/contracts/{app-launch-info,channels,atlas-api}.ts`, `src/preload/index.ts`, `src/main/storage/repositories/app-meta-repository.ts`, `src/renderer/app/App.tsx`; `tests/integration/app-launch-info.test.ts`, `tests/e2e/{shell,storage}.spec.ts`
- M0-9: `src/main/bootstrap/app-origin.ts` and `app-protocol.ts` (new), `window.ts`, `src/main/index.ts`, `src/main/ipc/router.ts`; `tests/security/app-protocol.test.ts` (new), `tests/integration/ipc-router.test.ts`, `tests/e2e/shell.spec.ts`
- M0-3: `src/main/storage/` (database, migrate, migration-rules, migrations, repositories, app-database), `src/main/index.ts` (DB at startup, single-instance lock), `tests/integration/storage-*`, `tests/e2e/storage.spec.ts`; both E2E specs use a temporary `--user-data-dir`
- M0-2: `electron.vite.config.ts`, `playwright.config.ts`, `tsconfig.{base,node,web,e2e}.json` (tsconfig split per environment), `package.json` scripts
- `src/main/` (bootstrap, ipc), `src/preload/`, `src/renderer/`, `src/common/contracts/`, `src/common/security/`
- `tests/integration/`, `tests/security/`, `tests/e2e/`; CI gains an E2E step
- M0-1: root tooling config, `src/common/errors/`, `tests/domain/`, `.github/workflows/ci.yml`

## Verification
- M0-7, 2026-11-09, local Windows 11: typecheck, lint, format:check pass. Unit/integration 108/108. E2E 15/15 (built app). Packaged E2E 7/7.
  - `pnpm package` took about 70 s. Output: `AtlasRealm-Setup-0.0.0.exe` (121 MB) and `win-unpacked` (358 MB). The asar holds only `out/` + `package.json`.
  - Packaged E2E copies the app to `%TEMP%\atlas packaged Ünïcødé 测试 …\Program Fïles (x86) 地图\Atlas Realm`, with userData also under a non-ASCII path.
    - Restart: the UI shows Launch #1 and then #2, and both runs exit 0. This proves `node:sqlite` works packaged.
    - The page is `app://atlas/index.html`, and every script, stylesheet and resource comes from `app://atlas`. CSS applied and React rendered. This proves `app://` inside `app.asar` and offline assets.
    - A `file:` image fails, while our own stylesheet loads (positive control).
    - Fuse states read from the binary. Stock Electron's defaults serve as a control for the positions.
    - `ELECTRON_RUN_AS_NODE` and `--inspect` are ignored. Stock Electron shows both behaviors (positive controls).
    - One changed byte in `app.asar` → `FATAL … Integrity check failed for asar archive entry 'package.json'`.
  - Mutation checks:
    - Packaged without `electronFuses`, the fuse-wire, RunAsNode, inspect and tamper tests each failed.
    - Without `blockFileProtocol`, the dev E2E `file:` test failed (200 instead of 404).
  - **Manual, not automated:** a silent NSIS install (`/S /D=%TEMP%\Atlas Install Ünïcødé 测试\Atlas Realm`) exited 0 in 15 s. The installed app created `%APPDATA%\Atlas Realm\profiles\default\app.sqlite`. A silent uninstall exited 0 and removed the program and its uninstall registry entry, but **kept** the data folder. Interactive install via the wizard wasn't tried.
  - Packaged tests connect over CDP (`--remote-debugging-port`), because the inspect fuse stops Playwright's `_electron.launch`.
  - security-auditor: approve with changes. M1 (Chromium switches) is accepted and tracked in #20. L1 (shell quoting in the wrapper) and L2 (packaged `file:` test) are fixed. L3 and L4 are documented in comments and below. L5 (SHA-pinning actions) is listed below. invariant-reviewer: no violations. It asked for these docs and an uninstall check (done manually, above).
- M0-9, 2026-11-08, local Windows 11: typecheck, lint, format:check pass. Unit/integration 100/100. E2E 13/13 (built app).
  - E2E: the page URL is `app://atlas/index.html` and all scripts come from `app:`. A `file:` script, a `file:` image and a UNC (`file://127.0.0.1/c$/...`) image all fail to load. Chromium refuses `file:` resources from a non-file page before CSP is consulted (no CSP violation event fires), and `'self'` no longer covers `file:` either.
  - E2E: the real handler, driven through main-process `net.fetch`, returns 200 for `index.html` (positive control), 404 for encoded traversal, drive paths and missing files, and 405 for POST.
  - The first traversal probe passed vacuously (renderer `fetch` refuses all `app://` URLs). A positive control exposed it, and the probe moved to the main process.
  - security-auditor: approve; two Low items fixed (userinfo in the sender check, `bypassCustomProtocolHandlers`). invariant-reviewer: no violations.
- M0-3, 2026-11-08, local Windows 11: typecheck, lint, format:check pass. Unit/integration 70/70. E2E 10/10 (built app).
  - E2E: the app started twice against a temp userData; the file then holds `launch_count = 2`, schema v1. A second copy exits with code 0 while the first runs; the count stays 1.
  - Mutation checks: removing launch recording failed the restart test; removing the single-instance lock failed the lock test.
  - Integration: rollback of a half-failed migration, backup content and version, downgrade refused, FK enforced, `trusted_schema` off.
  - Not automated: the startup error box itself.
- 2026-11-08, local Windows 11: typecheck (node + web + e2e), lint and format:check pass. Unit tests 42/42. E2E (Playwright + Electron, built app) 8/8.
- E2E probes: title, OS sandbox, no `require`/`process`/`module`/`Buffer` in the page, preload API shape, `app.ping` round-trip, invalid payload rejected, injected inline script blocked by CSP, `window.open` and navigation blocked.
- The probes were shown to fail: with sandbox/isolation off, Node on, `unsafe-inline` and guards removed, 7 of 8 E2E tests failed. The UNC sender test fails without its fix.
- Dev mode checked: dev CSP served; a dev window showed the title and a successful round-trip with no console errors.
- CI: see the PR checks (first CI run with E2E on windows-latest).

## Known limitations
- No product features yet: no world, projects, Pixi or React Flow. The DB holds only launch facts.
- `node:sqlite` is a release candidate API (ADR-0010). It works in the packaged build (M0-7 E2E).
- **Release gate (#20):** the packaged app still accepts Chromium switches such as `--remote-debugging-port`, `--no-sandbox` and `--disable-web-security`. Any program running as the same user could drive the trusted page. Low impact while only `ping`/`launchInfo` exist. It must be fixed before any IPC command touches files, secrets or providers.
- Unsigned build: SmartScreen warns, and asar integrity only stops corruption and casual tampering. Without a signature, a local attacker can patch the hash in the `.exe` too. Code signing is a release decision (costs money).
- Electron's default icon is a placeholder until M0-8. The `app-update.yml` that electron-builder generates is unused (no updater).
- The `file:` block covers the default session only. Any future `session.fromPartition` needs its own block (rule in `app-protocol.ts`).
- CI actions are pinned by tag, not commit SHA (supply-chain hardening, low risk with `contents: read`).
- Node 24.13 `fs.cpSync` silently copies nothing into a non-ASCII destination on Windows. The packaged test uses `fs/promises` `cp`. Avoid `cpSync` for user paths.
- Pre-migration backups are never pruned (retention comes in M7, OFFLINE_AND_RECOVERY §20.4). Two backups in the same millisecond would share a name; the single-instance lock makes that practically impossible.
- Unit tests on Node 24.13 print a harmless SQLite ExperimentalWarning.
- The renderer can't `fetch()` `app://` URLs (no `supportFetchAPI`); grant it only if a feature needs it. Optional CSP + `nosniff` response headers on `app://` are still not added (the CSP is a meta tag).
- TypeScript is held at 6.0.x until typescript-eslint supports 7.x.
- On this machine, `corepack enable` needs an admin terminal (Node is in `D:Node`). `corepack pnpm …` works without it.

## Data/schema changes
- Schema v1 (migration 0001 `create_app_meta`): `app_meta(key PK, value, created_at, updated_at, revision)` STRICT, plus the runner's `schema_migrations(version PK, name, applied_at)`.

## Decisions
- ADR-0001 … ADR-0006 (stack defaults and approved Nov 6 product decisions)
- [ADR-0007](../adr/0007-pnpm-via-corepack.md): pnpm via corepack
- [ADR-0008](../adr/0008-proprietary-license-for-now.md): proprietary license for now
- [ADR-0009](../adr/0009-electron-vite-and-electron-builder.md): electron-vite for builds, electron-builder for packaging
- [ADR-0010](../adr/0010-node-sqlite-binding.md): built-in `node:sqlite` as the SQLite binding

## Next task
- After the #10 PR is merged, pick an unblocked M0 task:
  - **M0-4 Pixi canvas (#7)** (recommended next: it's the next big risk spike), or M0-5 React Flow spike (#8), M0-6 worker messaging (#9), M0-8 art placeholders (#11, would replace the default icon).
  - #20 (block Chromium switches) is a release gate before M3, not urgent for M0.
- Follow the session loop in CLAUDE.md. Verify status claims against the code before relying on them.
