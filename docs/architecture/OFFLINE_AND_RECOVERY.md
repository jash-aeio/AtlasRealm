# Offline Behavior, Artifacts, Backup & Restore

> **Source:** Atlas Realm Build Plan rev 1.1, §19, §20 — copied verbatim from [the archived original](../archive/Atlas_Realm_Build_Plan_v1.1.md). Section numbers are kept so cross-references like "see section 33" still work. Edit this file (not the archive) when the spec changes, and record why in an ADR.

## 19. Offline and failure behavior

| Situation | Required behavior |
|---|---|
| No internet on launch | Open local profile, worlds, projects, installed resource library, and saved artifacts |
| No AI configured | Allow normal organization and editing; explain setup at Run |
| Local runtime not installed | Show setup guidance; do not silently install software |
| Model missing | Show selected requirement and download/setup options |
| Local model insufficient | Explain capability mismatch; allow user-selected compatible alternative |
| Cloud connection unavailable | Preserve state, stop dispatch, and show waiting condition |
| Credentials rejected | Show reconnect action with redacted error; do not endlessly retry |
| Provider rate limit | Honor retry advice within finite limits and visible waiting state |
| Budget exhausted | Stop new billable calls and preserve completed work |
| File changed since selection | Surface changed digest and require re-snapshot where needed |
| External reference missing | Show exact reference and re-link option; do not substitute unrelated files |
| Disk full or output write fails | Keep prior artifact revisions intact; report incomplete output |
| App crash during model request | Recover as interrupted; acknowledge possible usage charge |
| Crash during unknown external write | Block automatic retry pending reconciliation |
| UI closes, tray runner enabled | Continue under visible background state |
| Full quit, sleep, or power-off | No promise of local execution; apply recovery/missed-run policy later |
| Package update breaks compatibility | Keep prior active-run snapshot; disable incompatible new assignments |
| Database migration fails | Keep backup and provide recovery path; never overwrite the only copy |
| World canvas fails to render | Keep conventional project list and panels usable |
| Relationship index is stale | Show freshness, preserve manual links, and offer bounded reindexing |
| Obsidian is absent or disabled | Core graphs and projects still work; keep exported files |
| Obsidian note was externally edited | Stop overwrite and present conflict/save-copy options |
| Linked import root moved/disconnected | Preserve metadata and artifacts; request an explicit re-link |
| Import classification is ambiguous | Show evidence and use editable Generic Project fallback |
| PixelLab is unavailable or account quota is exhausted | Use bundled/placeholder assets; no blocking request on app startup |
| Credential storage unavailable | Session-only or connection unavailable; no silent plaintext fallback |

Network state is capability-specific. A reachable local runtime does not prove a cloud provider is available. An internet connection indicator does not prove a specific integration is authenticated.

## 20. Artifacts, backups, and restoration

### 20.1 Artifact behavior

- Store immutable revisions with content digests and originating run/input references.
- New drafts create new revisions; they do not overwrite the only accepted output.
- Mark generated, reviewed, and accepted states separately.
- Text previews are escaped/sanitized; imported HTML/scripts are never executed as application UI.
- Opening files in an external application is an explicit user action through a controlled handler.
- Restrict output names and file types to the exporter's actual supported formats.
- MVP formats: Markdown, plain text, CSV, and JSON where meaningful. Office/PDF exporters are later adapters unless separately implemented and verified.

### 20.2 Backup format

A versioned world backup contains a manifest, a scoped database export, referenced managed input/artifact files, world/interior layouts, manual graph relationships, graph view preferences, template/resource and bundled asset version metadata, and checksums. Derived graph indexes may be rebuilt rather than exported. Obsidian/external root mappings are inert metadata on restore; existing outside files are not silently copied or authorized. It excludes credentials, grants, live sessions, unrelated worlds, cached private provider responses not needed for artifacts, and arbitrary external reference files.

External references remain references unless the user explicitly chooses to include a managed copy and the app has access. Explain that project content itself may be sensitive even though credentials are excluded.

Produce a consistent SQLite snapshot through a supported backup mechanism; do not copy only a live database file and ignore its associated write state. SQLite documents its backup API for consistent backups of a live database. [SQLite backup documentation](https://www.sqlite.org/backup.html).

A world export must be deliberately scoped. Starting from a consistent database backup is acceptable, but filter into a new export database and verify that unrelated profile/world records are absent. Copy immutable artifact versions referenced by that snapshot. Coordinate garbage collection so referenced files cannot disappear mid-export.

### 20.3 Restore behavior

MVP restore targets a new local profile data set, preserving internal IDs. This avoids ambiguous merges and silent replacement of existing entities. Existing-profile merge/clone is a later feature requiring a complete ID remapping design.

Restore steps:

1. Validate archive size, file count, supported schema, paths, and checksums in staging.
2. Reject escaping links, path traversal, invalid database relationships, and unsupported future schema versions.
3. Create a fresh profile and import the validated world data.
4. Exclude or invalidate credential references and grants; require new connections/authorization.
5. Disable imported automations, third-party executable packages, and Obsidian bindings. Linked project/vault roots require explicit re-link and new grants; restored graph nodes may remain visibly unresolved until then.
6. Preserve historical records as history; imported unfinished runs cannot resume automatically.
7. Confirm artifact files exist and show a summary before switching to the restored profile.
8. Leave the current profile untouched if validation fails.

### 20.4 Retention and repair

Offer configurable retention for temporary work, verbose logs, completed run context, trash, and old backups. Never delete accepted artifact versions merely to meet a cache quota. Provide a repair command that reports missing files or inconsistent references before attempting repairs.
