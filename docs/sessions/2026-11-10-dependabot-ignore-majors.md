# 2026-11-10: Dependabot PR #14 failure and major-version ignore rules (#24)

**Branch:** `chore/24-dependabot-ignore-majors` · **Issue:** [#24](https://github.com/jash-aeio/AtlasRealm/issues/24) · **PR:** [#25](https://github.com/jash-aeio/AtlasRealm/pull/25)

## Task
The user asked why Dependabot PR #14 ("Bump the dev-dependencies group… with 2 updates") showed every check as failed.

## Findings
- Only the **Lint** step actually failed. Typecheck passed. Format, tests, E2E and packaging were skipped because CI stops at the first failure.
- Cause: TypeScript 6.0.3 → 7.0.2. typescript-eslint 8.72.1 throws `typescript-eslint does not support TS 7.0.` (tracking: typescript-eslint/typescript-eslint#10940).
- The same PR bumped `@types/node` 24 → 26. We run Node 24 (`engines: >=24`, Electron 45's bundled Node), so the types would describe APIs we don't have.

## Decisions
- The user approved this: don't merge #14. Add Dependabot `ignore` rules for semver-major updates of `typescript` and `@types/node`, and upgrade those by hand later. Minor and patch updates keep flowing. This is a reversible config change, so no ADR.
- Close #14 as superseded.

## What was done
- Issue #24 created (the repo has no `chore` label, so it has none).
- `.github/dependabot.yml`: an `ignore` block with a comment explaining why.
- Docs: IMPLEMENTATION_STATUS (changed components, known limits; also corrected M0-5 from "in review" to done, since #8 is merged), ROADMAP (M0 7/10), glossary (semver, Dependabot), lesson 009.
- Verification: typecheck, lint, format check and unit tests (138/138) pass locally. The YAML parses, and the `ignore` block is under the npm entry.

## Open questions
- When typescript-eslint supports TS 7, plan an upgrade task (TS 7 + typescript-eslint together).
- When Electron is upgraded, check its bundled Node major and move `@types/node` with it.
