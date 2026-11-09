# Lesson 009: Dependency updates and semver
**Milestone:** M0 · **Date:** 2026-11-10 · **Related:** `.github/dependabot.yml`, issue #24, PR #14 (closed)

## The concept (plain words)
Most packages number their releases with **semantic versioning** (semver): `MAJOR.MINOR.PATCH`.
- **Patch** (6.0.3 → 6.0.4): bug fixes only.
- **Minor** (6.0 → 6.1): new features that shouldn't break existing code.
- **Major** (6 → 7): breaking changes are allowed. Expect to read the release notes and maybe change code.

**Dependabot** is a GitHub bot that opens PRs when newer versions come out. We **group** all dev-tool updates into one weekly PR, which keeps the noise down. The catch: one bad update in a group fails CI for the whole PR.

## What happened (PR #14)
Dependabot bundled two major jumps into one PR:
- **TypeScript 6 → 7.** TS 7 is a rewrite of the compiler in Go. Typecheck passed, but typescript-eslint (our lint plugin) refuses to run on it yet, so `pnpm lint` crashed. CI stops at the first failure, so the remaining steps were skipped, and GitHub reported every check as failed.
- **@types/node 24 → 26.** `@types/*` packages contain only type descriptions. `@types/node` tells the editor which Node.js APIs exist. We run Node 24 (Electron's bundled Node and `engines: >=24`), so Node 26 types would let us write calls that crash at runtime. The types must follow the runtime, not race ahead of it.

## The fix
An `ignore` rule tells Dependabot to skip major bumps for these two packages:
```yaml
ignore:
  - dependency-name: 'typescript'
    update-types: ['version-update:semver-major']
```
Patch and minor updates still arrive automatically. Major upgrades become their own planned task: check compatibility, read the release notes, and change code if needed.

## Common mistakes
- **Merging a red dependency PR "because it's only tooling".** Lint and typecheck are part of our safety net. If they can't run, nothing is being checked.
- **Reading "all checks failed" literally.** Open the log and find the *first* failing step. Everything after it was usually just skipped.
- **Bumping `@types/node` independently of the runtime.** Upgrade it together with Electron or Node.
- **Ignoring majors forever.** An ignore rule is a promise to upgrade by hand, so keep a note of it (we keep ours in IMPLEMENTATION_STATUS "Known limitations").
