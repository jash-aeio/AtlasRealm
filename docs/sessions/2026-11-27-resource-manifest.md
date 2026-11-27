# 2026-11-27: Resource manifest schema and capability registry (#111)

Branch `feat/111-resource-manifest`, milestone M3 (lane A, M3-1). Contract task: M3-2, M3-3,
M3-4 and M3-10 import these two modules, so it goes first.

## Task

Define one validated manifest "envelope" for agent, skill and tool packages (DATA_MODEL §10.1)
and a registry of every known capability ID with a plain label and a risk note (SECURITY §13.1).
Both are pure modules in `src/common`: no files, no database, no Electron.

## Decisions (asked with AskUserQuestion)

- **Version ranges for package references:** our own tiny format, either an exact version
  `1.2.0` or a caret range `^1.2.0` (same major version, this one or newer). No new dependency.
- **Known but not-yet-built capabilities** (for example `network.fetch`): the manifest is
  accepted, and the registry marks the capability "not available yet", so readiness (M3-4) can
  show the package as waiting. Truly unknown capability IDs are refused.

Recorded in ADR-0034.

## Plan

See the plan in the conversation (approved before code). Slices:

1. Capability registry (`src/common/security/capabilities.ts`) + tests.
2. Manifest schema + `parseResourceManifest` with named refusal reasons
   (`src/common/contracts/resource-manifest.ts`) + tests.
3. Docs: ADR-0034, glossary, status, session log.

## What was done

- **Capability registry** (`src/common/security/capabilities.ts`, commit 1f21b7b): all 21
  §13.1 IDs, each with a plain label, a risk note, `available` (true only for the six M3 IDs)
  and the scopes it may be requested for (`selected-project`, `import-session`,
  `selected-external-folder`, `connection`, `linked-vault`). Nothing in it can make a grant.
- **Manifest envelope** (`src/common/contracts/resource-manifest.ts`, commit 2a20976): one
  strict Zod schema for skill, agent and tool. `parseResourceManifest` returns a named reason:
  `not_an_object`, `unsupported_schema_version`, `install_script`, `executable_content`,
  `unknown_key`, `unsafe_path`, `unknown_capability`, `permission_mismatch` or
  `invalid_manifest`. Refusals carry short log lines (at most 10, 200 characters each) for the
  main-process log only.
- Routine choices (not asked, following the spec):
  - An agent's `instructionsPath` is its role instructions. There is no second path field.
  - Every capability a package needs, or a tool implements, must also be in
    `declaredPermissions`, so a preview shows everything. A scope that doesn't fit the
    capability is refused.
  - Paths use an allowlist of characters with forward slashes only. Device names (`NUL.md`,
    `COM¹`) are refused in every folder, and so are hidden dotfiles.
  - `source` only allows `bundled` until imports exist. The license must be an SPDX ID,
    `LicenseRef-…` or `UNLICENSED`; the spec's placeholder is refused.
- ADR-0034, glossary entries (manifest envelope, caret range, permission request vs grant), and
  a short "implemented in" note in DATA_MODEL §10.1.

## Verification

- `pnpm typecheck`, `pnpm lint` and `pnpm format:check` pass.
- `pnpm test`: 1422/1422 (119 new: 26 registry, 93 manifest).
- Mutation check: removing the device-name check failed 4 tests, untagging the path refinement
  failed 25 and skipping the "needed but not declared" check failed 1. The file was restored
  from the commit afterwards.
- No UI change, so no E2E.

## Reviews (/ship)

- **invariant-reviewer:** clean. It re-ran the tests (1422/1422), typecheck and lint, and
  confirmed nothing in the app uses these modules yet.
- **security-auditor:** approve, no Critical or High. All findings fixed in commit 91b3eb9:
  - **M1, self-asserted origin:** a manifest saying `source: bundled` and
    `builtin.structured-brief` was accepted whatever its real origin.
    `parseResourceManifest(raw, origin)` now takes the origin from the loader. An imported
    manifest that claims bundled or `builtin.*` is `origin_mismatch`.
  - **L1, log injection:** an unknown key's name with a newline or terminal escape code went
    into the log lines unchanged. Control characters are now written as `\uXXXX`.
  - **L2, oversized input:** a 50 MB description was still scanned in full (about 1.9 s).
    `.max(…, { abort: true })` now stops at the length check, in `Description` and in the shared
    `DisplayName`, and issues are cut to 10 before formatting.
  - **L3, mutable registry:** `CAPABILITIES` could be changed at run time, and
    `describeCapability('toString')` returned a function. Entries are frozen now, and lookups
    take any string but only match the table's own keys.
  - **L4, `process.execute` declarable:** the user chose to refuse it at parse time as
    `executable_content` (AskUserQuestion, added to ADR-0034).
- After the fixes: typecheck, lint and format:check pass; `pnpm test` 1431/1431. Mutation
  checks: dropping `abort` failed the L2 test, and dropping the escaping failed the L1 test.
  Both were restored.

## Handoffs

- M3-10 (#120) broker: refuse to authorize a capability whose `available` is false, even when
  a grant exists (ADR-0034).
- M3-4 (#114) readiness: report a package that requests an unavailable capability as waiting,
  never Ready. Use `satisfiesRange` for version checks.
- M3-2 (#112) loader: re-check `instructionsPath` on disk with `realpath` (M3-9 path policy).
  Log `issues` in main only. **Cap the `manifest.json` file size (e.g. 64 KiB) before
  `JSON.parse`** (security L2). Call `parseResourceManifest(raw, 'bundled')` only for files
  read from the app's own resources folder.
- Import work (M3-17 onward, or the later community-package import): pass `'import'`. When a new
  source type is added, keep the `builtin.*` and `source: bundled` refusal (ADR-0034).

## What the user wrote

- Nothing: Claude wrote all code and docs. The user made three decisions (version ranges, not-yet-built capabilities, refusing `process.execute`).

## Open questions

- None.
