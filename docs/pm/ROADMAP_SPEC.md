# Milestone Roadmap (original spec text)

> **Source:** Atlas Realm Build Plan rev 1.1, §23 — copied verbatim from [the archived original](../archive/Atlas_Realm_Build_Plan_v1.1.md). Section numbers are kept so cross-references like "see section 33" still work. Edit this file (not the archive) when the spec changes, and record why in an ADR.

## 23. Milestone implementation roadmap

Milestones are ordered by dependency. Each should end with a working demonstration and updated status notes. Split a milestone into smaller commits/sessions if it cannot fit safely in one development session.

### M0 — Foundation and risk spikes

**Goal:** Prove the proposed desktop stack can be packaged before building the product on it.

**Build:** repository tooling, Atlas Realm app metadata/title, Electron/React shell, strict TypeScript, minimal preload API, local SQLite create/read transaction, migration runner, placeholder Pixi canvas, a small React Flow/selection-sharing spike, test setup, and one packaged Windows build. Create a minimal art bible; do not require PixelLab credentials to build.

**Checks:** renderer cannot directly access Node; typed command round-trip works; database persists across restart; worker messaging works; packaged assets and SQLite binding load. Record dependency versions and packaging commands.

**Exit:** a packaged app opens offline and displays persisted sample data. No AI calls, public marketplace, or user file access required.

### M1 — Profiles, worlds, and project persistence

**Depends on:** M0.

**Build:** local profile selection, skippable avatar configuration, world creation, project template metadata, project CRUD/archive, conventional project list, and import inspection with bounded inventories/exclusions and reviewed copy/link choices. Basic imports use deterministic classification and Generic fallback; linked roots are read-only until a later explicit edit grant. Add graph entity IDs and basic ownership metadata early.

**Checks:** project creation/reopening works offline; data survives restart; name changes preserve identity; profile isolation works through commands; external files are not deleted with a project; profile switching handles runner state even if no real jobs exist yet.

**Exit:** useful local project management without any canvas interaction or model connection.

### M2 — Isometric world, placement, hotbar, and library

**Depends on:** M1.

**Build:** fantasy isometric projection, camera controls, building footprints, selection, placement preview, move/remove, ten-slot hotbar, searchable library, sidebar service entrances, basic undo/redo for placement, reduced motion, and the upper-right Realm Atlas shell. Map shows geography; Connections shows bounded project nodes and user-created typed links. Imported projects can be placed or left unplaced.

**Checks:** create/cancel placement persistence; no silent slot replacement; collision revalidation; keyboard controls respect text fields; removing a representation preserves the project; all critical actions remain available in list view.

**Exit:** the world accurately represents saved projects and can grow beyond ten projects.

### M3 — Bundled resources and permission broker

**Depends on:** M1; can be implemented after M2 for a visible demo.

**Build:** manifest validation, bundled agent/skill/tool catalogs, Installed views, agent instances, skill bindings, readiness calculation, grants/approvals, trusted file tools, immutable artifact storage, safe previews, audit records, and permission-aware local link/index services. Finish transactional reviewed import commits and duplicate/re-link handling. Imported project instructions cannot grant execution privileges.

**Checks:** incompatible or missing resources show clear status; recruiting does not start work; project-scoped file reads/writes enforce policy; unsafe paths fail; forged renderer requests do not bypass authorization; secrets are not part of resource records.

**Exit:** a user can assemble a project team and capabilities, and a controlled manual tool invocation can save/reopen a real artifact.

### M4 — Durable runtime and first real AI adapter

**Depends on:** M3.

**Build:** run/step state machine, frozen snapshots, queue leases, operation journal, event stream, cancellation, mock adapter, Ollama adapter, model preflight, context limits, usage accounting, and one fixed draft/review workflow. Add Anthropic API connection after the local/mock path works.

**Checks:** mock contract tests pass; output is a real file; local adapter can run offline after setup; pending permissions survive restart; cancellation suppresses later actions; crash recovery distinguishes safe retry from unknown effect; provider errors are bounded and redacted.

**Exit:** one real configured model completes a useful project workflow with an accepted artifact. If hardware/account access prevents a live check, explicitly label that limitation and do not claim live compatibility from mock tests alone.

### M5 — Complete project experience and starter packages

**Depends on:** M4.

**Build:** project tabs plus Connections, human acceptance/revision, Coordinator–Specialist–Reviewer assignments, starter packages, programmed checks, provenance, progress badges, and event-driven agent animations. Add enterable functional cutaway interiors, Interior/Blueprint modes, a supported text/Markdown editor, shared file/station selection, focused graph views, collapsible groups, and typed derived work/file edges. Add a small locally bundled fantasy asset set generated through the optional PixelLab production pipeline or built from placeholders.

