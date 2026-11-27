# Lesson 044: Real paths, junctions and re-checking at use
**Milestone:** M3 · **Date:** 2026-11-27 · **Related:** `src/main/security/path-policy.ts`, issue #119, SECURITY §13.4, lesson 024 (check order, TOCTOU)

## The concept (plain words)
"Is this file inside the project folder?" sounds like a text question: does the path start with the folder's path? It isn't, for two reasons.

1. **Text prefixes lie.** `C:\Projects\Root2\x.txt` starts with the text `C:\Projects\Root`, but it's in a different folder. A correct check compares *whole folder names* (segments), not characters.
2. **A path is not where a file is.** On Windows any user can make a **junction**, a folder that is really a pointer to another folder. `C:\Projects\Root\notes\secret.txt` can really be `C:\Users\you\Documents\secret.txt` if `notes` is a junction. The text looks inside, but the file is outside.

So the safe question is: *where does Windows say this path really ends up?* Node's `fs.realpath.native` asks Windows to follow every junction and symlink and return the **real path** (also called the canonical path). We compare the real path of the file with the real path of the root.

There is one more trap. A check happens at one moment and the open happens a moment later. If someone swaps a folder for a junction in between, the check was right but the open lands somewhere else. This is **TOCTOU**, "time of check to time of use". The fix is to check again *after* opening, on the file we actually hold.

## Why Atlas Realm needs it
Agents and imports work with real files (M3-12, M3-13, M3-16). A model's tool call or an imported folder could contain a crafted path or a planted junction. Without this module, "read a file in this project" could quietly read your SSH keys or browser profile. PRODUCT_RULES says the renderer never touches the filesystem directly, and this module is the trusted gate that file access goes through instead.

## Where it lives in our code
- `pathShapeProblem` (no disk access) refuses forms that are dangerous before any check:
  - `\\server\share` (UNC paths: network shares)
  - `\\.\` and `\\?\` (device and raw paths)
  - device names like `NUL.txt` or `COM1`, which open a device in any folder
  - `file.txt:stream`, an NTFS **alternate data stream**: hidden extra content attached to a file
  - `C:file`, which is relative to drive C's current folder
  - trailing dots and spaces, which Windows silently drops
- `approveRoot` resolves the root's real location once. The root itself may be reached through a link, such as a redirected Documents folder.
- `resolveInsideRoot` checks twice:
  - **As written** (`..` and other drives fail fast). This check is case-insensitive, folding ASCII letters only.
  - **On the real path.** This check is exact per segment, because Windows returns each folder's stored casing, and full Unicode case folding is risky (`ß` upper-cases to `SS`).
- `openInsideRoot` opens the file, then `verifyHandleInsideRoot` compares **file identity**: the volume and file ID from the open handle, against the file the path leads to now. Node can't ask Windows for an open handle's path, but two different files never share an identity, so a swap is always caught.
- Errors carry a reason like `link_escape` and fixed text, never the path: an outside path can contain your Windows user name.

## Common mistakes
- **`startsWith` on strings.** It passes the `Root2` sibling and every junction.
- **Checking `path.resolve` only.** It cleans up `..` but doesn't follow links. It's a text operation.
- **Check, then open, with nothing after.** That leaves the TOCTOU gap open.
- **`toUpperCase()` for case-insensitive comparison.** Unicode case mapping can change a string's length and make different names equal.
- **Testing with fake paths.** The interesting behaviour is what Windows does with links, so the tests create real junctions and symlinks in a temp folder, and swap them at an exact moment instead of hoping to win a race.

## Try it (5–15 min exercise)
In a PowerShell window:
```
mkdir $env:TEMP\lesson44\Root, $env:TEMP\lesson44\outside
"secret" > $env:TEMP\lesson44\outside\s.txt
cmd /c mklink /J $env:TEMP\lesson44\Root\jn $env:TEMP\lesson44\outside
node -e "console.log(require('fs').realpathSync.native(process.env.TEMP + '/lesson44/Root/jn/s.txt'))"
```
The path you passed is inside `Root`, but the printed real path is in `outside`. That gap is exactly what `link_escape` refuses.

Clean up by removing the junction **first**, with `cmd`'s `rmdir`, which deletes only the link: `cmd /c rmdir %TEMP%\lesson44\Root\jn`. Then `Remove-Item -Recurse $env:TEMP\lesson44`. Don't use `Remove-Item -Recurse` while the junction is still there: older PowerShell versions follow it and delete the target folder's files too.

## Learn more
- Node.js, `fs.realpath.native`: https://nodejs.org/api/fs.html#fsrealpathnativepath-options-callback
- Microsoft, Naming files, paths and namespaces (device names, `\\?\`, streams): https://learn.microsoft.com/windows/win32/fileio/naming-a-file
- OWASP, Path traversal: https://owasp.org/www-community/attacks/Path_Traversal
