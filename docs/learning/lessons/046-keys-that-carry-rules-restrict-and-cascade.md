# Lesson 046: Keys that carry rules, RESTRICT and CASCADE
**Milestone:** M3 · **Date:** 2026-11-28 · **Related:** `src/main/storage/migrations/index.ts` (migration 7), `src/main/storage/repositories/{resource-package,resource-world,agent-instance,binding}-repository.ts`, issue #113, ADR-0036, glossary "Composite foreign key"

## The concept (plain words)
A database can enforce more rules than "this column isn't empty". Schema v7 uses three ideas to make bad states impossible.

1. **Natural key vs surrogate key.** A *surrogate key* is an invented ID, such as a random UUID, that means nothing on its own. A *natural key* is made of facts that already identify the thing. A package version is already identified by `builtin.writer` + `1.0.0`, so that pair is the primary key of `resource_packages`. It reads well in every join, and it gives a clear rule for free: the same id@version can't be recorded twice. Projects still use UUIDs, because their names change and are never identities.
2. **A foreign key that carries a kind.** A CHECK only sees its own row. It can't ask "is the package this agent points at really an agent?" So the kind is copied into the key itself. `agent_instances` has `template_kind`, fixed by `CHECK (template_kind = 'agent')`, and its foreign key is `(world_id, template_id, template_version, template_kind)`, pointing at the same four columns of `world_resources`. One foreign key now says four things at once: the package is installed, in *this* world, at *this* version, and it is an agent. Skill and tool bindings do the same with `'skill'` and `'tool'`. The parent table needs a UNIQUE index on exactly those columns, which is why `world_resources_installed` and `resource_packages_id_version_kind` exist.
3. **What a delete does: RESTRICT or CASCADE.** Every foreign key says what happens when the row it points at is deleted.
   - `ON DELETE RESTRICT`: refuse the delete. Uninstalling a package that an agent still uses fails, and so does deleting a project with agents.
   - `ON DELETE CASCADE`: delete the children too. Dismissing an agent also removes its skill bindings, because a binding means nothing without its agent.

   Pick CASCADE only when the child is *part of* the parent, and RESTRICT when the child is someone else's data that must not vanish by accident.

## Why Atlas Realm needs it
PRODUCT_RULES §3.1 says removing a representation must never delete a project, and M3 must show clear status instead of broken state. Later, M3-5/M3-6 commands take values from the renderer, which is untrusted. Even if a service forgets a check, the database still refuses an agent from another world, a skill used as an agent, or an uninstall that would leave an agent pointing at nothing.

## Where it lives in our code
- **Migration 7** (`m0007ResourcesAndTeam`): the six tables, the kind columns, the UNIQUE indexes that the foreign keys point at, and a comment listing every delete behavior.
- **Repositories** check first and give stable codes (`not_found`, `already_exists`, `invalid_transition`). For example, `WorldResourceRepository.uninstall` lists the users (`usersOf`) before trying. The foreign keys are the last line of defence.
- **The installed version is looked up, never trusted:** `AgentInstanceRepository.create` and `BindingRepository.bindSkill/bindTool` read the version from `world_resources` instead of taking it from the caller.
- **Tests:** `tests/integration/storage-migration-v7.test.ts` hits the tables with raw SQL (no repository), and `storage-resource-repositories.test.ts` covers the typed methods.

## Common mistakes
- **Forgetting the parent's UNIQUE index.** SQLite only accepts a foreign key that points at a primary key or a UNIQUE set of columns.
- **Indexing only the parent.** When a parent row is deleted, SQLite searches the children. Without an index on the child's foreign key columns, that is a full table scan.
- **CASCADE as a convenience.** Cascading from projects would make "delete a project" silently wipe agents and bindings. Use RESTRICT and make deletion an explicit step.
- **Assuming foreign keys are on.** In SQLite they are off unless every connection turns them on (`openDatabase` passes `enableForeignKeyConstraints: true`).
- **Changing a referenced value in place.** With RESTRICT, updating `world_resources.package_version` while agents use it fails. A future upgrade must move the installed row and its users together, with `PRAGMA defer_foreign_keys = ON` inside one transaction.
