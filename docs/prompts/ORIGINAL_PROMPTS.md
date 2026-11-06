# Original Copy-Ready Prompts (spec §27–28)

> **Source:** Atlas Realm Build Plan rev 1.1, §27, §28 — copied verbatim from [the archived original](../archive/Atlas_Realm_Build_Plan_v1.1.md). Section numbers are kept so cross-references like "see section 33" still work. Edit this file (not the archive) when the spec changes, and record why in an ADR.

## 27. Copy-ready prompts for Claude

### 27.1 Master project prompt

```text
You are helping me build Atlas Realm from the attached implementation plan.

Treat the plan's product rules and security/data invariants as requirements. Treat its stack choices as recommended defaults unless the repository provides a clear reason to adapt them. The target is Atlas Realm: An Agentic AI Ecosystem, a local-first Windows desktop app with a fantasy isometric project world, ten-slot hotbar, library, agents, skills, tools, and automations. Approved additions include an upper-right Realm Atlas (Map/Connections), enterable 2.5D interiors with Blueprint mode, reviewed folder imports, and optional Obsidian Markdown/Canvas export/open before any two-way sync. PixelLab MCP is the preferred development-time asset generator; bundle reviewed assets so normal use works offline.

First inspect the repository and summarize its actual state. If this is a new repository, begin with M0. If work already exists, identify the earliest incomplete prerequisite. Do not attempt the whole platform in one pass.

Implement a small complete slice of the current milestone. Keep the renderer unprivileged, validate commands at the broker, preserve project identity independently of buildings, and persist execution state outside UI components. Use mock providers for deterministic tests and label mock behavior honestly. Never embed credentials or treat arbitrary community packages as trusted code.

Check current official documentation for the dependencies and API behavior you actually use. Pin selected dependencies in a lockfile. Do not assume the plan freezes a current SDK version, model name, price, or subscription entitlement.

Keep docs/IMPLEMENTATION_STATUS.md and docs/DECISIONS.md current. Run relevant checks, describe what was verified, and list any real limitations. Do not claim integrations, recovery, offline AI, or artifacts work unless implemented and demonstrated. Ask only for missing information that blocks a concrete decision; use the plan's recommended defaults for routine reversible choices.
```

### 27.2 Start the foundation

```text
Read the attached plan and implement M0 only, adapting to existing code if present. Prove Electron + React + TypeScript, the preload command boundary, SQLite persistence/migrations, worker communication, and a placeholder PixiJS view. Produce and smoke-test a Windows package if this environment supports it. If packaging cannot be run here, record the exact remaining check rather than claiming success. No real model calls or broad file access. End with a working demo and updated implementation status.
```

### 27.3 Build the world and project model

```text
Continue with the earliest incomplete work in M1/M2. Persist local profiles, worlds, projects, placements, and ten hotbar slots. Project creation must save before placement. Cancelling placement, removing a building, or unpinning must not delete a project. Include a searchable library, ordinary list controls, and the upper-right Realm Atlas with Map/Connections tabs. Add bounded read-only folder inspection and a reviewed copy/link project-import proposal, distinct from package installation. Validate placement again in the command handler. Verify persistence, more than ten projects, keyboard focus, unmodified source folders, and separation of appearance, graph layout, and project identity.
```

### 27.4 Build resources and the permission boundary

```text
Implement M3 from the plan. Add bundled versioned manifests, Guild/Skill Library/Tool Shops Installed views, project-scoped agent instances, readiness states, grants/approvals, trusted file tools, and versioned artifact storage. Community packages must not execute arbitrary scripts. Test denied access, path escapes, malformed manifests, and changed approval payloads. Recruiting an agent must not start a run. Save and reopen a real artifact through the broker before calling this milestone complete.
```

### 27.5 Build real AI execution

```text
Implement M4 incrementally. Build the persisted workflow/run/step state machine and deterministic mock provider first. Add leases, cancellation, tool proposal validation, effect journaling, and checkpoint recovery. Then add a configured Ollama path and the Anthropic adapter behind the same contract. Keep provider calls and credentials in trusted services. Demonstrate draft → check → user acceptance with a real artifact. Label untested live adapters and do not infer real AI quality from mock tests.
```

### 27.6 Add project packages and visible activity

```text
Implement M5. Use one common workflow engine for generic planning, content campaigns, organization events, and school source support. Add project tabs, bounded coordinator/specialist/reviewer roles, programmed checks, artifact provenance, user review, and one allowed revision. Entering a project opens a functional 2.5D cutaway interior with Blueprint mode and conventional editors. Connect station/file selection to the focused Atlas graph through shared entity IDs. Drive canvas status from committed execution events. Evaluate two fields and compare one agent with the multi-role workflow. Do not claim offline research verified online sources.
```

### 27.7 Add background automations

```text
Implement M6. Schedules must persist independently of an open window, have IANA timezones, preview upcoming occurrences, and use a unique occurrence key. Add skip/run-once missed-run behavior and per-automation concurrency. Distinguish window close with tray execution from full quit. Test duplicate ticks, restart, sleep/wake, archived projects, approval waits, and daylight-saving edges. Do not promise local execution while the machine is off.
```

### 27.8 Harden and finish the MVP

