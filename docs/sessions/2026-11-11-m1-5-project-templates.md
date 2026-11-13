# 2026-11-11: M1-5 Project template metadata (#32)

## Task
Ship the bundled **Generic** and **Content Campaign** project templates as validated metadata (PRD §18.1, §18.2, §18.6; DATA_MODEL §10.1), plus a `template.list` query. Metadata only: no workflows or agents until M3/M4.

## Where the work happened
Another Claude session switched the main checkout to `feat/30-schema-v2-repositories` while this one was starting. To avoid mixing files (as happened on 2026-11-10), #32 ran in its own worktree, `.claude/worktrees/32-project-templates`, on branch `feat/32-project-templates`.

## Plan (approved)
1. Contract + manifests + schema tests
2. Catalog loader + tests
3. `template.list` IPC + tests (unit, router, E2E)
4. Docs

## Decisions
You decided, via AskUserQuestion:
- **Bundling:** a build-time import. Vite's `import.meta.glob` bundles every `resources/project-templates/*/*/template.json` into the main process, the same way the renderer bundles the asset manifest. This needed no electron-builder change and no runtime file paths. A JSON syntax error fails the build, and anything else is caught at startup. Templates installed by the user (later) will need a separate loader that reads from disk.
- **Invalid templates are listed** as `{ status: 'unavailable', location, reason }`. The Zod details go only to the main-process log.

Routine choices (not asked):
- The manifest follows the DATA_MODEL §10.1 envelope: `schemaVersion`, `kind: "project-template"`, `id` (`builtin.<folder>`), `version`, `publisher`, `source: {type: "bundled"}`. It also has `metadataOnly: true` and a plain-language `metadataOnlyNote`. The schema refuses `workflows` and `agents` keys.
- Input field types: `text`, `longText`, `date`, `dateRange`, `choice`, `multiChoice`, `fileReferences`, each with its own limits.
- Versions are plain `MAJOR.MINOR.PATCH` with no pre-release suffix. IDs are lowercase words joined by `.` or `-`, so no slashes or `..`.
- A template's folder must match its manifest (`generic/1.0.0` ↔ `builtin.generic@1.0.0`). Otherwise it's `location_mismatch`. This also makes duplicate IDs impossible, so there's no separate "duplicate" check.
- There are at most 100 templates, and overflow is reported once. `template.list` takes no payload and needs no paging.
- Summaries leave out help texts and field limits. A `template.get` can be added when the create-project form (M1-10) or `project.create` (M1-7) needs the full manifest.
- One line was dropped from the Content Campaign offline limitations ("unbacked claims are marked uncertain"). It promised a quality check that doesn't exist yet.

## What was done
- `resources/project-templates/{generic,content-campaign}/1.0.0/template.json`
- `src/common/contracts/project-template.ts` (schema and the `template.list` contract)
- `src/main/templates/catalog.ts` (pure validation) and `bundled-templates.ts` (the build-time import)
- `src/main/ipc/commands/template-list.ts`, plus small append-only edits to `channels.ts`, `atlas-api.ts`, the preload, `register.ts` and `index.ts`
- Tests: `tests/domain/project-template.test.ts`, `project-template-catalog.test.ts`, `tests/integration/template-list.test.ts`, and the E2E checks in `shell.spec.ts`
- Glossary: project template, discriminated union, build-time import

## Evidence
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: clean
- `pnpm test`: 262/262 passed (20 files)
- `pnpm test:e2e`: 36/36 passed, including `template.list` returning both templates from the built app

## Coordination
#33 (M1-6) also appends to `channels.ts`, `atlas-api.ts`, the preload and `register.ts`. Whichever merges second gets a small, append-only conflict.

## Open questions
- None blocking. The packaged smoke test (`e2e-packaged`) wasn't re-run. The same build-time import is covered by the dev-build E2E.

## 2026-11-13: re-verification (`/start-task 32`, second session)
- `/start-task 32` found this branch already complete in its worktree. Nothing was re-implemented. The branch is still based on `main` @ dd1bd53, so no rebase was needed.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: clean.
- `pnpm test`: **flaky under load.** 3 runs gave 2 failures, then 1, then 0, out of 262 tests. The failures were always in M0 tests (`ipc-router` "huge binary payload", `worker-messaging` cancellation timing), never in template tests. Re-run on their own, those two files passed 41/41. A peer session was shipping #20 on the same machine at the time. Worth a follow-up issue if it happens again on an idle machine or in CI.
- `pnpm test:e2e`: 36/36 passed, including `template.list` from the built main process.
- Process slip: this session briefly switched the shared checkout to `main` while a peer session was shipping #20 there. It switched back at once, and the peer's uncommitted files (CHANGELOG entry, lesson 012) carried over unchanged. All further work stayed in this worktree.

## 2026-11-13: `/ship`
- #20 merged first (`be2ad19`). This branch was rebased onto it with no conflicts. After the rebase: typecheck, lint and format were clean, unit/integration 303/303, E2E 36/36.
- **invariant-reviewer:** no violations. The manifests honestly say metadata only, the offline limitations match PRD §18.1/§18.2, and a bad template is shown as unavailable without stopping startup.
- **security-auditor:** approve, two Low findings, both fixed in `fix(templates): …`:
  - L1: one very long or odd folder name made the whole `template.list` output fail its schema, so every template would vanish. Such locations now show as `(unreadable location)`, and the real one is logged JSON-quoted.
  - L2: display text (names, labels, help texts, descriptions) now refuses control characters and invisible format characters, such as the right-to-left override that can disguise `txt.exe` as `exe.txt`.
  - S2 also done: an unexpected glob key is kept whole instead of being sliced.
  - Not done: S1, a CI check against symlinks under `resources/` (a build-time risk only; possible follow-up). S3, path confinement for a future disk loader (recorded under Known limitations).
- Mutation checks: undoing L1 failed 3 of the 4 new location tests, and undoing L2 failed all 6 new text tests. Final run: unit/integration 314/314.
- Routine choice (not asked): newlines are now refused in help texts too, since no manifest uses them and the summary UI shows one line. A future multi-line help text would need an explicit allowance.
- Docs: status, roadmap (1/11 done), changelog, glossary (graceful degradation, invisible format characters), lesson 014.
- You wrote no code yourself in this task. Claude wrote all of it, per the project rule.
