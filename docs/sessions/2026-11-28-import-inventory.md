# 2026-11-28: Import inventory and classifier (M3-16, #126)

## Task
#126 (M3-16, IMP-1): a bounded, read-only walk of a folder the user picks. It applies exclusions and limits, never follows links outside the root, and proposes a template from deterministic signals (IMPORT_SPEC §33.4, §33.6). This is the first step of the import chain: M3-17 (sessions and the inspect command) and M3-18 (commit) build on it. Lane D. Branch `feat/126-import-inventory`.

## What happened
- **GitHub since last session:**
  - PR #137 (#119) and PR #138 (#61) were merged.
  - jash-aeio hardened the path policy (#142, PR #146) and synced the roadmap (#147).
  - No branch, PR or assignee existed on #126. I commented "Started on branch" and assigned it to X4stra, with the user's approval.
- Read IMPORT_SPEC §33, TEST_PLAN §22.2 #30, and the hardened path policy (`listInsideRoot`, `openInsideRoot`, `walkInsideRoot`, sensitive folders and names).
- **Slice 1** (`19c1baf`): `src/main/import/exclusions.ts`:
  - Named built-in rules, then `.gitignore` rules (root and nested, last match wins, `!` re-includes), then hidden entries.
  - A `.gitignore` can't undo a built-in rule: `!.env` never makes `.env` readable.
  - 41 unit tests.
- **Slice 2** (`de821ca`): `src/common/import/classify.ts`:
  - A pure classifier: Content Campaign when at least 2 different campaign words appear in names or a README; software → Generic with a note; otherwise Generic ("mixed or unclear").
  - It returns evidence and notes, never a confidence score.
  - 12 unit tests.
- **Slice 3** (`2897f47`): `src/main/import/inventory.ts`:
  - The walk lists one folder at a time through `listInsideRoot` and decides about each entry **before** entering it.
  - Only `.gitignore` and README files are read, through `openInsideRoot`, with the size checked on the open handle.
  - 11 integration tests on real temp folders, with spies on the path policy.

## Decisions (AskUserQuestion)
| Question | Your choice |
|---|---|
| How to match `.gitignore` | **Our own small matcher.** No new dependency. Lines it doesn't understand are counted in `gitignoreSkippedLines`, not guessed |
| Plan | Approved |
| Comment on and assign #126 | Yes |

Routine choices (no question asked):
- **`walkInsideRoot` isn't used.** It can't skip folders, so it would list `node_modules`. The inventory uses `listInsideRoot` per folder, which keeps the real-path re-check.
- **What gets read:** only `.gitignore` files and README files (up to 5, top two folder levels). Manifests count by name only. The classifier needs no other file contents.
- **Built-in folder rules** include `dist`, `build`, `out`, `bin`, `target` and similar. A content folder with one of those names would be left out, but the review lists it under "Build output", so the user can see that.
- **The exclusion list is a superset of the path policy's sensitive names** (`.yarnrc.yml`, `credentials.json`, `secrets.json`, keys). `path-policy.ts` isn't changed here: #145 owns its sensitive-name decisions.
- **Hidden files** are detected by a leading dot only. The Windows "hidden" attribute isn't checked, because Node has no API for it.
- A safety bound on names looked at (50,000, excluded ones included) keeps a folder full of junk cheap to inventory.

## Why it looks like this (learning notes)
- **Decide before you enter.** "Never read excluded content" can't be met by filtering afterwards. The walk must refuse to list or open first. The tests prove it with spies: the only file opened is the README, and `node_modules`, `.git` and the junction are never listed.
- **A README is data, not instructions.** It's searched for keywords only; a sentence asking the importer to do something changes nothing (IMPORT_SPEC §33.5).
- **Evidence beats a score.** A list like "`brief.md`: name mentions a brief" lets the user check the reasoning. "87%" would only look precise.

## Verification
- typecheck, lint and format:check pass.
- Unit/integration tests: 1610/1610 (71 files). 64 are new.
- A mutation check proved the tests can fail: with the exclusion step disabled, the secrets test and the `.gitignore` test both fail.
- Two problems were caught and fixed before committing:
  - The 5,000-file test needed a longer timeout when the whole suite runs in parallel.
  - The formatter had turned a `﻿` escape into a literal invisible character, in the code and then in a test. The redundant BOM strip was removed (`TextDecoder` already drops it), and the test builds the character with `String.fromCodePoint`.
- E2E was not run: nothing in the UI, IPC or startup changed. Nothing calls the inventory yet; M3-17 adds the inspect command.

## Open questions
- None for #126. M3-17 (#127) decides how an inventory is stored in an import session and shown in the review.

## Next
- Check GitHub for clashes, then push and open the PR. Both will be asked about first.
