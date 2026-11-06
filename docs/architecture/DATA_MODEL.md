# Data Model, Storage & Resource Packages

> **Source:** Atlas Realm Build Plan rev 1.1, §9, §10 — copied verbatim from [the archived original](../archive/Atlas_Realm_Build_Plan_v1.1.md). Section numbers are kept so cross-references like "see section 33" still work. Edit this file (not the archive) when the spec changes, and record why in an ADR.

## 9. Data ownership, storage, and schema

### 9.1 Storage layout

Use the operating system's application-data directory, resolved through the desktop framework. Do not hardcode the developer's home path.

```text
<application-data>/
  profiles-index.json       # Minimal profile IDs and display names
  profiles/<profile-id>/
    app.sqlite
    worlds/<world-id>/
      projects/<project-id>/
        inputs/            # Managed copies of user-imported files
        artifacts/         # Immutable artifact revision files
        scratch/           # Temporary run-specific work
    packages/<resource-id>/<version>/
    cache/
    logs/
    backups/
```

Secrets are stored through the vault; the database holds opaque references. Profile data is not automatically encrypted merely because it is local or stored in a separate directory. An app lock is not equivalent to disk encryption. Defer app-managed passwords until a clear authentication and encryption design exists; rely on the OS session initially.

### 9.2 Common conventions

- UUIDs or another stable collision-resistant ID format; never use display names as keys.
- UTC instants for events; separate IANA timezone identifiers for schedules and display preferences.
- Explicit schema versions for imported manifests, workflow definitions, and backups.
- Foreign keys enabled; indexed query paths and documented deletion behavior.
- `created_at`, `updated_at`, and revision numbers on mutable records.
- Use integers for currency in the chosen small unit or precise decimal handling; do not accumulate currency with binary floating-point arithmetic.
- One database writer service. Use transactions for state changes and related events.
- Database migrations have reproducible fixtures and a pre-migration backup.
- JSON is acceptable for bounded, validated configuration; core relationships must be queryable and constrained.

### 9.3 Principal tables

| Table | Essential fields and constraints |
|---|---|
| `profile_settings` | Local profile ID, display name, avatar config, timezone, preferences |
| `worlds` | ID, name, theme ID, grid dimensions, camera settings, archived timestamp |
| `projects` | ID, world ID, name, goal, template ID/version, status, settings revision |
| `building_placements` | ID, world ID, project ID nullable, service kind nullable, appearance ID, tile position, rotation; exactly one target; unique placed project |
| `hotbar_slots` | World ID, slot 0–9, target type, target ID; unique world/slot |
| `resource_packages` | ID, kind, version, source, source revision, digest, license metadata, review state |
| `resource_dependencies` | Package/version, dependency ID/range, requirement kind |
| `world_resources` | World ID, installed package/version, enablement settings |
| `agent_templates` | Package/version reference, role instructions, default capability references |
| `agent_instances` | ID, project ID, template/version, nickname, appearance, configuration revision |
| `agent_skill_bindings` | Agent instance ID, skill package/version, enabled state |
| `project_tool_bindings` | Project ID, installed tool/integration ID, enabled capabilities |
| `provider_connections` | ID, provider kind, auth method, model defaults, endpoint policy, vault reference, last health status |
| `model_profiles` | Connection ID, model ID, capability flags, limits, price metadata timestamp and source |
| `integration_connections` | ID, adapter ID/version, account label, vault reference, readiness |
| `permission_grants` | Scope, actor/project, capability, canonical resource constraint, expiry, revocation revision |
| `approval_requests` | ID, run/step, operation payload digest, preview, constraints, expiry, status |
| `workflows` | ID, project ID, name, current version |
| `workflow_versions` | Workflow ID/version, validated definition, input schema, output schema |
| `project_tasks` | ID, project ID, optional run/step link, title, status, acceptance criteria |
| `runs` | ID, project ID, workflow version, frozen snapshot, state, limits, usage totals, timestamps |
| `run_steps` | ID, run ID, logical step key, dependencies, state, assigned agent, checkpoint reference |
| `step_attempts` | Step ID, attempt number, model/tool request ID, timings, result/error classification |
| `tool_invocations` | ID, run/step, operation key, sanitized request, authorization reference, effect state, receipt |
| `artifacts` | ID, project ID, display name, artifact kind, latest revision |
| `artifact_versions` | Artifact ID/revision, immutable relative storage path, digest, run ID, provenance, size |
| `input_references` | ID, project ID, managed copy or external reference, digest, source description, access mode |
| `project_memory` | ID, project ID, kind, content/reference, provenance, approval state, revision |
| `automations` | ID, project ID, workflow version, trigger config, timezone, missed-run policy, enabled |
| `automation_occurrences` | Automation ID, scheduled UTC instant, trigger key, run ID; unique occurrence |
| `jobs` | ID, run ID, state, available time, lease owner/token, lease expiry, attempt count |
| `events` | Monotonic sequence, entity/run ID, type, schema version, safe payload, UTC timestamp |
| `audit_records` | Actor, operation, target, policy decision, approval reference, safe result summary |
| `usage_reservations` | Run ID, request ID, estimated upper-bound reservation, settlement state |
| `trash_entries` | Owned entity ID, trash time, retention metadata, restoration information |
| `project_relations` | World, source/target project IDs, type, user-confirmed state, provenance; descriptive by default |
| `graph_entities` | Stable entity reference, kind, project scope, source locator, content/index revision, tombstone state |
| `graph_edges` | Source/target entity IDs, relationship type, origin/evidence, confirmation state, index revision |
| `graph_view_states` | World/project/profile scope, active view/filter, pinned nodes, collapsed groups, layout coordinates |
| `interior_layouts` | Project ID, layout schema/template, cosmetic station positions, room/group bindings |
| `indexed_sources` | Approved root, locator, digest, parser/version, last index status and bounded error |
| `project_import_sessions` | Source root, copy/link mode, file inventory, exclusions, proposed setup revision, commit state |
| `import_mappings` | Import/session and source locator → internal entity ID, digest, external ownership, collision decisions |
| `obsidian_bindings` | Scope, selected vault/root, enabled mode, export subfolder, allowed operations, disabled timestamp |
| `external_note_bindings` | Entity ID, binding ID, relative note path, last exported/observed digest, ownership/conflict state |
| `asset_records` | Asset ID/version, bundled path, dimensions/pivot/footprint, source/job reference, digest, license/provenance reference |

