# 2026-11-27: Path policy (M3-9, #119)

## Task
#119 (M3-9): one trusted module that decides whether a path is inside an approved root, using real resolved paths instead of string prefixes (SECURITY §13.4). File tools (M3-13), artifact storage (M3-12) and imports (M3-16) will use it. Lane B. Branch `feat/119-path-policy`.

## What happened
- Checked GitHub first for a branch, PR or assignee on #119, because jash-aeio built #111 in parallel (PR #136). None existed. Commented "Started on branch" on #119 and assigned it to X4stra (the user approved both).
- Read SECURITY §13.4 and PRODUCT_RULES §3.1.
- Probed Windows behaviour with Node 24.21 before writing code:
  - `realpathSync.native` follows junctions and returns each folder's stored casing (`ROOT\A.TXT` → `Root\a.txt`).
  - `fstat` with `bigint` gives a stable volume and file ID.
  - Writing `a.txt:hid` (an alternate data stream) succeeds on NTFS.
  - Symlinks can be created on this machine without admin.
  - A handle's file ID differs after its junction is swapped.
- Wrote `src/main/security/path-policy.ts` and `src/main/security/path-policy.test.ts` (`d5dd642`). 58 tests use real temp folders, junctions and symlinks.
- A mutation check proved the key tests can fail:
  - Removing the file-identity comparison fails the swap-back test.
  - Removing the real-path containment check fails 4 link-escape tests.
- Lesson 044 and four glossary terms.

## Decisions
| Question | Your choice |
|---|---|
| Plan (shape checks → containment on real paths → re-check at use by file identity) | Approved |
| Comment on and assign #119 | Yes |

Routine choices (no question asked):
- **Re-check at use compares file identity, not the handle's path.** The issue asks to "verify the handle's real path". Node can't read the path of an open handle, so the module compares the handle's volume and file ID with the file the path leads to now. That gives the same guarantee: a swapped link is always caught.
- **Two kinds of case comparison.** Paths as written are compared case-insensitively, folding ASCII letters only, as the issue asks. Real paths are compared exactly per segment, because Windows returns stored casing. Full Unicode folding was avoided: `ß` upper-cases to `SS`, which could make two different folders equal.
- **Open modes are `read` and `create`.** `create` never overwrites, which is what immutable artifacts (M3-12) need. There's no general read-write mode until a task needs one.
- **The shape checks run on every platform.** The app is Windows-first, and refusing these forms elsewhere costs nothing.
- **Trailing dots and spaces are refused** (`invalid_path`), because Windows silently drops them and `a.` would mean `a`.
- **Lesson number 044.** 043 is used by jash-aeio's PR #136.
- The tests live in `src/main/security/`, next to the module, as the issue names them. Other tests live in `tests/`.

## Why it looks like this (learning notes)
See lesson 044. In short:
- Compare whole folder names, not characters (`Root2` is not inside `Root`).
- Compare where Windows says a path *really* goes, not what the text says (junctions).
- Check again after opening, on the file you actually hold, so a swap in between is caught (TOCTOU).

## Verification
- typecheck, lint and format:check pass.
- Unit/integration tests: 1361/1361 (65 files), including the 58 new ones, with nothing skipped on this machine. On a machine without symlink rights, one test skips with a stated reason.
- E2E was not run: nothing in the UI, IPC or main-process startup changed. The module isn't wired in yet; M3-12 and M3-13 will call it.
- Lesson 044's exercise: the cleanup steps were run and confirmed (the junction removed, the target file intact, the folder deleted). The realpath-through-a-junction result matches the earlier probe. Running the exact exercise script was blocked by the local permission settings, so its `node -e` quoting is untested as written.

## Open questions
- None for #119. M3-12 and M3-13 decide how `PathRefusal` codes map to IPC error codes and audit records.

## Next
- Check GitHub again for clashes, then push and open the PR. Both will be asked about first. jash-aeio merges.
- Then #126 (import inventory), which builds on this module, or #61.
