# ADR-0010: Use `node:sqlite` (built into Electron's Node) as the SQLite binding

- **Status:** Accepted
- **Date:** 2026-11-08
- **Milestone(s) affected:** M0-3 (storage, migrations), M0-7 (packaging), all later milestones
- **Decided by:** jash-aeio (asked via AskUserQuestion on 2026-11-08)

## Context
ADR-0004 settled on one embedded SQLite database per profile, accessed only through main-process repositories, with versioned migrations and a pre-migration backup (DATA_MODEL §9.1–9.2, OFFLINE_AND_RECOVERY §20). It left the binding (the library that lets JavaScript talk to SQLite) open for M0-3 (issue #6). Whatever we pick has to load inside Electron's main process today and in a packaged Windows build later (M0-7). It also needs a supported way to take a consistent backup (OFFLINE_AND_RECOVERY §20.2).

Evidence gathered on 2026-11-08:
- Electron 45.2.3 (our pinned version) bundles **Node 24.22.2** and **SQLite 3.53.4**. I checked this by running `process.versions` under `ELECTRON_RUN_AS_NODE`.
- In that runtime, `require('node:sqlite')` loaded and ran a create/insert/select. It exports `DatabaseSync`, `StatementSync`, `Session`, `constants` and `backup`.
- Node 24 docs ([sqlite.html](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)): **Stability 1.2, release candidate, since v24.15.0**. No flag needed since v22.13.0. `enableForeignKeyConstraints` defaults to `true`. `backup()` uses SQLite's online backup API.
- better-sqlite3 v13 moved to N-API prebuilds. Electron 41 broke earlier better-sqlite3 prebuilds.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| **`node:sqlite`** | Ships with Electron's Node, so there's nothing to install and no native build step. pnpm `allowBuilds` stays empty, and packaging doesn't need asar unpacking for a `.node` file. It has `backup()` built in and turns foreign keys on by default. | Release candidate, not yet "stable": the API may still change a little in later Electron/Node versions. Its SQLite version follows whatever Electron ships. Fewer conveniences than better-sqlite3 (e.g. there's no `db.transaction()` helper). |
| better-sqlite3 | Mature, widely used, stable API, many extras. | A native dependency: it needs an `allowBuilds` entry, prebuilds have to match Electron, and packaging needs asar unpacking. It has broken on Electron upgrades before (Electron 41). |

## Decision
We chose **`node:sqlite`**. It removes the riskiest part of M0-7 (shipping a native module) and covers everything ADR-0004 needs: transactions, foreign keys and online backup. To limit the impact of release-candidate API changes, only `src/main/storage/` imports `node:sqlite`. The rest of the app goes through our own repositories.

## Consequences
- Easier: install, CI and packaging have no native SQLite build. Unit and integration tests run on plain Node 24 (dev machine 24.13.1), where `node:sqlite` works but prints an ExperimentalWarning. Electron's 24.22.2 doesn't print it.
- Harder: we write our own small transaction helper (`BEGIN`/`COMMIT`/`ROLLBACK`).
- Follow-up: M0-7 must show `node:sqlite` working in the **packaged** build (ADR-0004 consequence still applies).
- Signals to revisit: an Electron upgrade changes or removes `node:sqlite` APIs we use; we need an extension or feature it doesn't expose (e.g. encryption via SQLCipher); or real performance problems show up. Switching would only touch `src/main/storage/`.

## Learning note
A "binding" is the bridge between JavaScript and a library written in C, like SQLite. Using the one already built into the runtime means there's no extra compiled code to install, rebuild or package. That's the main reason Electron apps often struggle with SQLite.
