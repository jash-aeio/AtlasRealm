# Product Requirements (PRD)

> **Source:** Atlas Realm Build Plan rev 1.1, §1, §2, §4, §5, §18 — copied verbatim from [the archived original](../archive/Atlas_Realm_Build_Plan_v1.1.md). Section numbers are kept so cross-references like "see section 33" still work. Edit this file (not the archive) when the spec changes, and record why in an ADR.

<details><summary>Original document header</summary>

# Atlas Realm: An Agentic AI Ecosystem

**App name:** Atlas Realm.
**Full title:** Atlas Realm: An Agentic AI Ecosystem.
**Document:** Product and implementation plan, revision 1.1.
**Prepared:** November 5, 2026.
**Updated:** November 6, 2026.
**Approved direction:** Fantasy RPG art; a context-sensitive upper-right Realm Atlas; enterable 2.5D interiors with Blueprint mode; optional Obsidian export/open first; reviewed automatic project imports; PixelLab MCP as the preferred asset-production route.
**Purpose:** A detailed specification and incremental implementation guide for building this application with Claude.
**Status:** Proposed design; no application has been implemented by this document.
**Initial platform:** Windows desktop. Keep boundaries portable for later macOS and Linux support.

**Start here:** Give Claude this file, use the [master project prompt](#271-master-project-prompt), and begin with [M0](#m0--foundation-and-risk-spikes). Keep this document in the eventual application repository as the product/build specification.

### Quick navigation

- [Product vision and boundaries](#2-product-vision-and-boundaries)
- [MVP and later release scope](#4-release-scope)
- [Interface and world controls](#6-interface-and-interaction-specification)
- [Architecture and stack](#7-recommended-technical-architecture)
- [Storage and data model](#9-data-ownership-storage-and-schema)
- [AI provider connections](#11-ai-model-connections-and-provider-adapters)
- [Workflow execution and recovery](#12-workflow-execution-and-multi-agent-coordination)
- [Permissions and approvals](#13-permission-and-approval-model)
- [Automations and scheduling](#15-automations-and-scheduling)
- [Verification strategy](#22-verification-strategy)
- [Milestone roadmap](#23-milestone-implementation-roadmap)
- [Copy-ready Claude prompts](#27-copy-ready-prompts-for-claude)
- [Final implementation checklist](#29-final-implementation-checklist)
- [Realm Atlas and relationship graphs](#30-realm-atlas-and-relationship-graphs)
- [Enterable interiors and Blueprint mode](#31-enterable-interiors-and-blueprint-mode)
- [Optional Obsidian bridge](#32-optional-obsidian-bridge)
- [Import Existing Project wizard](#33-import-existing-project-wizard)
- [Fantasy art direction and PixelLab asset pipeline](#34-fantasy-art-direction-and-pixellab-asset-pipeline)

---

</details>

## 1. How to use this plan with Claude

Give Claude this entire file as project context. Use the master prompt in section 27, then ask it to implement one milestone at a time. Do not ask for the entire ecosystem in a single generation.

This document distinguishes three kinds of decisions:

- **Requirement:** A behavior that preserves the user's stated concept or protects data and execution correctness.
- **Recommended default:** A concrete implementation choice that can be changed with an explanation in the decision log.
- **Later expansion:** A capability deliberately excluded from the first usable release.

Before implementation, Claude should inspect the actual repository, identify existing conventions, verify current dependency compatibility, and record selected versions. Official API examples and authentication requirements can change; this document does not freeze model names, prices, or SDK versions.

For each milestone, Claude should:

1. Read the relevant sections and inspect existing code.
2. Identify a small, reviewable implementation slice and its acceptance criteria.
3. Implement the slice without replacing unrelated working functionality.
4. Run relevant automated checks and the milestone's manual acceptance steps.
5. Update `docs/IMPLEMENTATION_STATUS.md` with what works, evidence, limitations, and the next task.
6. Report actual behavior. Label mock providers, placeholders, and unsupported integrations explicitly.

The first milestone must not require a paid API account. The world, persistence, and execution tests should work with a deterministic mock provider. Real AI functionality is added later and must be tested separately from mock execution.

## 2. Product vision and boundaries

### 2.1 Product promise

A beginner-friendly desktop application where users organize projects as buildings in a fantasy RPG world, enter 2.5D isometric project interiors, inspect connections through a context-sensitive Realm Atlas, assign AI agents and capabilities, supervise work, and reuse workflows as automations. Users can import existing projects, and optionally exchange selected knowledge with Obsidian.

The application should support multiple fields through configurable project packages: personal planning, organizations, marketing, school work, social media, software, and custom projects. Supporting a field means delivering useful, evaluated workflows for that field. It does not mean claiming reliable autonomous execution of every possible task.

### 2.2 Core requirements

1. The application opens and manages local projects without internet access.
2. Users retain access to their files and deliverables without an active cloud account.
3. Each world is a workspace; each project can have a building representation.
4. Ten hotbar slots provide shortcuts and placement access, without limiting project count.
5. A larger library opens through a visible button or `E` when keyboard focus permits.
6. Agents Guild, Skill Library, and Tool Shops have sidebar access and optional world structures.
7. Installed resources remain manageable offline; discovery and downloads require connectivity.
8. Agents can execute bounded tasks and participate in saved workflows.
9. Automations can start those workflows from supported triggers.
10. File access, external actions, provider use, and executable integrations are permission-controlled.
11. AI providers and local model runtimes are interchangeable through explicit adapters.
12. The world shows actual execution state. Cosmetic animations must not imply nonexistent work.
13. Users can operate projects through ordinary accessible controls without moving an avatar.
14. Completed work survives UI closure, application restart, and recoverable interruption.
15. An upper-right Realm Atlas switches between a geographic Map and a contextual Connections graph.
16. Project buildings have an enterable 2.5D cutaway interior and a Blueprint mode; true rotatable 3D is deferred.
17. Project/file/task relationships have explicit types, provenance, and permission-aware visibility.
18. Import Existing Project inspects supported files and proposes a setup for review before committing changes.
19. Obsidian is optional and disabled by default; initial support is selected Markdown/Canvas export and opening notes.
20. Fantasy pixel assets are bundled for offline display; PixelLab generation is an optional online production step.

### 2.3 Recommended initial constraints

- Single user on one computer; local profiles are a convenience boundary, not separate operating-system security identities.
- Local-first data ownership. Cloud synchronization and organization collaboration come later.
- One active model request by default; several logical agents may execute sequentially.
- A maximum initial team of three agents per workflow: coordinator, specialist, reviewer.
- Trusted built-in file tools before third-party executable integrations.
- User-supplied provider credentials; no shared developer API key distributed in the app.
- A modest fantasy world with a finite buildable area and simple placement.
- A 2D/2.5D renderer for both exteriors and interiors; no new real-time 3D engine in the MVP.
- One SQLite-backed relationship model shared by the Atlas panel, project graph, import index, and Obsidian exporter.
- Deterministic folder analysis before optional AI setup suggestions; no silent modification of imported originals.
- No game economy, multiplayer game networking, combat, resource grinding, or pay-to-unlock work capacity.

### 2.4 Explicit limits of an offline desktop system

- A cloud model needs internet even when the interface and files are local.
- A local model needs downloaded weights, compatible software, sufficient memory, and task-appropriate capability.
- A connected online service cannot be used offline merely because its connector is installed.
- A local automation cannot run while the computer is powered off or asleep.
- Always-on business execution needs an awake dedicated machine or a future remote runner.
- Multiple buildings do not imply multiple secure tenants. Business deployment requires additional isolation and administration.
- Generating new assets through PixelLab requires its online service and an eligible account; showing already bundled assets does not.
- Obsidian file export/open can work locally when its prerequisites are installed; cloud sync is a separate service and is not required.

## 4. Release scope

### 4.1 MVP: a complete, useful local loop

The MVP is complete when a user can:

1. Start offline and create a local profile with a default avatar.
2. Create a world and project using a bundled template.
3. Place, move, remove, and reopen a project building.
4. Pin projects to the ten-slot hotbar and find all projects in the library.
5. Recruit bundled agent templates, enable instruction-only skills, and use built-in file tools.
6. Connect a supported local model or supported cloud API account.
7. Run a small workflow with visible progress, cancellation, permissions, and a review step.
8. Open an actual saved artifact and inspect its version history.
9. Create a schedule that reuses the workflow while the local runner is available.
10. Restart the application and recover saved state without falsely reporting interrupted work as complete.
11. Export and restore a world backup without exporting credentials.
12. Inspect project relationships in the upper-right Realm Atlas and open a focused file/task network.
13. Enter a project interior, switch to Blueprint mode, and edit supported text through conventional panels.
14. Import a supported existing folder through a reviewed setup proposal, using a managed copy or a read-only linked root.
15. Enable selected Markdown/Canvas export to Obsidian, open exported notes, and disable the bridge without losing work.
16. Use bundled fantasy assets offline with no PixelLab login or generation request at runtime.

Target adapters by MVP completion: deterministic mock for testing, Ollama for local inference, Anthropic API, and OpenAI API. Build them incrementally; the first end-to-end slice needs only mock plus one real adapter. An unavailable account must not block the other adapters or local organization features.

### 4.2 Included initial resources

- Three agent templates: Coordinator, Project Specialist, Reviewer.
- Four instruction-only skills: summarize provided sources, create a structured brief, check output against requirements, produce a content calendar.
- Built-in tools for listing approved project files, reading supported text files, writing versioned artifacts, and retrieving prior artifact versions.
- Four project packages: Generic Project, Content Campaign, Organization Event, School Research Support.
- A software-planning package can be added after the generic flow works. Running generated code is a later capability with separate isolation.
- A simple schedule editor: once, daily, or weekly; advanced expressions are optional later.
- One cohesive fantasy RPG world theme, a few building appearances, a reusable cutaway interior, and a small avatar selection.
- Realm Atlas with Map/Connections tabs, manual project links, derived file/work relationships, and a bounded focus view.
- Import wizard for ordinary folders and supported text/Markdown/CSV/code-manifest inspection; ambiguous types fall back to Generic Project.
- Optional Obsidian bridge stage O1: user-triggered selected Markdown/Canvas export and note opening.
- PixelLab-authored assets may be generated during development, but placeholders and a local asset pack keep the build usable without service access.

### 4.3 Later expansions

| Expansion | Prerequisite |
|---|---|
| Curated GitHub resource imports | Manifest validation, provenance, license handling, dependency reporting |
| Third-party MCP execution | Installation controls and an enforceable execution boundary |
| Word/Excel/other desktop control | Per-app adapter, focused action permissions, and integration tests |
| Canva and other online services | Supported API/connector, account authorization, explicit capability mapping |
| Browser/computer interaction | Dedicated controller, interruption semantics, isolated environments where feasible |
| Code execution and software development teams | Workspace isolation, resource limits, safe process management |
| Provider subscription sign-in | Currently supported official authentication route and verified deployment eligibility |
| Agent or workflow marketplace | Package trust, updates, compatibility, and distribution governance |
| LAN or cloud runners | Authenticated pairing, job ownership, execution leases, credential separation |
| Shared business worlds | Membership, role controls, isolation, audit, backups, operational support |
| Bidirectional Obsidian edits | Explicit ownership, approved scope, loop prevention, and conflict handling |
| Read-only vault indexing | Selected-folder grants, supported link parser, and incremental index controls |
| Semantic graph suggestions | Optional model access, evidence, review, and rejection handling |
| Full 3D interiors | Separate performance/interaction justification after 2.5D evaluation |
| In-app PixelLab generation | Separate service-use assessment, user account, costs, and integration controls |

Subscription-based access remains a product goal. Do not promise that any consumer subscription automatically supplies an API credential or can be reused in every commercial integration. Track access-method support separately from model support and verify each official route when implementing it.

## 5. User journeys and acceptance behavior

### 5.1 First launch

Recommended flow:

`Open app → local profile → starter world → first project prompt → usable world`

- Provide an offline local profile path; do not block on online account registration.
- Avatar and theme customization are skippable and editable later.
- Clearly offer an empty world, a short guided introduction, and an optional example world.
- Demo projects must be labeled and removable without affecting user projects.
- Do not request broad filesystem access during onboarding.
- Provider setup happens when the user first chooses to run AI, or voluntarily in settings.
- Display what remains usable if no model is connected.

### 5.2 Create and place a project

1. User clicks New Project.
2. User chooses a project package or Generic Project.
3. Required fields: name and a goal; a default world and storage location are already selected.
4. Optional fields: description, deadline, references, budget, team preset, building appearance.
5. Show an editable review of defaults, including recommended agents and tools.
6. Save project data before placement begins.
7. Show a translucent building preview with a valid/invalid footprint.
8. Clicking a valid location places it. Escape cancels placement while preserving the project.
9. Offer to pin the project in an empty hotbar slot. Never silently replace an occupied slot.
10. The project is immediately visible in the library, whether placed or not.
11. Users with existing work can instead choose Import Existing Project; follow section 33 before creating a placement.

### 5.3 Recruit an agent

1. Open Agents Guild from sidebar or placed Guild structure.
2. Switch between Installed and Discover.
3. Open a template card showing role, capabilities, source, version, requirements, and readiness.
4. Choose a target project and optional nickname/appearance.
5. Create a project-scoped agent instance; initially idle.
6. Show missing model, skill, or tool requirements with a direct fix action.
7. An assigned agent must not run just because it was recruited.

### 5.4 Run and review work

1. Select a workflow and inputs in a project.
2. Show a run preflight: model, data destination, tasks, allowed tools, estimated usage where available, and limits.
3. Save an immutable execution snapshot and enqueue the run.
4. Show actual state transitions in the task list and pixel world.
5. When additional authorization is needed, suspend the relevant step and show an approval card.
6. Save outputs as real versioned files with links to the run and input references.
7. A reviewer checks defined criteria and reports evidence or uncertainty.
8. User accepts the result or requests a bounded revision.
9. Completion is based on committed outputs and required checks, not an agent saying "done."

### 5.5 Turn work into an automation

- Only a saved, validated workflow is eligible.
- Copy input bindings, not an entire previous conversation.
- Require a timezone and missed-run policy.
- Explain that execution depends on an available runner and required connections.
- Define which actions have a continuing narrow grant and which still need human approval.
- Preview the next three scheduled times before enabling.
- Show execution history, last result, next time, and a Pause switch.

### 5.6 Remove, archive, and delete

| Action | Effect |
|---|---|
| Unpin | Removes only a hotbar reference |
| Remove building | Removes placement; project remains available and running work is unaffected |
| Archive project | Hides from active views, disables future triggers, cancels queued runs, requests cancellation of active work, and preserves files/history |
| Restore archived project | Makes it active; schedules remain paused until explicitly re-enabled |
| Move project to trash | Requires handling active runs first; preserves a recoverable data set |
| Permanently delete | Explicit destructive action; shows exact data scope and removes owned data only |

Archiving must show any action already in flight that cannot be interrupted. External reference files are never deleted as a side effect of deleting a project. A first release may provide archive and recoverable trash while deferring permanent deletion.

## 18. Starter project packages

### 18.1 Generic Project

Inputs: goal, requirements, selected reference files, expected deliverable, optional deadline. Workflow: organize requirements, create requested draft, check requirements, user review. Outputs: project brief and requested text/Markdown artifact. This is the fallback for work without a specialized package.

### 18.2 Content Campaign

Inputs: organization/product description, audience, objective, tone, channels, date range, content constraints, source materials. Workflow: brief, content calendar, draft posts, claims/style checks, user review. Outputs: Markdown brief, CSV content calendar, text post drafts.

Initial quality checks: required fields present, dates valid, requested number of entries, source-backed claims or explicitly marked uncertainty, consistent tone, no promise of actual publishing. Live trend research and image generation require separate tools added later.

### 18.3 Organization Event

Inputs: event purpose, date/timezone, participants, budget assumptions, responsibilities, venue notes. Outputs: task timeline, responsibility table, CSV budget, announcement drafts. Programmed checks validate totals, required owners, date order, and explicit missing information. Agents must not invent confirmed venue availability or send announcements without tools and authorization.

### 18.4 School Research Support

Inputs: assignment instructions, allowed assistance, topic, supplied sources, required format, deadline. Outputs: source notes, outline, evidence table, draft study/presentation notes. Checks distinguish supplied evidence from unverified claims. The offline workflow cannot claim to have verified a live URL or accessed a paper it has not read. Help users follow their assignment's rules; keep source provenance visible.

### 18.5 Software Planning: first expansion

Inputs: problem, users, requirements, existing repository references if authorized. Outputs: specification, task breakdown, architecture notes, test plan. Actual editing, dependency installation, command execution, tests, and deployment belong to a separately implemented development runner. A plan or generated code snippet is not a working, tested application.

### 18.6 Package definition requirements

Every project package declares input schema, default agent templates, skills, tools, workflow version, artifact types, acceptance checks, offline limitations, and optional automations. Template validation must fail if referenced resources are missing or incompatible.

Evaluate at least two distinct fields before claiming the platform is extensible. Merely changing agent names and building artwork is insufficient evidence.