Keep resource package tables and template records coherent: template records describe a specific installed package version. Updating a package never silently rewrites an existing run snapshot.

### 9.4 Memory rules

- Temporary reasoning context belongs to a run, not automatically to long-term memory.
- Store approved requirements, decisions, and reusable facts with provenance.
- Keep agent working context separate between projects even when they share a template or model.
- Shared world memory is opt-in and explicitly visible; no automatic client-to-client learning.
- Users can inspect, correct, export, and delete stored memory.
- Do not expose or require private chain-of-thought. Show concise task summaries, actions, sources, and results.

## 10. Resource package format and compatibility

### 10.1 Unified manifest

Use one envelope with kind-specific validated configuration. Example of an instruction-only bundled skill:

```json
{
  "schemaVersion": 1,
  "id": "builtin.structured-brief",
  "kind": "skill",
  "version": "1.0.0",
  "name": "Structured Brief",
  "description": "Create a brief from approved project inputs.",
  "publisher": "Atlas Realm",
  "license": "PROJECT_LICENSE_TO_BE_SELECTED",
  "source": { "type": "bundled" },
  "runtimeCompatibility": { "manifestSchema": 1 },
  "requirements": {
    "modelCapabilities": ["text"],
    "toolCapabilities": ["project.files.read", "project.artifacts.write"]
  },
  "instructionsPath": "SKILL.md",
  "executable": false,
  "declaredPermissions": [
    { "capability": "project.files.read", "scope": "selected-project" },
    { "capability": "project.artifacts.write", "scope": "selected-project" }
  ]
}
```

Select the project's actual distribution license before shipping; the placeholder above is intentionally not a real license declaration. Validate that every referenced file is inside the package root. Declared permissions are requests, never grants.

### 10.2 Resource lifecycle

`Discovered → Downloaded/Staged → Validated → Installed → Enabled → Assigned/Connected → Ready`

Readiness is computed and can change independently: missing dependency, incompatible OS, missing model, connection expired, disabled by user, or blocked by policy.

Installed and enabled are different. An installed skill can remain disabled. An assigned agent can remain blocked until a model is available.

### 10.3 GitHub and local imports

This section covers **agent/skill/tool resource-package imports**, not importing an existing user project. Project-folder onboarding is specified separately in section 33 and is part of the MVP.

First support local import of a documented declarative package format. Then add curated GitHub sources with an explicit mapping, rather than executing unknown repositories.

Import preview must show source, author/publisher, exact revision, file inventory, declared permissions, executable content, license metadata, dependencies, and compatibility findings. Reject path traversal, archive bombs, escaping links, unsupported manifest versions, and install scripts in the declarative MVP path.

An agent prompt from a repository is not automatically a working agent implementation. Adapt role instructions and capabilities to the application's runtime; preserve original attribution and distinguish adapted packages from upstream packages.

Public source availability does not itself grant redistribution or modification rights. Record license information and honor the actual terms before bundling or distributing a resource. [GitHub licensing guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository).

### 10.4 Updates and trust

- Pin source revisions and installed package versions; record content digests.
- A digest identifies bytes; it does not prove a package is safe or authentic.
- Preview changes to executable content, requirements, or permissions before enabling an update.
- Preserve the version used by an active run until completion or an explicit restart.
- Support disable, rollback where compatible, and uninstall without deleting unrelated project artifacts.
- Review labels must say what was reviewed and when. Avoid an absolute "safe" badge.
