# Learning log

Your personal trail of what you learned while building Atlas Realm. Each lesson is short: the concept, how it shows up in this project, and a tiny exercise. Claude writes one (`/lesson <topic>`) whenever a task introduces something new, and you can ask for one any time.

| # | Lesson | Milestone | Concepts |
|---|---|---|---|
| 001 | [AI-assisted development workflow](lessons/001-ai-assisted-dev-workflow.md) | Setup | spec-driven development, CLAUDE.md, skills, hooks, subagents, MCP, PR flow |
| 002 | [The quality toolchain](lessons/002-the-quality-toolchain.md) | M0 | package manager, lockfile, type check, lint, format, tests, CI, exhaustiveness checks |
| 003 | [Electron process model and safe IPC](lessons/003-electron-process-model-and-ipc.md) | M0 | main/preload/renderer, sandbox, context isolation, contextBridge, CSP, validated IPC |
| 004 | [Database migrations, transactions and safe backups](lessons/004-migrations-transactions-backups.md) | M0 | migrations, schema version, transactions, rollback, WAL, online backup, repositories |
| 005 | [Origins, custom protocols and path traversal](lessons/005-origins-custom-protocols-path-traversal.md) | M0 | origin, custom protocol, app://, path traversal, positive control |
| 006 | [Packaging, asar and fuses](lessons/006-packaging-asar-and-fuses.md) | M0 | packaging, installer, NSIS, asar, asar integrity, fuses, CDP, code signing |
| 007 | [Rendering as a pure view](lessons/007-rendering-as-a-pure-view.md) | M0 | isometric projection, inverse projection, camera, WebGL/Canvas2D, WebGL context, error boundary, StrictMode, mutation check |
| 008 | [One store, many views](lessons/008-one-store-many-views.md) | M0 | single source of truth, external store, useSyncExternalStore, controlled component, React Flow |
| 009 | [Dependency updates and semver](lessons/009-dependency-updates-and-semver.md) | M0 | semantic versioning, Dependabot groups, ignore rules, @types/node vs runtime Node |
| 010 | [Worker processes, request IDs and cancellation](lessons/010-worker-processes-and-cancellation.md) | M0 | utility process, message passing, request IDs, AbortController, crash detection, stale replies |
| 011 | [Sprites, pivots and an asset manifest](lessons/011-sprites-pivots-and-an-asset-manifest.md) | M0 | sprite, footprint, ground pivot, asset manifest, digest, nearest-neighbour sampling, placeholder art, Zod JIT/jitless |
| 012 | [Optimistic concurrency and soft delete](lessons/012-optimistic-concurrency-and-soft-delete.md) | M1 | revision, expected revision, lost update, optimistic concurrency, soft delete, CHECK constraint, STRICT table, RETURNING |
| 013 | [Command-line switches, deny-lists and build-time markers](lessons/013-command-line-switches-and-build-markers.md) | M1 | Chromium switch, deny-list vs allowlist, same-parser rule, build-time marker, positive control |
| 014 | [Validated manifests, discriminated unions and graceful degradation](lessons/014-validated-manifests-and-graceful-degradation.md) | M1 | manifest, strict schema, discriminated union, build-time import, graceful degradation, invisible format characters |
| 015 | [Atomic file writes and turning untrusted text into paths](lessons/015-atomic-files-and-untrusted-ids.md) | M1 | atomic write, fsync, rename, path traversal, allowlist, branded type, fail closed, TOCTOU |
| 016 | [Paired writes, savepoints and tombstones](lessons/016-paired-writes-savepoints-and-tombstones.md) | M1 | transaction, savepoint, nested writes, tombstone, graph entity, backfill, composite foreign key, mutation check |

## Suggested reading order for the docs
1. `docs/README.md`: the map
2. `docs/product/PRD.md` §2: what we're building
3. `docs/product/PRODUCT_RULES.md` §3.1: the rules
4. `docs/process/DEVELOPMENT_WORKFLOW.md`: how we work
5. `docs/process/CLAUDE_SETUP_GUIDE.md`: what each Claude tool does
