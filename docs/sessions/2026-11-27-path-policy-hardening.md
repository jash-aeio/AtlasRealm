# 2026-11-27: Path-policy hardening (#142)

## Task
Fix the findings from the after-merge security review of the path policy (#119, PR #137): one High, four Medium, three Low. Nothing calls the module yet. This work blocks M3-12 #122, M3-13 #123, M3-16 #126 and M3-18 #128.

Branch: `fix/142-path-policy-hardening`.

## Decisions so far
- **Hard links (M2): always refuse.** A file with more than one name (nlink > 1) is refused with a new `hard_link` code. There is no opt-in. An opt-in can be added later with an ADR if a real need shows up. User choice, recorded in ADR-0035.
- **Broad roots (L1): refuse unless explicit.** `approveRoot` refuses with `root_too_broad` for volume roots, the home folder, Documents/Desktop/Downloads, AppData and any folder that contains one of them, unless the caller passes `{ broad: true }`. Browser-profile and credential folders are always refused. User choice, recorded in ADR-0035.

## Plan
1. Trusting the root: branded, frozen `ApprovedRoot` (M3); root identity pinned by dev/ino (L3); broad-root refusal (L1); errors keep only the errno code (L2).
2. Opening files: refuse a name that `lstat` finds but `realpath` can't follow (H1); clean up a refused create, or report it with no path (M1); refuse hard links (M2); accept candidates written against the root's real form (8.3 names).
3. Building blocks: `ensureDirInsideRoot`, `listInsideRoot`, `walkInsideRoot` and `writeFileInsideRoot` (temp file, then a no-overwrite rename) (M4). A lint rule keeps `node:fs` out of new main-process files.
4. Tests for every finding, mutation checks, then a security-auditor re-run.

## What was done
Plan approved. Three commits on the branch:
1. `ada9da3` Trusting the root. `ApprovedRoot` is now a frozen class that only `approveRoot` can make. It remembers the root folder's volume and file ID, so a replaced folder is refused. Broad and sensitive folders follow ADR-0035. Errors keep only the OS error code (`errno`), never the path.
2. `cf8a511` Opening files. A dangling junction can no longer make `create` build something outside the root (H1). A refused create deletes the file it made, or reports it through `onLeftover` with no path (M1). Hard links are refused (M2). A root approved by its 8.3 short name accepts long-form paths.
3. `b28b52b` Building blocks (M4): `ensureDirInsideRoot`, `listInsideRoot`, `walkInsideRoot` and `writeFileInsideRoot`, plus a lint rule that bans `node:fs` in new main-process files.

Routine choices made without asking (reversible):
- `writeFileInsideRoot` uses "hard-link the temp file to the final name, then remove the temp name", because Node's `rename` overwrites on Windows. Drives without hard links (FAT32/exFAT) are refused for now (recorded in ADR-0035).
- Listings report links as `link` and never follow them. The walk is bounded (10 000 entries, 16 levels) and reports `complete: false` when it stops early.
- Known limit: Node can't list a folder by its handle, so a link swapped out and back during a listing could show *names* (never contents) from elsewhere.
- `onLeftover` events carry only a kind and no path. The audit log (M3-10) will receive them.

## Evidence
- Path-policy tests: 91 passed, 1 skipped (the old file-symlink test, which needs Developer Mode). All the new tests ran on this machine, including the 8.3 test.
- Mutation checks: each of the 12 fixes was undone one at a time, and every time at least one test failed.
- Full suite: typecheck and lint pass. 1531 passed, 1 skipped.

## Security re-audit
The security-auditor re-ran probe scripts on real NTFS folders. All eight original findings are fixed, and it found **no High or Medium issues** (the acceptance bar). It reported seven new Low findings:
1. A cleanup could be redirected by re-pointing a junction between its check and its delete. Fixed: the check and the delete now use the real path.
2. The private token could be caught by patching a public static method. Fixed: the method is removed, and the class and its prototype are frozen.
3. Sensitive folders were matched only by their written path. Fixed: they are also compared by their real location.
4. More credential and Startup folders were needed, and folders inside AppData/Windows were approvable. Fixed after two more user decisions (ADR-0035, "Added after the security re-audit").
5. A walk of a broad home folder failed completely, with the wrong reason. Fixed: credential folders are listed by name but never entered.
6. The lint rule missed `original-fs`, `node:module`, `import()` and `process.getBuiltinModule`. Fixed and probed.
7. A link planted right before a create was reported with a misleading reason. Fixed: it is now `unknown_object_created` / `changed_during_use`, and recorded as a known limit.

More commits: `54a8a25` (the audit fixes) and `f346906` (the two user decisions).

### More decisions (AskUserQuestion)
- Folders inside AppData, ProgramData, Windows and Program Files need `broad: true` (user chose the recommended option).
- `.git-credentials`, `.npmrc`, `.netrc`, `_netrc` and `.pypirc` are refused anywhere (user chose the recommended option). They get their own reason, `sensitive_file`, instead of `sensitive_folder`, so the message names a file.

### Final evidence
- Path-policy tests: 105 passed, 1 skipped (the file-symlink test, which needs Developer Mode).
- Mutation checks: 22 mutations. All are caught except two that end in the same state anyway: the NaN limit clamp, and the upfront name check in `ensureDirInsideRoot`, where cleanup gives the same result without it.
- Full suite: typecheck, lint and format pass. 1545 passed, 1 skipped.

## Open questions / follow-ups
- The auditor's first probe runs left two temp folders, `C:\Users\Jasper\AppData\Local\Temp\atlas-probe-kAEuYj` and `atlas-probe-t5haot`. The project hook blocks recursive deletes, so the user deletes them by hand.
- Nothing cleans up `.atlas-*.tmp` files left by a crash during `writeFileInsideRoot`. That is for M3-12 (#122).
- Mapping `PathRefusal` codes to IPC error codes and audit records, and wiring `onLeftover` into the audit log, belongs to M3-10/M3-13.

## Hand-off (/ship, 2026-11-28)
- Lesson 045: [Hard links, dangling links and unforgeable tokens](../learning/lessons/045-hard-links-dangling-links-and-unforgeable-tokens.md). New glossary terms: hard link, dangling link, `lstat`, capability object, broad root.
- Status, roadmap, M3 breakdown and changelog are updated. The user wrote no code this session; Claude wrote all of it.
- The branch was rebased onto main @ 673489d (PR #143) on 2026-11-28 before shipping; the code was identical afterwards. Commit hashes above are the rebased ones.
- Before the PR: invariant-reviewer found no violations. A second security-auditor pass approved the two commits made after the re-audit. Its Low items were fixed in aa3a22c: honest wording for the remaining delete race, and more lint bypasses closed. Its Info notes (script-carrying project files, more token files) went to follow-up #145 (needs-decision, blocks M3-13 writes).
