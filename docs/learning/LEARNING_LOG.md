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
| 017 | [Domain errors across the IPC boundary](lessons/017-domain-errors-across-the-ipc-boundary.md) | M1 | domain error code, internal error, fixed messages, not-found vs forbidden, active profile |
| 018 | [Keyset paging and rebuilding a SQLite table](lessons/018-keyset-paging-and-table-rebuilds.md) | M1 | offset vs keyset paging, cursor, tie-breaker, table rebuild, foreign-key-safe ordering, stub |
| 019 | [Swapping a live resource safely](lessons/019-swapping-a-live-resource-safely.md) | M1 | make-before-break, command gate, refuse vs queue, window reload, worker pause, mutation check |
| 020 | [Derived state, and the renderer as a cache](lessons/020-derived-state-and-renderer-cache.md) | M1 | derived state, cache, re-read after write, newest reload wins, focus management, empty state |
| 021 | [Accessible confirmations: modal dialogs, focus return and live regions](lessons/021-accessible-confirmations.md) | M1 | modal dialog, showModal, focus return, live region, role=status/alert |
| 022 | [Positive controls: proving a test can see what it says didn't happen](lessons/022-positive-controls.md) | M1 | positive control, vacuous pass, CSP refusal vs network request, testing for absence |
| 023 | [Cheap checks first, and what a flaky test is telling you](lessons/023-cheap-checks-first-and-flaky-tests.md) | M2 | flaky test, bounded check, algorithmic-complexity DoS, lower bound, waiting for conditions, mockRestore clears calls |
| 024 | [Guard clauses in a trusted service: check order and failing closed](lessons/024-guard-clauses-and-check-order.md) | M2 | guard clause, check order, fail closed, information leak, synchronous check-then-act |
| 025 | [Database uniqueness constraints as invariants](lessons/025-database-constraints-as-invariants.md) | M2 | invariant in the schema, UNIQUE / partial unique index, CHECK, composite foreign key, code check + constraint backstop, NULLs in UNIQUE |
| 026 | [Shared validation: one rule for the preview and the real check](lessons/026-shared-validation-preview-vs-authority.md) | M2 | shared validation, preview vs authoritative check, pure module, discriminated union result, throw for bugs only |
| 027 | [Trust boundaries for derived data](lessons/027-trust-boundaries-for-derived-data.md) | M2 | trust boundary, derived data from a trusted source, fail closed, one action one transaction, negative control |
| 028 | [The ABA problem and explicit replacement](lessons/028-aba-problem-and-explicit-replacement.md) | M2 | ABA problem, version markers that repeat, expected target, explicit replacement, refusal with details |
| 029 | [One keyboard shortcut layer](lessons/029-one-shortcut-layer.md) | M2 | keyboard shortcut layer, event bubbling, editable targets, modal dialogs, focus restoration |
| 030 | [Drawing order, culling and hit testing](lessons/030-drawing-order-culling-hit-testing.md) | M2 | painter's algorithm, depth key, culling, hit testing, reading the real camera in E2E |
| 031 | [A tool as a state machine: preview, commit, cancel](lessons/031-tool-state-machine-preview-commit-cancel.md) | M2 | state machine, derived preview, commit on pointer release, pointer capture, local vs authoritative refusal, busy guard, focus return |
| 032 | [The command pattern and inverse operations (undo/redo)](lessons/032-command-pattern-inverse-operations.md) | M2 | command pattern, inverse operation, undo/redo stacks, version remapping, no forced retries, unknown outcome |
| 033 | [Debouncing, and choosing a concurrency rule](lessons/033-debouncing-and-last-write-wins.md) | M2 | debounce, flush on exit, last write wins vs optimistic concurrency, replies that must not overwrite local state, reduced motion |
| 034 | [Accessible tabs: the WAI-ARIA tabs pattern and roving tabindex](lessons/034-aria-tabs-and-roving-tabindex.md) | M2 | tablist/tab/tabpanel roles, aria-selected, roving tabindex, automatic activation, preventDefault vs the shortcut layer, filters that load every page |
| 035 | [Bounded graph queries](lessons/035-bounded-graph-queries.md) | M2 | directed links, composite foreign keys, deterministic truncation with omitted counts, hiding trashed rows from counts, resource caps, ticking test clock |
| 036 | [A minimap derived from saved data](lessons/036-derived-minimap-svg-viewbox.md) | M2 | derived views, SVG viewBox in world pixels, non-scaling strokes, camera viewport as the inverse transform, layout guarantees vs overlays, window splitter |

## Suggested reading order for the docs
1. `docs/README.md`: the map
2. `docs/product/PRD.md` §2: what we're building
3. `docs/product/PRODUCT_RULES.md` §3.1: the rules
4. `docs/process/DEVELOPMENT_WORKFLOW.md`: how we work
5. `docs/process/CLAUDE_SETUP_GUIDE.md`: what each Claude tool does
