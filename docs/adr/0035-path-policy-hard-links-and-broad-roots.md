# ADR-0035: Path policy refuses hard links, and broad roots need an explicit choice

- **Status:** Accepted
- **Date:** 2026-11-27
- **Milestone(s) affected:** M3 (#142, hardening of M3-9 #119; used by M3-12 #122, M3-13 #123, M3-16 #126, M3-18 #128)
- **Decided by:** jash-aeio (asked via AskUserQuestion on 2026-11-27)

## Context
The path policy (`src/main/security/path-policy.ts`) is the one module that decides whether a path is inside an approved root folder. A security review after #119 merged found two gaps that need a product decision, not just a code fix:

1. **Hard links (M2).** A hard link is a second name for the same file. If `Root\hl.txt` is a hard link to `outside\secret.txt`, opening the name inside the root reads the file outside. Following links can't catch this: there is no link to follow, both names are equally real. The only sign is that the file has more than one name (`nlink > 1`). Some real folders are full of hard links: pnpm's `node_modules`, and the `.git\objects` of a local clone.
2. **Broad roots (L1).** `approveRoot` accepted `C:\` and the home folder. SECURITY §13.4 says never *auto*-grant Documents, the home folder, browser profiles, credential folders or the whole disk.

## Options considered
**Hard links**

| Option | Pros | Cons |
|---|---|---|
| **Always refuse (`hard_link`)** | Simplest and safest; no switch to get wrong; no UI needed | Files in pnpm `node_modules` or `.git\objects` can't be read through file tools (imports skip those folders by default anyway) |
| Refuse, with a visible opt-in | Flexible | A security switch that nothing needs yet, and the UI would have to show when it's on |

**Broad roots**

| Option | Pros | Cons |
|---|---|---|
| **Refuse unless the caller passes `broad: true`; credential and browser folders always refused** | Matches "never *auto*-grant"; leaves room for a screen where the user knowingly picks a big folder | One more option to keep honest: only a deliberate user choice may set it |
| Always refuse | Strictest | A user whose project really sits at `Documents\` itself could never approve it |

## Decision
- **Hard links: always refused.** `resolveInsideRoot` and the re-check at use (`verifyHandleInsideRoot`) refuse a file with `nlink > 1` with the reason `hard_link`. Listings show such files with `hardLinked: true` so the UI can explain why they can't be opened. There is no opt-in; adding one takes a new ADR.
- **Broad roots: refused unless explicit.** `approveRoot(root, { broad: true })` is needed for a whole drive, the home folder, Documents/Desktop/Downloads, OneDrive (and its Documents/Desktop), AppData (Roaming and Local), Public, and the Windows, Program Files and ProgramData folders, *and for any folder that contains one of them*. Without the flag these are refused as `root_too_broad`. Only a screen where the user picks such a folder on purpose may pass `broad: true`.
- **Credential and browser folders: never.** `.ssh`, `.aws`, `.azure`, `.gnupg`, `.kube`, `.docker`, `.config\gcloud`, the Chrome/Edge/Brave/Vivaldi/Chromium `User Data` folders, Firefox and Opera profiles, and Windows `Credentials`/`Protect` are refused as roots (`sensitive_folder`), even with `broad: true`. Inside a broad root they stay refused for every read, write and listing, also when reached through a junction.

The list is built by `defaultSensitiveFolders()` from the home folder and Windows environment variables; tests pass their own. Each listed folder is also compared by its real location, so a credential folder reached through a junction, or approved by where it really is, is still caught.

### Added after the security re-audit (2026-11-27)
The re-audit found only Low issues. The user made two more decisions (AskUserQuestion):
- **App-data and system folders count as broad all the way down.** Any folder *inside* AppData (Roaming and Local), ProgramData, Windows or Program Files needs `broad: true` (`broadTrees` in `SensitiveFolders`). Projects don't live there, but settings, programs and other apps' secrets do. The temp folder is inside `%LOCALAPPDATA%` too, so a temp folder is broad by default.
- **Credential file names are refused anywhere.** `.git-credentials`, `.npmrc`, `.netrc`, `_netrc` and `.pypirc` are refused for read, create and write in every root, compared without ASCII case, with the new reason `sensitive_file` (its own code, so the message talks about a file, not a folder). The check also runs on the real path, so the 8.3 short name of such a file is caught. Listings still show the name.
- **Routine additions from the re-audit (no question asked, stricter only):** the forbidden list also covers `%APPDATA%\gcloud`, `%APPDATA%\gnupg`, `%APPDATA%\GitHub CLI`, `%LOCALAPPDATA%\Microsoft\Vault`, `%APPDATA%\Microsoft\Crypto`, Chrome SxS, and both Startup folders (a file there runs at the next sign-in, which would bypass "no scripts").

## Consequences
- File tools (M3-13) can't read hard-linked files. If users hit this with real projects, revisit with an opt-in and an ADR.
- `writeFileInsideRoot` uses a hard link itself for a moment (temp file linked to the final name, then the temp name removed), so the final file has one name again. That's internal and doesn't weaken the rule.
- Drives without hard links (FAT32, exFAT) can't use `writeFileInsideRoot` today (`inaccessible`). Artifact storage on such drives would need another no-overwrite strategy.
- The root-approval UI (later) must show when a broad root is chosen, and must never set `broad` for the user.
- **For the main-process caller (M3-12/M3-13):** add Electron's `app.getPath('documents' | 'desktop' | 'downloads')` to `broad` (they follow Windows folder redirection, which environment variables don't), and the app's database and secret files under userData to `forbidden`. App-managed artifact folders under userData are inside `%APPDATA%`, so approving one needs `broad: true` from trusted code, never from user input.
- Projects that keep a real `.npmrc` can't have it read by file tools.
- **Known limits (recorded, not fixable in Node today):** a junction planted between the check and a create-only open can still make Windows create its target outside the root. The call is refused (`changed_during_use`) and reported (`unknown_object_created`). Folders can't be listed by handle, so a link swapped out and back during a listing could show names (never contents) from elsewhere. Cleanup of a refused create checks and deletes by the real path, but Node can't delete through a handle, so a folder on that real path swapped for a junction in the instant between the check and the delete could still redirect the delete (exact timing, by a process that could delete the file itself).
- **Signals to revisit:** users report "linked to another location" on files they need, or a credential/browser folder is missing from the list.

## Learning note
Links come in two kinds. A junction or symlink is a *signpost*: you can see it and follow it, so checking the real path catches it. A hard link is a *second front door* to the same room: neither name is the "real" one, so the only clue is the count of doors. Security code has to handle both, in different ways.
