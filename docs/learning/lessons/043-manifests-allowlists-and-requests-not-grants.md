# Lesson 043: Manifests, allowlists, and "requests are not grants"
**Milestone:** M3 · **Date:** 2026-11-27 · **Related:** `src/common/contracts/resource-manifest.ts`, `src/common/security/capabilities.ts`, ADR-0034, DATA_MODEL §10, SECURITY §13, issue #111

## The concept (plain words)
A **manifest** is a small file that describes a package: its name, its version, who made it, and what it needs. Atlas Realm reads one before it does anything with an agent, skill or tool package. Later it will read manifests that strangers wrote, so the manifest is the first thing an attacker controls.

Three ideas keep it safe:

1. **Allowlist, not deny-list.** Say what is allowed and refuse everything else. A path segment may only use letters, digits, `_`, `-`, and dots or spaces inside the name. We never try to list every dangerous trick (`..`, `C:`, `\\server`, `file.md:stream`…), because some trick will always be missing from that list. The allowlist refuses them all without naming them.
2. **Strict shape.** Unknown keys are refused, not ignored. If we silently ignored `"postinstall": "…"`, a later version of the code might start reading it.
3. **Requests are not grants.** A package's `declaredPermissions` only say "I would like to read project files". The user's grant, checked by the broker at run time, is what allows it. The manifest module has no way to make a grant, and a test checks that it exports nothing with "grant" in its name.

## Why Atlas Realm needs it
Product rule: community content is untrusted, and imports never run scripts (PRODUCT_RULES §3.1). SECURITY §13.2 says installing a tool never grants access by itself. If one module could both read a request and grant it, a single bug would let a package give itself permission.

## Where it lives in our code
- `parseResourceManifest(raw)` runs its checks in a fixed order and returns a **named reason**, such as `install_script`, `unsafe_path` or `unknown_capability`. The user then sees *why* a package was refused, not just "invalid".
- Refinements tag their issues with `params: { reason }`, so the code finds the reason without comparing message text:
  ```ts
  z.string().refine(isSafePackagePath, {
    error: 'path must stay inside the package folder',
    params: { reason: 'unsafe_path' },
  });
  ```
- `CAPABILITIES` in `capabilities.ts` lists all 21 IDs with a label, a risk note and `available`. A known capability that isn't built yet is accepted but marked not available (ADR-0034); an unknown one is refused.

## Common mistakes
- **String-prefix path checks** (`path.startsWith(root)`): `C:\root2` starts with `C:\root`. Text checks are only a first filter, so the loader re-checks the real file on disk (M3-2, M3-9).
- **Forgetting Windows device names.** `docs/NUL.md` opens the NUL device, whatever the folder or extension.
- **Ignoring unknown fields** "to be forward compatible". Use a `schemaVersion` bump instead.
- **Letting a check pass vacuously.** We broke three guards on purpose (a *mutation check*) to see tests fail.

## Try it (5–15 min exercise)
In `tests/domain/resource-manifest.test.ts`, add `'docs/aux.txt'` to the unsafe-path list and run `corepack pnpm vitest run tests/domain/resource-manifest.test.ts`. It passes, because `AUX` is a device name. Then try `'docs/auxiliary.txt'` in the "accepts" list. Why is it allowed? (The check compares the whole part before the first dot.)

## Learn more
- OWASP Input Validation Cheat Sheet (allowlist vs denylist): https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
- Microsoft, Naming files, paths and namespaces: https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file
- Zod 4, refinements: https://zod.dev/api#refinements
