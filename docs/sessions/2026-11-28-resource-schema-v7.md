# 2026-11-28: Schema v7, resource packages and agent team tables (#113)

## Task

M3-3 [#113](https://github.com/jash-aeio/AtlasRealm/issues/113): migration 7 adds the tables that record
which package versions a world has installed, and which agents, skills and tools a project uses
(DATA_MODEL §9.3). Branch `feat/113-resource-schema-v7`.

## Decisions (asked with AskUserQuestion, recorded in ADR-0036)

1. **Package key = id + version.** `resource_packages` uses `(package_id, version)` as its primary key and
   stores the content digest next to it. One content per id@version per profile: a second package
   with the same id@version and a different digest is refused. A new version is the way to update.
2. **The agent package is the template.** There is no `agent_templates` table. An agent instance points at an
   installed `kind = 'agent'` package. Default skills and tools live in `resource_dependencies`.
   A `kind` column inside each foreign key lets the database refuse a skill or tool being used as an
   agent template.
3. **One installed version per package per world.** Agent instances and bindings point at the
   `world_resources` row, so the database itself refuses to uninstall a package while something uses it.
4. **Dismissing an agent deletes its row.** Its skill bindings go with it (cascade). Projects, artifacts and
   package records are never touched. Runs (M4) keep their own frozen snapshot.

## Plan

1. ADR-0036 + DATA_MODEL §9.3 rows.
2. Migration 7 (six STRICT tables, composite foreign keys, CHECKs, indexes) + v6 → v7 fixture test
   with raw-SQL constraint tests + the schema version bump in the two E2E specs.
3. Repositories: `resource-package-repository.ts`, `resource-world-repository.ts`,
   `agent-instance-repository.ts`, `binding-repository.ts`, with integration tests (no secret columns,
   trashing a project keeps everything, documented deletion behavior).
4. Docs: status, glossary, lesson (in /ship).

## Open questions

- An app update that drops a bundled version a world still has installed shows as "missing" in readiness
  (M3-4/M3-5). Copying package files to `packages/<id>/<version>/` is not part of this task.

## What was done

- `24afd69` ADR-0036 and the DATA_MODEL §9.3 rows.
- `30f585d` Migration 7: six STRICT tables. Composite foreign keys carry the package kind, so agents,
  skills and tools stay in their own world and of the right kind, and uninstalling a used package is
  refused by the database itself. Test `storage-migration-v7.test.ts` (16 tests, raw SQL) also checks
  that no resource table has a secret/credential/token/vault column.
- `a6d4829` Repositories `resource-package`, `resource-world`, `agent-instance`, `binding`, plus 19 integration
  tests. Routine choices (no question asked): recording the same id@version with the same digest returns
  the existing record (a second world installs it); `usersOf` lists what blocks an uninstall, so #115 can
  name it; a stored capability the app no longer knows is dropped on read (ADR-0033 style); tool bindings
  refuse capabilities that packages may not use (`process.execute`). The packaged-refusal check was found
  by a failing test, not planned.
- E2E: the storage spec also lists applied migrations, which I first missed (fixed in a follow-up commit).

## Verification (2026-11-28, on this branch)

- typecheck, lint, format:check: pass
- unit/integration: 1580 passed, 1 skipped (70 files)
- E2E: 117/117 (first run 116/117: the migrations-list miss above, fixed and re-run)
- packaged E2E: 17/17
