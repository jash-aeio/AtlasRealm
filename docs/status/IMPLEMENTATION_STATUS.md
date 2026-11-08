# Implementation status

> **The handoff between sessions.** Read this first, every session. Update it before handing work back (`/ship` does it). Treat claims here as notes to verify against the code, not as facts.

**Last updated:** 2026-11-08 · **Branch:** feat/6-sqlite-migrations (PR for #6)

## Current milestone
**M0 — Foundation and risk spikes** (🔨 in progress; M0-1 and M0-2 done, M0-3 in review)

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
  - Build tooling: electron-vite 6 (ADR-0009). Packaging (electron-builder) is not set up yet.

- **M0-3 SQLite + migrations (#6):** the app now keeps a local database. It has no product data yet, only launch facts.
  - Binding: built-in `node:sqlite` (ADR-0010). Only `src/main/storage/database.ts` imports it. Foreign keys, WAL, busy timeout, defensive mode, `trusted_schema = OFF`.
  - File: `userData/profiles/default/app.sqlite` (DATA_MODEL §9.1 layout; `default` is a placeholder profile ID until profiles exist in M1).
  - Migration runner (`migrate.ts`): one transaction per migration with its `schema_migrations` row and `PRAGMA user_version` bump. An existing DB is backed up first to `profiles/default/backups/`, using the online backup API; the copy is checked. A DB from a newer app is refused untouched. A failing migration leaves the old version and keeps the backup.
  - Schema v1: `app_meta` (key/value), accessed only through `AppMetaRepository`. Startup records `launch_count`, `first_launched_at`, `last_launched_at`.
  - If the DB can't be opened, startup shows an error box (a fixed message, no paths) and quits. It never creates an empty replacement.
  - Single-instance lock: a second copy focuses the first and quits, so two instances can't race through migrations.

## Changed components
- M0-3: `src/main/storage/` (database, migrate, migration-rules, migrations, repositories, app-database), `src/main/index.ts` (DB at startup, single-instance lock), `tests/integration/storage-*`, `tests/e2e/storage.spec.ts`; both E2E specs use a temporary `--user-data-dir`
- M0-2: `electron.vite.config.ts`, `playwright.config.ts`, `tsconfig.{base,node,web,e2e}.json` (tsconfig split per environment), `package.json` scripts
- `src/main/` (bootstrap, ipc), `src/preload/`, `src/renderer/`, `src/common/contracts/`, `src/common/security/`
- `tests/integration/`, `tests/security/`, `tests/e2e/`; CI gains an E2E step
- M0-1: root tooling config, `src/common/errors/`, `tests/domain/`, `.github/workflows/ci.yml`

## Verification
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
- `node:sqlite` in a **packaged** build is unproven until M0-7 (#10). It is a release candidate API (ADR-0010).
- Pre-migration backups are never pruned (retention comes in M7, OFFLINE_AND_RECOVERY §20.4). Two backups in the same millisecond would share a name; the single-instance lock makes that practically impossible.
- Unit tests on Node 24.13 print a harmless SQLite ExperimentalWarning.
- **Security follow-up ([#16](https://github.com/jash-aeio/AtlasRealm/issues/16)):** the built UI loads from `file://`. On a file page, CSP `'self'` covers other local and UNC files. Serve it from a custom `app://` protocol before rendering any untrusted content (security review of #5).
- Renderer bundle isn't minified (~567 kB, electron-vite default). `react`/`react-dom` sit in `dependencies` although they're bundled. Decide both in M0-7 packaging.
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
- After the #6 PR is merged: do the `app://` protocol follow-up ([#16](https://github.com/jash-aeio/AtlasRealm/issues/16)) before any untrusted content is rendered. Then pick an unblocked M0 task:
  - **M0-7 Windows packaging (#10)** is now unblocked (needs M0-2 + M0-3). It must prove `node:sqlite` loads in the packaged app.
  - M0-4 Pixi canvas (#7), M0-5 React Flow spike (#8), M0-6 worker messaging (#9), M0-8 art placeholders (#11).
- Follow the session loop in CLAUDE.md. Verify status claims against the code before relying on them.
