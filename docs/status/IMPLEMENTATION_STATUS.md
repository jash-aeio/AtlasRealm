# Implementation status

> **The handoff between sessions.** Read this first, every session. Update it before handing work back (`/ship` does it). Treat claims here as notes to verify against the code, not as facts.

**Last updated:** 2026-11-13 · **Branch:** feat/32-project-templates (M1-5 PR, main merged in after #30)

## Current milestone
**M1 — Profiles, worlds, and project persistence** (🚧 in progress: 11 issues, #20 and #29–#38; see `docs/pm/milestones/M1.md`). M1-1 (#20) and M1-3 (#30) are merged. M1-5 (#32, templates) is in review (PR #42).

**M0 — Foundation and risk spikes: ✅ closed 2026-11-10, tag `v0.1.0-m0`.** Evidence: unit/integration 193/193, E2E 35/35, packaged E2E 9/9 on main @ 2fbf944; CI green. See `docs/sessions/2026-11-10-m0-close.md`.

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

- **M0-7 Windows packaging (#10, merged):** `pnpm package` builds `release/AtlasRealm-Setup-<version>.exe` (NSIS) and `release/win-unpacked/`.
  - electron-builder 26.18.0 (`electron-builder.yml`, ADR-0009). Only `out/**` and `package.json` go into `app.asar`, with no `node_modules`. Main bundles zod, and all packages are devDependencies. The renderer is minified (567 → 220 kB).
  - Fuses: RunAsNode, `NODE_OPTIONS` and `--inspect` are off. `file:` extra privileges are off. Embedded asar integrity and OnlyLoadAppFromAsar are on.
  - `file:` is blocked for every request in the default session (`blockFileProtocol`). The `app://` handler bypasses the block for its own files.
  - NSIS installs per-user (no admin) into a folder you can choose. `deleteAppDataOnUninstall: false`.
  - The packaged app is named "Atlas Realm", so its data lives in `%APPDATA%\Atlas Realm`. Dev uses `%APPDATA%\atlas-realm`.
  - The UI shows "Launch #N · first launched … · schema vN" through the new **M0 spike** command `app.launchInfo`. It is read-only, takes no payload, and reads the DB on every call.
  - Placeholders: **unsigned** (SmartScreen warns) and Electron's **default icon**.
  - `scripts/electron-builder.ts`: electron-builder runs `pnpm list` from PATH. When pnpm exists only through corepack, the script makes temporary corepack shims for that one process.

- **M0-4 PixiJS placeholder world (#7, merged):** the window shows a "World (M0 placeholder grid)" section above the panels. It's a **mock world** with no projects, buildings or saved state.
  - `pixi.js` 8.22.0 (exact pin), hosted by our own `WorldCanvas` component, not `@pixi/react` (ADR-0011). Renderer order: WebGL, then Canvas2D. WebGPU is excluded. The status line shows the renderer that's really in use.
  - `projection.ts`: the §17.1 grid ↔ world math, camera pan/zoom (`screen = world × zoom + pan`, zoom 0.25×–4×), and `pickTile` with a fixed edge rule (an edge belongs to the higher-index tile).
  - Grid: 64 × 64 tiles of 64 × 32 px, drawn as one fill plus 130 line segments. Rendering is on demand (no 60 FPS loop).
  - Interaction: a hover readout ("Tile gx, gy"), wheel zoom around the cursor, middle-drag pan, and Zoom out / Zoom in / Reset view buttons. A "Hide world view" toggle (M0 spike) unmounts the view.
  - CSP unchanged: `import 'pixi.js/unsafe-eval'` swaps out Pixi's `new Function()` code.
  - Failure handling: an init failure, a lost WebGL context or a render crash (`WorldErrorBoundary`) shows "World view unavailable…" in the world area. The rest of the UI keeps working.
  - Lifecycle: a `ResizeObserver` on the container resizes the canvas. Unmounting destroys the Pixi app, and an init that finishes after unmount destroys itself.

- **M0-5 Realm Atlas selection-sharing spike (#8):** a "Realm Atlas" panel sits in the upper right of a new workspace grid, next to the world. Everything in it is **M0 mock data**, labelled "M0 spike · mock data".
  - `@xyflow/react` 12.12.1 (exact pin, MIT). Its CSS is bundled into our stylesheet, and it adds no runtime `<style>` tags, so the CSP is unchanged.
  - Shared selection (`src/renderer/state/`): a tiny external store (`store.ts` + `useStore` on `useSyncExternalStore`, no new dependency). `selection.ts` holds the current mock graph and the selected entity ID plus its source (`atlas` or `world`). Unknown IDs are refused, and swapping graphs drops a selection that no longer exists. Nothing is persisted.
  - Mock data (`spike-graph.ts`): 8 mock projects, each with an ID, a grid tile and a cosmetic graph position, plus a deterministic stress graph (150 nodes / 300 edges by default).
  - Connections graph (`src/renderer/atlas/ConnectionsGraph.tsx`): **controlled** selection. The store sets `selected`, and React Flow's "select" changes (from a click, or Enter/Space on a focused node) go to the store. Clicking the pane clears the selection. Dragging, connecting and deleting are off. Edge labels show up to 30 links.
  - `RealmAtlasPanel.tsx` has:
    - a disabled "Map (later)" tab and the Connections tab
    - a selection readout ("chosen in Connections / world view")
    - Clear selection and "Load stress graph (150 / 300)" (M0 spike) buttons
    - a keyboard-usable list view of entities and links (§30.6)
  - World: `grid-scene.ts` gains `setMarkers` (one Graphics for all markers) and `setSelected` (a light-blue tile under the marker). `WorldCanvas` reads the store and tells the scene what to draw, including on a newly created scene. Left-clicking a marker selects it, and clicking empty ground clears the selection. The camera never jumps on selection (§30.1).
  - Hiding the world view keeps the entities and the selection, and showing it again draws the selection straight away.

- **M0-6 worker messaging spike (#9, merged):** the main process starts a background **worker process** at launch. A "Worker check (M0 spike)" panel shows its real state. The worker only runs **M0 spike methods** (`spike.echo`, `spike.slowCount`) and does no product work.
  - Electron `utilityProcess` (ADR-0012), built by electron-vite through a `?modulePath` import (`out/main/chunks/index-<hash>.js`). It's a separate OS process, so a crash or hang can't take main down.
  - Channel: main hands the worker a private `MessagePort` in one `connect` message. Only main and the worker hold it, so no localhost server is involved (§7.2).
  - Protocol (`src/common/contracts/worker-protocol.ts`): Zod envelopes `request`/`cancel` → `ready`/`result`/`error`, with a random UUID per request. Both sides check size (256 KiB, UTF-8 JSON, shared `json-size.ts`, now also used by the IPC router) and schema. Main also validates the worker's results.
  - Cancellation: an `AbortSignal` or timeout settles the request at once and sends `cancel`. The worker aborts that request's `AbortController`. Late replies are dropped and counted (`staleRepliesDropped`).
  - Crash: on an unexpected exit, every pending request fails with `worker_crashed`, and the crash count and exit code are kept and logged. **Nothing is retried.** The next request starts a fresh worker. A deliberate stop (quit) fails pending requests with `worker_stopped` and isn't counted as a crash.
  - Logic with no Electron imports: `src/worker/dispatcher.ts` and `src/main/runtime-bridge/worker-bridge.ts`. Electron glue: `src/worker/index.ts` and `runtime-bridge/utility-transport.ts`.
  - New **M0 spike** IPC commands:
    - `runtime.workerStatus` (no payload)
    - `runtime.workerCheck` (optional `cancelAfterMs` 10–5000, default 100): echo, then a slow count cancelled in flight, then an echo that reads how many requests are still active.

- **M0-8 art contract and placeholders (#11, merged):** ADR-0013 fixes the art values (64 × 32 tiles; 2×2/3×3/4×4 footprints; ground pivot on the footprint's south corner; 16-swatch "warm storybook village" palette). ART_BIBLE §34.3.1 lists them.
  - `resources/assets/asset-manifest.json` (schema v1) is validated by `src/common/assets/asset-manifest.ts` (Zod). Fields: confined relative `.png` path, size, pivot, footprint, optional animation strip, sha256, `placeholder` flag, provenance. A footprint hanging outside its frame is refused.
  - Four **placeholders** in `resources/assets/placeholders/` (ground tile, 2×2 building, selection marker, invalid marker), drawn by `scripts/generate-placeholder-art.ts` (`pnpm art:placeholders [--check]`). PNGs are encoded with `node:zlib`, so there's no new dependency and the bytes are the same every run.
  - World: only the **selection highlight** is drawn from a PNG. It's loaded with a plain `<img>` (not Pixi `Assets`), sampled nearest-neighbour and placed by its manifest pivot. Ground, entity markers and hover are still drawn shapes, now in palette colours. The ground tile, building and invalid marker aren't drawn anywhere yet.
  - Build: `assetsInlineLimit: 0`, so all four PNGs ship as real files under `app://atlas/assets/`.
  - The renderer sets Zod `jitless` (`src/renderer/app/zod-config.ts`). Without it, Zod 4's `new Function` probe causes a `script-src eval` CSP report.

- **M1-1 Chromium switch guard (#20, merged as PR #41):** the packaged app refuses to start with debugging, sandbox-disabling, child-process injection or traffic-interception switches (SECURITY §21.1, ADR-0015).
  - `src/main/bootstrap/switch-guard.ts` holds the deny-list (29 switches) and the checks. `src/main/index.ts` runs it first: when `app.isPackaged` and a listed switch is present, it logs `[security] refusing to start with blocked switches: …` to stderr and calls `app.exit(1)` before the lock, DB, protocol or window. No dialog.
  - Detection uses `app.commandLine.hasSwitch` (Chromium's parser), so `-x`, `/x` and upper-case spellings are caught.
  - `pnpm package:test` builds a **test-only variant** (`release-test/win-unpacked/AtlasRealmTest.exe`, folder only, own appId and data folder) whose asar package.json carries `atlasRealm.packagedTest: true`. That variant allows `remote-debugging-port` only. CI builds it after the installer and never uploads it.
  - `pnpm dev` and the dev E2E suite are unaffected (not packaged).

- **M1-3 schema v2 + repositories (#30, merged as PR #40):** the database now has its first product tables. No UI or IPC uses them yet (M1-6/M1-7 add the commands).
  - Migration 2 adds `profile_settings`, `worlds` and `projects`. All three are STRICT and have `created_at`, `updated_at` (UTC) and `revision`.
  - CHECK constraints: names trimmed and 1–80 characters, slug IDs, semver template versions, `#rrggbb` avatar colours, preferences a JSON object of at most 16 KiB, profile ID `default` or a UUID (ADR-0014).
  - Project status is `active`, `archived` or `trashed`. A table CHECK keeps it consistent with `archived_at`/`trashed_at`.
  - `projects.world_id` is a foreign key (`ON DELETE RESTRICT`). Index `projects_by_world_status`, which the query planner uses.
  - `ProfileSettingsRepository`, `WorldRepository` and `ProjectRepository` are the only code that touches these tables. Every update takes an expected revision (optimistic concurrency, lesson 012).
    - A stale revision fails with `revision_conflict` (plus the current revision) and changes nothing.
    - Other stable codes: `not_found`, `already_exists`, `invalid_input`, `invalid_transition`.
    - Each update is one `UPDATE … RETURNING` statement, and repositories open no transactions, so callers can group writes (M1-4).
  - Rename keeps the project ID. Archive and trash are status + timestamp changes, and there is no delete method. Restoring from trash returns a project to archived if it was archived, else active (ADR-0016). A trashed project can't be edited.
  - Input is validated before SQL: code-point lengths that match SQLite; control, invisible spoofing and unpaired-surrogate characters refused; canonical IANA timezones (bare offsets like `+02:00` refused); preferences limited to plain JSON data, 16 KiB and 32 levels.

- **M1-5 project template metadata (#32, branch `feat/32-project-templates`):** two bundled templates, **Generic** and **Content Campaign** (PRD §18.1, §18.2), are checked at startup and listed through `template.list`. They are **metadata only**: input fields, artifact types and offline limitations. There are no workflows or agents until M3/M4, and every manifest says so (`metadataOnly: true`). No UI shows them yet (M1-10).
  - Manifests: `resources/project-templates/<folder>/<version>/template.json`, in the DATA_MODEL §10.1 envelope (`schemaVersion`, `kind: "project-template"`, `id: builtin.<folder>`, `version`, `publisher`, `source: bundled`).
  - Schema: `src/common/contracts/project-template.ts` (Zod, strict objects). It refuses unknown keys (including `workflows`/`agents`), IDs with `/`, `..` or capitals, versions that aren't plain `MAJOR.MINOR.PATCH`, control or invisible format characters in display text, duplicate field keys or option values, and over-long strings or lists. Input field types: `text`, `longText`, `date`, `dateRange`, `choice`, `multiChoice`, `fileReferences`. Generic and Content Campaign share no input field keys (§18.6).
  - Loader: Vite's `import.meta.glob` bundles the JSON into the main process at build time (no runtime file paths, no packaging change). `buildTemplateCatalog` validates each file once at startup. A bad file is listed as `{ status: 'unavailable', location, reason }` (`invalid_manifest`, `location_mismatch`, `too_many_templates`), the Zod detail goes only to the main log, and startup continues. A location that is too long or has odd characters is shown as `(unreadable location)`. At most 100 templates.
  - IPC: `template.list` (no payload, output schema-checked, bounded by the 100 cap) via `window.atlas.template.list()`.

## Changed components
- M1-5: `resources/project-templates/` (new), `src/common/contracts/project-template.ts` (new), `src/main/templates/{catalog,bundled-templates}.ts` (new), `src/main/ipc/commands/template-list.ts` (new), `src/common/contracts/{channels,atlas-api}.ts`, `src/preload/index.ts`, `src/main/ipc/register.ts`, `src/main/index.ts`; `tests/domain/project-template{,-catalog}.test.ts` (new), `tests/integration/template-list.test.ts` (new), `tests/e2e/shell.spec.ts`; docs: glossary, lesson 014
- M1-3: `src/main/storage/migrations/index.ts`, `src/main/storage/repositories/{repository-support,profile-settings-repository,world-repository,project-repository}.ts` (new), `src/main/storage/database.ts` (type re-export); `tests/integration/storage-{migration-v2,project-repository,world-repository,profile-settings-repository}.test.ts` (new), `tests/fixtures/db/v1-app.sql` (new), `tests/integration/app-launch-info.test.ts`, `tests/e2e/storage.spec.ts`, `tests/e2e-packaged/packaged.spec.ts` (schema v2); docs: ADR-0016, lesson 012, glossary
- M1-1: `src/main/bootstrap/switch-guard.ts` (new), `src/main/index.ts`, `package.json` (`package:test`), `electron-builder.yml` (comment), `.github/workflows/ci.yml`; `tests/security/switch-guard.test.ts` (new), `tests/e2e-packaged/packaged.spec.ts`; docs: ADR-0015, SECURITY §21.1, glossary
- M0-8: `src/common/assets/` (new), `scripts/generate-placeholder-art.ts` (new), `resources/assets/` (new), `src/renderer/world/{world-assets.ts (new),grid-scene.ts}`, `src/renderer/app/{zod-config.ts (new),main.tsx}`, `electron.vite.config.ts`, `package.json` (script); `tests/domain/asset-manifest.test.ts` (new), `tests/e2e/world.spec.ts`, `tests/e2e-packaged/packaged.spec.ts`; docs: ADR-0013, ART_BIBLE, ASSET_PROVENANCE, glossary, lesson 011; `.claude/hooks/guard-bash.mjs` (branch checked where the command runs, for worktrees)
- M0-6: `src/worker/` (new), `src/main/runtime-bridge/` (new), `src/common/contracts/{worker-protocol,json-size,runtime-worker,channels,atlas-api}.ts`, `src/main/ipc/{router.ts,register.ts,commands/runtime-worker.ts}`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/app/{App.tsx,WorkerPanel.tsx}`, `tsconfig.node.json` (includes `src/worker`); `tests/integration/{worker-messaging,runtime-worker-contract}.test.ts`, `tests/e2e/worker.spec.ts` (new), `tests/e2e/shell.spec.ts` (API shape), `tests/e2e-packaged/packaged.spec.ts`
- #24 (chore): `.github/dependabot.yml` ignores major-version bumps of `typescript` and `@types/node`. They are upgraded by hand (see Known limitations).
- M0-5: `src/renderer/state/` (new), `src/renderer/atlas/` (new), `src/renderer/world/{grid-scene.ts,WorldCanvas.tsx}`, `src/renderer/app/{App.tsx,app.css}`, `package.json` + lockfile; `tests/domain/selection-store.test.ts`, `tests/e2e/atlas.spec.ts` (new), `tests/e2e/world.spec.ts` (locators scoped to the world section)
- M0-4: `src/renderer/world/` (new: `projection.ts`, `grid-scene.ts`, `WorldCanvas.tsx`, `WorldErrorBoundary.tsx`), `src/renderer/app/{App.tsx,app.css}`, `package.json` + lockfile (`pixi.js`); `tests/domain/projection.test.ts`, `tests/e2e/world.spec.ts` (new)
- M0-7: `electron-builder.yml`, `scripts/electron-builder.ts` (new), `electron.vite.config.ts`, `package.json` (scripts, deps), `pnpm-workspace.yaml`, `tsconfig.{node,e2e}.json`, `playwright.packaged.config.ts` + `tests/e2e-packaged/` (new), `.github/workflows/ci.yml`; `src/main/bootstrap/app-protocol.ts`, `src/main/index.ts`, `src/main/ipc/{register.ts,commands/app-launch-info.ts}`, `src/common/contracts/{app-launch-info,channels,atlas-api}.ts`, `src/preload/index.ts`, `src/main/storage/repositories/app-meta-repository.ts`, `src/renderer/app/App.tsx`; `tests/integration/app-launch-info.test.ts`, `tests/e2e/{shell,storage}.spec.ts`
- M0-9: `src/main/bootstrap/app-origin.ts` and `app-protocol.ts` (new), `window.ts`, `src/main/index.ts`, `src/main/ipc/router.ts`; `tests/security/app-protocol.test.ts` (new), `tests/integration/ipc-router.test.ts`, `tests/e2e/shell.spec.ts`
- M0-3: `src/main/storage/` (database, migrate, migration-rules, migrations, repositories, app-database), `src/main/index.ts` (DB at startup, single-instance lock), `tests/integration/storage-*`, `tests/e2e/storage.spec.ts`; both E2E specs use a temporary `--user-data-dir`
- M0-2: `electron.vite.config.ts`, `playwright.config.ts`, `tsconfig.{base,node,web,e2e}.json` (tsconfig split per environment), `package.json` scripts
- `src/main/` (bootstrap, ipc), `src/preload/`, `src/renderer/`, `src/common/contracts/`, `src/common/security/`
- `tests/integration/`, `tests/security/`, `tests/e2e/`; CI gains an E2E step
- M0-1: root tooling config, `src/common/errors/`, `tests/domain/`, `.github/workflows/ci.yml`

## Verification
- M1-5, 2026-11-13, local Windows 11, rebased on main @ be2ad19 (with #20): typecheck, lint, format:check pass. Unit/integration 314/314 after the review fixes (303 before them). E2E 36/36 (1 new: `template.list` returns `builtin.content-campaign@1.0.0` and `builtin.generic@1.0.0` from the built main process, and the preload exposes `template.list` only).
  - Schema tests: both bundled manifests validate. Malformed fixtures are refused: unknown keys, `workflows`/`agents`, unsafe IDs (`../x`, `a/b`, `Builtin.X`), bad versions (`1.0`, `01.0.0`, `1.0.0-beta`), duplicate keys or options, a `choice` without options, empty or over-long lists. The two templates' input field keys don't overlap.
  - Catalog tests: a bad manifest becomes `invalid_manifest` and the others still load. A folder that disagrees with its manifest becomes `location_mismatch`. Overflow beyond 100 is reported once. The output is sorted and deterministic.
  - Before the rebase (2026-11-13), three unit runs under heavy load (a peer session on the same machine) gave 2, 1 and 0 failures out of 262. The failures were always in M0 timing tests (`ipc-router` 10 MB payload, `worker-messaging` cancellation) and passed when re-run alone. Likely the same flake as the M1-1 note under Known limitations.
  - Not re-run: packaged E2E. The build-time import is the same in a packaged build and is covered by the dev-build E2E.
  - invariant-reviewer: no violations. security-auditor: approve, no Critical/High/Medium. Fixed with tests: L1 (one long or odd folder name failed the output schema for the whole list; such locations are now shown as `(unreadable location)` and logged JSON-quoted), L2 (display text refuses control and invisible format characters such as U+202E), S2 (an unexpected glob key is kept whole). Mutation checks: undoing L1 failed 3 of the 4 new location tests, and undoing L2 failed all 6 new display-text tests.
  - Not acted on: S1 (Vite's glob follows symlinks, so a symlink committed under `resources/` could pull in an outside file at build time; a CI "no symlinks" check is a possible follow-up). S3 (a disk loader for user-installed templates needs path confinement and a size cap) is noted under Known limitations.
- M1-3, 2026-11-11/13, local Windows 11: typecheck, lint, format:check pass. Unit/integration 273/273 (80 new across 4 files). E2E 35/35. Packaged E2E 9/9 (fresh `pnpm package`; the installed app shows "schema v2" across restarts). All re-run on 2026-11-13 after the review fixes.
  - After merging main (with #20): unit/integration 314/314, E2E 35/35, packaged E2E 14/14 (fresh `pnpm package` + `pnpm package:test`). typecheck, lint and format:check pass.
  - Migration: the frozen v1 fixture (`tests/fixtures/db/v1-app.sql`) upgrades to v2, keeps `app_meta` byte for byte, and leaves a v1 backup. A test keeps the fixture's table shapes equal to what migration 1 produces.
  - Raw-SQL constraint tests (no repository): FK refuses an unknown world and deleting a world with projects. CHECKs refuse padded, empty or 81-character names, a 2001-character goal, unknown statuses, status/timestamp mismatches, unsafe template IDs, a non-UUID project ID, and bad profile settings. An 80-character non-ASCII name fits.
  - Repositories: a stale revision gives `revision_conflict` with the current revision for rename, goal, archive and trash, and the row is unchanged. Rename keeps the ID. Archive/trash round-trips never change the row count. Archived-then-trashed restores to archived. A rollback in the caller's transaction undoes a repository update. Data survives closing and reopening the file.
  - Found by tests and fixed: `Intl` accepts `+02:00` as a time zone, so the check now also requires an IANA-shaped name.
  - **Flaky test that exists on main too** (not caused by this branch): `ipc-router.test.ts` "rejects a huge binary payload by shape" fails about 1 run in 3. Zod's lazy JIT compile calls `JSON.stringify` the first time it sees the schema, and the test's spy catches it. The same failure happens in a clean `origin/main` worktree. Follow-up suggested.
  - Not checked: `pnpm dev` by hand (nothing visible changed besides "schema v2").
  - invariant-reviewer: no violations. Every acceptance criterion confirmed with file and test references.
  - security-auditor: approve, with no Critical/High/Medium findings and no SQL injection path. All 7 Low findings were fixed before the PR, with tests:
    - L1/L2: preferences must be plain JSON data, at most 32 levels deep. Circular values, BigInt, Date, Map and NaN are refused instead of throwing raw errors or being silently changed.
    - L3: names and goals refuse bidi overrides/isolates, zero-width spaces and marks ("Trojan Source" spoofing). Names also refuse line/paragraph separators. Zero-width joiners stay allowed (emoji, Persian).
    - L4: unpaired surrogates are refused (SQLite would have replaced them with U+FFFD).
    - L5: timezones are stored in canonical spelling (`europe/amsterdam` → `Europe/Amsterdam`).
    - L6: migration 2 CHECKs tightened while it's still unreleased: exact UUID shape, no NUL in text columns, IANA-shaped timezone.
    - L7: settings `create` is one `INSERT … ON CONFLICT DO NOTHING RETURNING`, so a race gives `already_exists`, not a raw UNIQUE error.
    - Mutation check: disabling the spoofing check or the plain-data check fails 4 tests.
  - Forward notes for M1-6/M1-7, listed in PR #40 (posting them on #33/#34 is left to the user): Zod-validate runtime types before calling a repository (F1), give preferences a strict schema (F2), map `RepositoryError.code` to IPC errors and never forward raw messages (F3), keep `guardedUpdate` private to the repositories folder (F4), decide whether projects may be created or renamed in an archived world (F5).
- M1-1, 2026-11-11, local Windows 11: typecheck, lint, format:check pass. Unit/integration 234/234 (41 new). E2E 35/35. Packaged E2E 14/14 (5 new) on a fresh `pnpm package` + `pnpm package:test` (re-run 2026-11-13 after the review fixes).
  - Review fixes (security-auditor M1, M2, L2, L3; invariant-reviewer suggestion): 10 more switches, among them `disable-features`, `disable-gpu-sandbox`, `in-process-gpu`, `ssl-key-log-file`, `log-net-log` and `remote-allow-origins`. The variant moved to `release-test/` with its own identity. New marker test: the shipped asar has no marker, the variant's does (positive control). The port is now polled every 50 ms until exit, not checked once afterwards. The `--js-flags` timing comment was corrected.
  - The positive control caught a real mistake: `allow-file-access-from-files` (suggested by the review) is set by Electron itself, so listing it made every launch exit. It was removed, with a comment.
  - The first unit run had 1 failure out of 224. Its output was lost, and 4 reruns all passed: an unidentified flaky test (see Known limitations).
  - Packaged, shipped build: with no switches it opens its DB and keeps running (positive control). `--remote-debugging-port` in four spellings (`--`, `-`, `/`, upper case) exits 1 with the `[security]` line, the port never answers and no DB is created. `--remote-debugging-pipe`, `--no-sandbox`, `--disable-web-security`, `--js-flags` and `--proxy-server` also exit 1. `--inspect=0` is now refused outright, on top of the fuse.
  - Packaged, test variant: all CDP smoke tests pass (so it opens the port: the positive control for the port check). `--remote-debugging-port` plus `--no-sandbox` still exits 1, reporting only `no-sandbox`.
  - Marker checked by reading both `app.asar` files: `"atlasRealm": { "packagedTest": true }` (a boolean) in the variant, absent in the shipped build. Fuse states are the same in both.
- M0-8, 2026-11-10, local Windows 11: typecheck, lint, format:check pass. Unit/integration 168/168 (30 new). E2E 30/30 (1 new). Packaged E2E 8/8 (1 new; run before the schema bounds were added, and those don't touch packaging). `pnpm art:placeholders --check` is clean.
  - After merging main (with M0-6): unit/integration 193/193, E2E 35/35, packaged E2E 9/9 (fresh `pnpm package`). typecheck, lint and format:check pass.
  - Hook fix: `.claude/hooks/guard-bash.mjs` now reads the branch where each sub-command runs (`cd <dir> &&`, `git -C <dir>`). It falls back to the session folder when that folder isn't a repository. Checked with 14 allow/block cases: commit or push from the worktree allowed; commit on main via cd or `-C` blocked; push to main, force push and `--no-verify` blocked.
  - Manifest tests: each PNG's header size, chunk CRCs and sha256 match. Pivots sit on the south corner. The generator reproduces the committed bytes. The schema rejects `..`, absolute paths, drive letters, backslashes, duplicates, bad digests, out-of-frame pivots and frames that don't fit, Windows device names (`nul.png`, `aux/x.png`) and oversized values (width > 4096, > 2000 entries, long strings).
  - E2E: the selection sprite is an `<img>` load of `app://atlas/assets/selection-*.png`, with no CSP violations. The existing atlas selection-pixel tests now depend on the PNG.
  - Packaged: the hashed PNG decodes from `app://atlas` inside the packaged app, and the world reaches ready.
  - Mutation checks, each of which made a test fail: sprite hidden → 2 atlas tests; inlining back on → the new world test.
  - Not checked: `pnpm dev` by hand.
  - security-auditor: approve. L1 (Windows device names in paths) and L2 (no size bounds) are fixed with tests. Advice not acted on: `data:` in CSP `img-src` looks unused now that inlining is off. Removing it is a security change for the user to decide (follow-up). Note for the future importer: realpath/symlink confinement and hashing the bytes actually read. invariant-reviewer: no violations. It noted that `pivotPosition` is only exercised through the 1×1 selection sprite in E2E.
- M0-6, 2026-11-10, local Windows 11: typecheck, lint, format:check pass. Unit/integration 163/163 (25 new). E2E 34/34 (5 new in `worker.spec.ts`; the worker spec also passed 20/20 over 4 repeats). Packaged E2E 8/8 (1 new).
  - Spawn: `app.getAppMetrics()` lists exactly one Utility process named "Atlas Realm worker". Its pid matches the status and differs from main's.
  - Cancel: the check returns `cancelled` with 0 requests still active, in under 3 s (a broken cancel would take about 10 s). Unit test: the counting loop stops within one step of the cancel.
  - Crash: the test kills the pid from outside.
    - The status shows `crashed` with crashes 1 and a non-zero exit code, and the process is gone from the metrics. `app.ping` still works.
    - The next check starts a new pid.
    - A kill during an in-flight request returns `worker_crashed` within 2 s, without waiting for the 3 s cancel.
  - Quit leaves no worker process.
  - Packaged: the worker runs from inside `app.asar` at a non-ASCII install path, with nothing unpacked; checked by listing the asar too. Check, crash, restart and quit cleanup all work.
  - Mutation checks, each of which made a test fail:
    - no `cancel` message sent
    - no failing of pending requests on exit
    - the worker ignoring the signal
    - no output validation
    - no stale-worker guard
    - no worker size check
    - no exit forwarding in the Electron transport
  - Survived: removing `worker.stop()` on quit. Electron ends utility processes on app exit by itself, which E2E confirms, so `stop()` only labels the exit as deliberate.
  - Found by tests and fixed:
    - The check waited out its cancel delay even after a crash.
    - A time-based crash test was flaky; it now waits on `pendingRequests`.
    - Our `serviceName` shows up in the metrics' `name` field.
  - Not checked: `pnpm dev` by hand with the worker (a background dev-server launch was blocked by the permission check), and real CPU-heavy work in the worker.
  - security-auditor: approve with changes.
    - Fixed: M1 (a request racing quit could fork a new worker; `stop()` is now final, with a test and a mutation check) and L3 (a fork failure at startup no longer prevents the window from opening).
    - Deferred to before M4, listed under Known limitations: M2 (crash-loop backoff), L1 (single-flight `workerCheck` and a cap on pending requests), L2 (gate or remove the spike commands and the pid in renderer responses).
    - Noted for M4: I1 (don't log payloads in worker errors) and I3 (pass the worker a minimal `env`).
  - invariant-reviewer: no violations. Its one note (the session log was unfilled at review time) is done.
- M0-5, 2026-11-10, local Windows 11: typecheck, lint, format:check pass. Unit/integration 138/138 (13 new). E2E 29/29 (6 new in `atlas.spec.ts`, built app, production CSP).
  - Graph click → world: `data-selected-entity` matches, and the pixel at the projected tile (beside the marker) turns selection blue. It was ground before (control) and goes back to ground when another node is selected.
  - World click on a marker → the same graph node is `.selected` (exactly one). Clicking empty ground clears both views.
  - Keyboard: Enter on a list-view button, and Enter on a focused React Flow node, both select through the store.
  - Hiding the world, selecting, then showing it again: the new Pixi scene draws the highlight.
  - No CSP violations or console errors. React Flow's CSS is applied.
  - Performance at 150 / 300 (6 runs; on #8 and in ADR-0003):
    - load 84–184 ms
    - graph click → world ID 67–100 ms
    - wheel-zoom frames: p50 6.9 ms, p95 7–14 ms, worst 14–35 ms
    - E2E ceilings are loose (3 s / 500 ms) for CI.
  - Mutation checks, each of which made a test fail: highlight off (2), no initial selection on a new scene (1), graph ignoring the store (4), click-only selection (1).
  - Screenshots checked by eye. Not checked: `pnpm dev` by hand, a packaged run with the Atlas, screen readers.
- M0-4, 2026-11-10, local Windows 11: typecheck, lint, format:check pass. Unit/integration 125/125 (17 new projection tests). E2E 23/23 (8 new in `world.spec.ts`, built app, production CSP). Renderer used locally: WebGL.
  - The grid draws real pixels: `webContents.capturePage` finds ground colour at the centre and background past the map edge. No CSP violations, no console errors.
  - Hover, wheel zoom and middle-drag pan give the expected tiles (e.g. "Tile 30, 34" after a 64 px pan).
  - The canvas and its drawing buffer follow two window sizes.
  - Leaks: 20 hide/show cycles, then 20 hides during init (more than 10 must really race). Live WebGL contexts return to baseline. Pixi keeps one page-wide helper context (`getTestContext`).
  - Forced `loseContext()`: the message shows, `app.ping` works, and after `restoreContext()` the world is back.
  - With WebGL blocked (init script), it falls back to Canvas2D and draws ground pixels. With all canvas contexts blocked: state `failed`, an alert, disabled zoom buttons, and launch info and `app.ping` still work.
  - Mutation checks, each of which made a test fail: removing `pixi.js/unsafe-eval`, the ResizeObserver, unmount destroy, late-init destroy or `EDGE_EPSILON`, and a grey ground colour.
  - Not checked: `pnpm dev` by hand (StrictMode double mount), Canvas2D on a real GPU-less machine, §17.4 performance targets, or a packaged run with the world view.
  - security-auditor: approve. L2 (the CSP-violation listener now runs from an init script before app code) and L3 (an ESLint `no-restricted-imports` rule allows Pixi imports only in `grid-scene.ts`) are fixed. L1 (asset loader workers) is a note for M0-8, listed below. invariant-reviewer: no invariant violations. It found a wrong exercise answer in lesson 007 (fixed) and a stale status doc (updated in this commit).
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
  - Packaged tests connect over CDP (`--remote-debugging-port`), because the inspect fuse stops Playwright's `_electron.launch`. Since M1-1 they drive the test-only variant, because the shipped build refuses that switch.
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
- Worker (M0-6):
  - Only spike methods. No leases, persisted runs or orchestration yet (M4).
  - No crash-loop backoff: every request after a crash starts a new worker (security M2). Add backoff and a `failed` state before M4.
  - No cap on pending requests, and `runtime.workerCheck` isn't single-flight (security L1).
  - The spike commands ship in production builds and give the renderer the worker pid (security L2). Gate or remove them before M4. Tests can read the pid via `app.getAppMetrics()`.
  - `runtime.workerCheck` can hold a slow count for up to 5 s per call. It's a spike command; remove it or rate-limit it when real run commands arrive.
  - The worker's console output is inherited by the app's stdout (no log file yet).
  - The "error" event of `utilityProcess` (experimental) is not used; `exit` is the crash signal.
- No product features yet: the world is a placeholder grid and the Realm Atlas shows mock entities; no real projects or buildings. The DB holds only launch facts.
- Realm Atlas (M0-5): mock data only, with no Map tab, resize, pin, expand, search, filters or grouping.
  - At "fit to view" the 150-node stress graph is too small to read. Readability, not speed, is the limit (§30.6 grouping/expansion).
  - React Flow's attribution link can't open, because the shell blocks navigation. How to credit it is still open.
  - The renderer bundle is ~684 kB. Vite warns about chunks over 500 kB; that's harmless for a local app.
  - Selection latency (~70–100 ms at 150 nodes) should be profiled before the limits go up.
- World view: WebGPU is off (ADR-0011). Canvas2D was only tested by forcing it. The CI runners have no GPU, so either renderer is accepted there. Performance with buildings is unmeasured. The world has no keyboard tile selection yet (the zoom buttons are keyboard-usable). A list equivalent comes with real projects (UI_SPEC §6.6).
- Pixi's bundled "agent skills" (pnpm prompt) were not approved. They aren't needed.
- Textures (M0-8): we don't use Pixi's `Assets` loader (its `blob:` workers and `fetch`/CORS don't fit our CSP or `app://`). Load art with `<img>` like `grid-scene.ts` does. Keep `blob:` out of the CSP.
- Packaged app: no resource-timing entries are recorded for `app://` loads. The "every resource is from app://atlas" loop in the packaged "works offline" test therefore checks an empty list (since M0-7). Its script and stylesheet checks, which read the DOM, are real. Cause unknown; a follow-up.
- Art: only placeholders exist. 3×3/4×4 placeholders, ground and buildings drawn from art, and the invalid marker in use all come with M1 placement. The palette lives in two places (generator script and `world-assets.ts`) because Node runs the script without a bundler.
- CSP `img-src` still allows `data:`, which no longer seems needed (security-auditor advice). Removing it is a user decision; follow-up.
- Imported asset packs (later) need main-process path confinement (realpath, no symlinks) and digest checks on the bytes read. The manifest schema only checks path text.
- Zod in the renderer runs `jitless` (no generated parsers). Fine at today's sizes; measure before parsing large data there.
- `node:sqlite` is a release candidate API (ADR-0010). It works in the packaged build (M0-7 E2E).
- Packaged UI smoke tests run on the test-only variant, not the exact shipped bytes (one package.json field differs, ADR-0015). The shipped build gets the guard tests and the fuse readout. The switch guard is a deny-list: an unlisted dangerous switch would get through.
- Switch-guard follow-ups from the security review (not done in #20): (1) an allowlist step over `process.argv` as a second layer. It reverses the deny-list decision, so it needs your call. (2) Decide "test build" at bundle time (Vite `define`) so the exception code isn't in the shipped bundle at all. (3) Refuse to start when `SSLKEYLOGFILE` is set, once provider keys exist (environment variables bypass `hasSwitch`). (4) No packaged negative test for a missing or malformed marker (unit tests only).
- One unit-test run (M1-1) failed once with 1/224 and couldn't be reproduced in 4 reruns. Output lost; the test is unidentified. Watch CI for a repeat. On 2026-11-13 under heavy load (M1-5), the timing-sensitive M0 tests in `ipc-router.test.ts` (10 MB payload) and `worker-messaging.test.ts` (cancellation after 30 ms) failed intermittently. Likely candidates; a follow-up issue if CI shows it.
- Templates (M1-5): metadata only. No `template.get` yet (summaries leave out help texts and limits), and nothing uses the templates until `project.create` (M1-7) and the create form (M1-10). User-installed templates will need a separate loader from disk with path confinement. Bundled ones are only checked at startup, so a broken bundled template shows as unavailable instead of failing the build (a JSON syntax error does fail the build).
- Unsigned build: SmartScreen warns, and asar integrity only stops corruption and casual tampering. Without a signature, a local attacker can patch the hash in the `.exe` too. Code signing is a release decision (costs money).
- Electron's default icon is still a placeholder (not in M0-8's acceptance criteria; follow-up). The `app-update.yml` that electron-builder generates is unused (no updater).
- The `file:` block covers the default session only. Any future `session.fromPartition` needs its own block (rule in `app-protocol.ts`).
- CI actions are pinned by tag, not commit SHA (supply-chain hardening, low risk with `contents: read`).
- Node 24.13 `fs.cpSync` silently copies nothing into a non-ASCII destination on Windows. The packaged test uses `fs/promises` `cp`. Avoid `cpSync` for user paths.
- Pre-migration backups are never pruned (retention comes in M7, OFFLINE_AND_RECOVERY §20.4). Two backups in the same millisecond would share a name; the single-instance lock makes that practically impossible.
- Unit tests on Node 24.13 print a harmless SQLite ExperimentalWarning.
- The renderer can't `fetch()` `app://` URLs (no `supportFetchAPI`); grant it only if a feature needs it. Optional CSP + `nosniff` response headers on `app://` are still not added (the CSP is a meta tag).
- TypeScript is held at 6.0.x until typescript-eslint supports 7.x. Dependabot no longer proposes major bumps for `typescript` or `@types/node` (#24). Upgrade TypeScript by hand when typescript-eslint supports TS 7 (typescript-eslint/typescript-eslint#10940), and upgrade `@types/node` when Electron's bundled Node changes major. Dependabot PR #14 (TS 7 + @types/node 26) failed lint and was closed.
- On this machine, `corepack enable` needs an admin terminal (Node is in `D:Node`). `corepack pnpm …` works without it.

## Data/schema changes
- Schema v1 (migration 0001 `create_app_meta`): `app_meta(key PK, value, created_at, updated_at, revision)` STRICT, plus the runner's `schema_migrations(version PK, name, applied_at)`.
- Schema v2 (migration 0002 `create_profile_settings_worlds_projects`, M1-3):
  - `profile_settings(profile_id PK, display_name, avatar_preset?, avatar_colour?, timezone, preferences_json, created_at, updated_at, revision)`
  - `worlds(id PK, name, theme_id, grid_width, grid_height, archived_at?, created_at, updated_at, revision)`
  - `projects(id PK, world_id FK RESTRICT, name, goal, template_id, template_version, status, archived_at?, trashed_at?, created_at, updated_at, revision)` + index `projects_by_world_status(world_id, status)`
  - All STRICT, with CHECKs. An existing v1 database is backed up before the upgrade. No rows are ever deleted by the app.

## Decisions
- ADR-0001 … ADR-0006 (stack defaults and approved Nov 6 product decisions)
- [ADR-0007](../adr/0007-pnpm-via-corepack.md): pnpm via corepack
- [ADR-0008](../adr/0008-proprietary-license-for-now.md): proprietary license for now
- [ADR-0009](../adr/0009-electron-vite-and-electron-builder.md): electron-vite for builds, electron-builder for packaging
- [ADR-0010](../adr/0010-node-sqlite-binding.md): built-in `node:sqlite` as the SQLite binding
- [ADR-0011](../adr/0011-plain-pixijs-webgl-canvas-fallback.md): plain `pixi.js` with our own React wrapper; WebGL, then Canvas2D
- [ADR-0012](../adr/0012-electron-utility-process-worker.md): Electron `utilityProcess` for the trusted worker
- [ADR-0013](../adr/0013-art-technical-contract.md): art technical contract (tile, footprints, south-corner pivot, palette, asset manifest)
- [ADR-0014](../adr/0014-local-profiles-storage-and-switching.md): local profiles: adopt the M0 `default` folder; switch in-process, then reload the window
- [ADR-0015](../adr/0015-chromium-switch-guard-and-test-variant.md): Chromium switch guard as a named deny-list; packaged smoke tests use a test-only variant marked inside `app.asar`
- [ADR-0016](../adr/0016-project-lifecycle-and-trash-restore.md): project lifecycle `active`/`archived`/`trashed`; restoring from trash returns to the prior state
- [ADR-0017](../adr/0017-fresh-install-profile-gets-uuid.md): a fresh install's first profile "Default" gets a UUID; only adopted M0 installs keep the ID `default`
- [ADR-0003](../adr/0003-react-flow-realm-atlas.md) confirmed by the M0-5 spike: React Flow for Connections, with selection shared through one store

## Next task
- #20 and #30 are merged; #32 is in review (PR #42). Next: `/start-task 31` (M1-4, graph entity IDs; migration 3 builds on schema v2) and `/start-task 29` (M1-2, profiles index; it edits `src/main/index.ts`, so start it after #32 merges). M1-7 (#34) needs #30, #31, #32 and #33.
  - Suggested follow-up: fix the flaky `ipc-router.test.ts` "huge binary payload" test (warm up the schema before spying, or spy only on the router's own serialization). It is probably also the "unidentified flaky test" seen during #20 and the load-related failures seen during #32.
  - Possible follow-ups: an app icon; removing `data:` from CSP `img-src` (needs your decision); the empty resource-timing list in the packaged test.
- Follow the session loop in CLAUDE.md. Verify status claims against the code before relying on them.