```text
Implement remaining M7/M8 requirements. Add scoped world export including manual graph/interior layouts, safe restore into a fresh profile, migration/recovery checks, retention, diagnostics redaction, packaged Windows verification, and the remaining provider adapter contracts. Add optional Obsidian O1 selected Markdown/JSON Canvas export and note opening, with conflict checks and a disable switch. Test exclusion of other worlds/secrets, disabled restored bindings, and offline display of bundled fantasy assets without PixelLab. Produce a truthful support matrix and release-gate evidence. Do not add marketplace, two-way sync, or arbitrary MCP execution before these foundations pass.
```

### 27.9 Resume work in a fresh Claude chat

```text
Read this implementation plan, CLAUDE.md if present, docs/IMPLEMENTATION_STATUS.md, and docs/DECISIONS.md. Inspect the repository and recent changes before editing. Identify the next incomplete prerequisite and continue that slice. Preserve verified functionality and existing data migrations. Treat prior completion claims as notes to check against code and evidence. Update the handoff record with changed files, checks, limitations, and the next concrete task.
```

### 27.10 Suggested CLAUDE.md content

Copy and adapt this into the actual application's repository when implementation begins:

```markdown
# Project instructions

Read the product/implementation plan and docs/IMPLEMENTATION_STATUS.md before working.

- Build one milestone slice at a time; preserve completed behavior.
- The app is local-first. Offline management must not depend on cloud login.
- Projects exist independently of building placement and hotbar slots.
- The renderer has no direct filesystem, database, shell, or secret access.
- Validate every privileged command and authorize every tool/provider operation.
- Community content is untrusted. No arbitrary package scripts or shell execution in the MVP.
- Realm Atlas and project execution work without Obsidian; bridge access is explicit and can be disabled.
- Graph layouts and cosmetic interiors never move source files or grant workflow permissions.
- Project import is reviewed copy/link onboarding, distinct from resource-package installation.
- Use bundled fantasy assets offline; PixelLab generation is a separate online production step with account/quota checks.
- Persist runs, approvals, schedules, and outputs outside UI state.
- Never blindly repeat an external action with unknown outcome.
- Show real execution status and actual artifact files; label mocks and unsupported features.
- No credentials in source, logs, backups, ordinary renderer state, or fixtures.
- Use current official dependency/API documentation and keep a lockfile.
- Test the risks affected by a change; distinguish mock, packaged, and live-provider evidence.
- Record meaningful architecture changes in docs/DECISIONS.md.
- Update docs/IMPLEMENTATION_STATUS.md before handing work back.
```

### 27.11 Build the Realm Atlas and interiors

```text
Read sections 30–31 and the current milestone prerequisites. Build an upper-right Realm Atlas with distinct Map and Connections tabs. World context shows project relationships; project/file context shows a bounded authorized neighborhood. Store typed edges with provenance and preserve manual layout. Enter buildings through a 2.5D cutaway interior with Blueprint mode and functional stations connected to ordinary editors/project controls. Use one shared entity model, not separate facts in each renderer. Verify graph dragging does not move files, descriptive edges do not execute workflows, and context changes never start a run. Keep Obsidian optional and full real-time 3D deferred.
```

### 27.12 Build reviewed existing-project imports

```text
Read section 33 and implement only the next incomplete import slice. Accept a selected local folder; preview copy/link modes, exclusions, file limits, and access. Inspect supported files without running scripts or sending content to a model by default. Propose an editable project type, goal, file groups, typed links, team, and workflow. Commit only the reviewed proposal; leave originals unchanged, linked roots read-only, and proposed automations disabled. Verify cancellation, duplicate roots, source changes, path escapes, Generic fallback, and recovery. This is project onboarding, not installing agent packages or restoring a backup.
```

### 27.13 Build optional Obsidian export/open

```text
Implement Obsidian stage O1 from section 32 after the required grants/artifact services exist. Add a master switch plus scoped project binding, both initially off. Export only selected Markdown notes and a valid JSON Canvas board into an approved subfolder, then support explicit encoded note opening. Compare existing export digests and never overwrite external edits silently. Disabling stops new writes and preserves existing files. Do not claim Canvas edges are Markdown backlinks or implement two-way synchronization in O1. Test the core graph with Obsidian absent and restored bindings disabled.
```

### 27.14 Produce the fantasy asset set with PixelLab

```text
Follow section 34 and inspect docs/ART_BIBLE.md plus existing assets before producing anything. PixelLab MCP is preferred for development-time production; first verify the actual configured client, account access, tool schemas, and batch budget. Do not assume unlimited free service or invent an MCP package. If access is missing, continue engineering with local placeholders rather than blocking the app. Generate one small coherent approved asset family, review scale/camera/palette/seams/pivots/animation, and save only accepted local files with provenance metadata. Never expose tokens or upload unlicensed reference art. The packaged app must display these assets offline without PixelLab. An in-app generative service is a separate later integration.
```

## 28. Implementation handoff template

Claude should maintain a concise record like this inside the eventual code repository:

```markdown
# Implementation status

## Current milestone
M0 — Foundation

## Implemented and demonstrated
- [Concrete behavior and evidence]

## Changed components
- [Paths and purpose]

## Verification
- [Command/check, outcome, environment]
- [Manual journey, outcome]

## Known limitations
- [Mock, untested live path, unavailable platform, or incomplete recovery behavior]

## Data/schema changes
- [Migration/version and compatibility note]

## Decisions
- [Decision-log reference]

## Next task
- [One concrete task with acceptance criteria]
```
