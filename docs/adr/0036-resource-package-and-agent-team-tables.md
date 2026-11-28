# ADR-0036: Resource package and agent team tables (schema v7)

- **Status:** Accepted
- **Date:** 2026-11-28
- **Milestone(s) affected:** M3 (M3-3 #113; used by M3-5 #115, M3-6 #116, M3-10 #120)
- **Decided by:** jash-aeio (asked via AskUserQuestion on 2026-11-28)

## Context
M3 lets a world install bundled agent, skill and tool packages, recruit agents into a project and bind
skills and tools to them (PRD §5.3). DATA_MODEL §9.3 lists the tables (`resource_packages`,
`resource_dependencies`, `world_resources`, `agent_templates`, `agent_instances`,
`agent_skill_bindings`, `project_tool_bindings`) but only their essential fields. Four choices shape
every foreign key, so they were asked before migration 7 was written:

1. How a package version is identified.
2. Whether `agent_templates` is its own table.
3. How many versions of one package a world may have installed.
4. What dismissing an agent does to its row.

## Options considered
| Question | Chosen | Alternative | Why |
|---|---|---|---|
| Package key | **`(package_id, version)` natural key**, digest stored | Random UUID per package row | Readable joins and a clear rule (one content per id@version per profile); a UUID would allow confusing duplicates |
| Templates | **The agent package is the template** | Separate `agent_templates` table | The manifest already holds instructions and defaults; a copy could drift |
| Versions per world | **One installed version per package per world** | Several side by side | Lets the database refuse an uninstall while something uses it; simpler Library and readiness |
| Dismiss | **Delete the row; skill bindings cascade** | Soft delete (`dismissed_at`) | Runs (M4) keep a frozen snapshot, so history doesn't need the row; a dismissed agent never blocks uninstalling |

## Decision
Migration 7 adds six STRICT tables. There is no `agent_templates` table.

- **`resource_packages`**: primary key `(package_id, version)`, plus `kind` (`agent`/`skill`/`tool`),
  `name`, `publisher`, `source` (`bundled`/`local`/`github`, so later imports need no table rebuild),
  `source_revision`, `digest_sha256` (64 lowercase hex), `license` (SPDX ID), `review_state`
  (`trusted`/`unreviewed`/`approved`/`blocked`). `trusted` means bundled with the app and only bundled
  packages have it. A second record with the same id@version and a different digest is refused by the
  repository (`already_exists`).
- **`resource_dependencies`**: what a package version needs, with `requirement_kind` `requires`
  (manifest `requirements.packages`), `default_skill` or `default_tool` (an agent's starting team).
  Part of the package record, so they are deleted with it (CASCADE) and never edited.
- **`world_resources`**: primary key `(world_id, package_id)`, so there is one installed version per world.
  It also holds `package_version`, `kind` and `enabled` (installed and enabled are different, §10.2).
- **`agent_instances`**: UUID, the project (composite FK with the world, like placements), the template
  `(template_id, template_version)`, an optional `nickname` (DisplayName rules), an optional
  `appearance_id`, plus `revision` as the configuration revision.
- **`agent_skill_bindings`**: primary key `(agent_instance_id, skill_id)`, the skill version and `enabled`.
- **`project_tool_bindings`**: primary key `(project_id, tool_id)`, the tool version and
  `enabled_capabilities`, a JSON array of capability IDs (bounded, checked by the repository against
  the capability registry). A binding records what the user switched on. It is **not** a permission
  grant (SECURITY §13.2): grants are M3-10's own table.

**Kind inside the foreign key.** SQLite CHECKs can't read other tables. So `world_resources` points at
`resource_packages (package_id, version, kind)`, and each user of an installed package points at
`world_resources (world_id, package_id, package_version, kind)` with a fixed kind column
(`CHECK (template_kind = 'agent')`, `'skill'`, `'tool'`). The database itself then refuses a skill
used as an agent template, a package not installed in *this* world, or a project from another world,
even through raw SQL.

**Deletion behavior** (DATA_MODEL §9.2 "documented deletion behavior"):

| When this is deleted | What happens |
|---|---|
| A package record | Refused while a world has it installed (RESTRICT); its dependency rows go with it (CASCADE) |
| An installed package (uninstall) | Refused while an agent instance or binding uses it (RESTRICT) |
| An agent instance (dismiss) | Its skill bindings go with it (CASCADE); nothing else changes |
| A skill or tool binding | Only that row |
| A project or world | Never deleted in M3; the references are RESTRICT, like every other project reference |

Trashing or archiving a project is a status change, so its agents and bindings stay, as project links do
(ADR-0029). Nothing in these tables ever deletes a package record, project or artifact.

**No secrets.** None of the six tables has a secret, token, password, credential or vault column. A test
reads the schema and fails if one appears. Provider and integration credentials belong to the vault
and to their own tables (`provider_connections`, `integration_connections`), as opaque references.

## Consequences
- Upgrading a world to a new package version is an explicit step that must update the installed row and
  its instances together, in one transaction with `PRAGMA defer_foreign_keys = ON` (the FKs are RESTRICT
  and immediate). No upgrade command exists in M3.
- An app update that stops bundling a version a world still uses shows up as a missing package in
  readiness (M3-4/M3-5). Copying package files to `packages/<id>/<version>/` is not part of M3-3.
- Two imported packages with the same id@version but different content can't both exist. The second
  import has to use a new version (§10.4 updates).
- Adding a new `kind` later means rebuilding `resource_packages` and every table that points at it.
  The `source` and `review_state` lists are already wide enough for imports.
- **Signals to revisit:** users want to undo a dismissal, or need two versions of one package in a world.

## Learning note
A foreign key normally says "this row exists over there". Putting an extra fixed column such as
`kind = 'agent'` into the key makes it say "this row exists over there *and is an agent*", so the
database can enforce a rule that a plain CHECK, which only sees its own row, cannot.