**Checks:** workflow limits prevent unbounded loops; generated claims and sources are represented honestly; switching projects does not mix context; accepted vs generated outputs differ visibly; actual run state drives animation.

**Exit:** demonstrate two distinct project fields and compare the multi-role flow to a single-agent baseline.

### M6 — Automations and background runner

**Depends on:** M4 and core M5 views.

**Build:** manual/once/daily/weekly triggers, timezone editor and previews, durable occurrences, missed-run rules, per-automation concurrency, tray lifecycle, notifications, and automation history.

**Checks:** duplicate trigger protection; restart/wake behavior; approval wait in background; full quit stops local execution; archived project does not run; workflow version remains pinned; daylight-saving behavior matches the preview policy.

**Exit:** a scheduled workflow runs while the app remains in tray, produces a saved artifact, and reports the result on return.

### M7 — Backup, restore, recovery, and packaging hardening

**Depends on:** M5 and M6.

**Build:** scoped backup format including manual graph/interior data, fresh-profile restore, migration backups, repair reporting, retention settings, diagnostics export, packaged smoke checks, first-use documentation, and credential storage failure handling. Implement Obsidian stage O1: disabled-by-default, selected Markdown/JSON Canvas export plus explicit note opening. Prevent overwrites; prove core operation with the bridge disabled and PixelLab unavailable.

**Checks:** export excludes other worlds and secrets; restore validates archive paths/digests; imported automations stay disabled; unfinished imported runs cannot auto-resume; failure preserves current data; installer/package works on a clean reference machine.

**Exit:** a usable recoverable desktop application that can be evaluated with real local projects.

### M8 — Provider breadth and MVP completion

**Depends on:** M7; adapters may be developed earlier when useful.

**Build:** finish Anthropic adapter if incomplete, add OpenAI adapter, shared capability/error/usage contracts, account/billing labels, connection health, model-choice UI, and privacy/data-destination preflight.

**Checks:** each supported adapter passes contract tests; actual live-tested status is documented; no silent provider or paying-account switch; missing credentials do not break offline features; model/tool incompatibility is caught before work starts.

**Exit:** all section 4.1 behaviors pass, including reviewed project-folder imports, upper-right graph scope, enterable Blueprint interiors, and optional Obsidian O1; provide a truthful provider support matrix and documented known limitations. Subscription sign-in is not a prerequisite for this API/local-model MVP.

### M9 — Curated discovery and declarative imports

**Depends on:** stable MVP.

**Build:** Discover views, cached catalog metadata, one curated source format, local/GitHub declarative resource-package imports, license/provenance preview, update diffs, compatibility checks, version pins, and disable/rollback. Project-folder import is already in the MVP and is not deferred to this milestone. Optionally add Obsidian O2 selected-folder read-only indexing after O1 and its grants are verified.

**Checks:** offline Installed management remains available; no install scripts execute; unlicensed/unknown-license resources are not silently bundled for redistribution; archive safety holds; updates cannot mutate active snapshots.

**Exit:** users can acquire compatible curated resources without treating arbitrary repositories as executable plugins.

### M10 — Controlled integrations and advanced project execution

**Depends on:** M9 and an explicit extension threat model.

**Build in separate slices:** one restricted MCP integration, one document/application adapter, optional code runner, supported provider subscription authentication, and one new field-specific workflow at a time. Optional later slices include Obsidian O3 bidirectional editing, static code-dependency parsers, reviewed semantic relationship suggestions, and an in-app PixelLab asset studio after the separate service-use assessment. Development-time PixelLab use does not wait for or imply arbitrary in-app MCP support.

**Checks:** each extension has a capability list, enforceable execution boundary, credential scope, installation/update behavior, cancellation semantics, recovery rules, and integration tests. Unsupported platforms/features remain unavailable or clearly labeled.

**Exit:** expansion is based on demonstrated controls and usefulness, not the number of catalog entries.

### M11 — Team and business deployment

**Depends on:** evaluated personal/small-team workflows and a separate product decision.

Define remote-runner deployment, organization identity, membership roles, tenant isolation, centralized policy, backup/recovery objectives, operational monitoring, audit retention, data residency needs, and support procedures. Choose hosted, dedicated on-premises, or hybrid deployment explicitly.

Keep the personal desktop experience working. Do not describe a shared folder of local worlds as enterprise collaboration.
