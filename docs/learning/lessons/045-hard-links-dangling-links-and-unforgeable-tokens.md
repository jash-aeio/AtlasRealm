# Lesson 045: Hard links, dangling links and unforgeable tokens
**Milestone:** M3 · **Date:** 2026-11-28 · **Related:** `src/main/security/path-policy.ts`, issue #142, ADR-0035, lesson 044 (real paths, re-check at use)

## The concept (plain words)
Lesson 044 checked where a path *really* goes. A security review then found that "where it really goes" still misses four cases.

1. **A hard link is a second front door.** A junction or symlink is a signpost: you can see it and follow it. A hard link is different. It's a second *name* for the very same file, and neither name is "the real one". If `Root\notes.txt` is a hard link to `C:\Users\you\secret.txt`, the real path of `Root\notes.txt` really is inside `Root`, so the check passes, yet you read the secret. The only clue is the **link count** (`nlink`), the number of names the file has. More than one name means "this file may also live somewhere else", so it's refused (`hard_link`).
2. **"Can't find it" isn't "nothing there".** To create a new file, we asked Windows for the real path. If Windows said "not found", we assumed the name was free. But a **dangling link** (a junction whose target doesn't exist yet) also answers "not found". Creating a file "through" it made Windows build the target outside the folder. The fix is to look at the name *itself* without following it (`lstat`, "link stat"). Only the answer "there is truly nothing here" counts as free.
3. **Cleaning up is part of refusing.** If a create is refused after the file was already made, a leftover stays behind. The module deletes it, but only if the path still leads to *that exact file* (same volume and file ID). It deletes by the real path, so a junction swapped in between can't redirect the delete to someone else's file. Anything it can't prove is its own, it reports instead of deleting.
4. **A permission object must be impossible to fake.** `approveRoot` says "this folder is OK". If any code can write `{ real: 'C:\\' }` and pass it in, the check is decoration. So the approved root is a class that only this module can create: a private field (`#state`) that no copied object can have, a secret token the constructor demands, and a frozen class that can't be patched to steal the token. This pattern is called a **capability object** or an **unforgeable token**: having the object *is* the permission, so it must be impossible to make one any other way.

## Why Atlas Realm needs it
Agents will read and write project files (M3-13), artifacts will be saved (M3-12), and imports will copy folders (M3-16). A planted hard link or dangling junction in an imported project, or a careless caller that builds its own "root", would let that work leak secrets or write files where they don't belong. SECURITY §13.4 also says the app must never quietly grant the whole disk, the home folder or credential folders. That's why broad roots need an explicit choice and credential folders and files are always refused (ADR-0035).

## Where it lives in our code
- **Unforgeable root.** `class ApprovedRoot` keeps `#state` (the folder's volume + file ID and the excluded folders). The `static {}` block is the only place that can read `#state` or call the constructor with the token, and the class and its prototype are frozen afterwards.
- **Root identity is pinned.** `checkRoot` compares the root folder's identity on every call, so a folder renamed away and replaced by a new one with the same name is refused.
- **Dangling links.** `resolveMissing` → `assertNothingAt`: `lstat` the first missing name, and accept only `ENOENT`.
- **Hard links.** `resolveInsideRoot` and `verifyHandleInsideRoot` refuse `nlink > 1`.
- **Cleanup.** `removeOwnFile` / `removeOwnFolder` take the real path, compare identity, and only then delete. Otherwise they call `onLeftover` with a kind and no path.
- **Building blocks.** `ensureDirInsideRoot`, `listInsideRoot`, `walkInsideRoot` and `writeFileInsideRoot` mean callers never need raw `fs`, and a lint rule enforces that.
- **No-overwrite write.** `writeFileInsideRoot` hard-links the temp file to the final name (that fails if the name is taken), then removes the temp name. Node's `rename` would silently replace an existing file on Windows.

## Common mistakes
- **Treating "not found" as "free".** Use `lstat`, which looks at the name itself, before creating anything.
- **Following only signposts.** Real-path checks catch junctions and symlinks, never hard links. Check the link count too.
- **Deleting by the path you were given.** Every folder in that path is followed again at delete time. Resolve it first, check identity, and delete the resolved path.
- **Plain objects as permissions.** In TypeScript, `{ given, real }` matches an interface by shape. A class with a `#private` field can't be matched by shape, and a runtime check (`#state in obj`) catches copies.
- **Leaving the factory public.** A "private" token is only as safe as every function that touches it. A public, writable static method can be swapped to catch the token.

## Try it (5–15 min exercise)
In PowerShell (no admin rights needed for hard links on NTFS):
```
mkdir $env:TEMP\lesson45
"secret" > $env:TEMP\lesson45\a.txt
cmd /c mklink /H $env:TEMP\lesson45\b.txt $env:TEMP\lesson45\a.txt
node -e "const fs=require('fs');const p=process.env.TEMP+'/lesson45/';console.log(fs.realpathSync.native(p+'b.txt'), fs.statSync(p+'b.txt').nlink)"
```
The real path of `b.txt` is `b.txt` itself. A real-path check sees nothing wrong, but the link count is 2. Now change `a.txt` and read `b.txt`: they are the same file.

Clean up with `Remove-Item -Recurse $env:TEMP\lesson45`. There are no junctions here, so this is safe.

## Learn more
- Microsoft, Hard links and junctions: https://learn.microsoft.com/windows/win32/fileio/hard-links-and-junctions
- Node.js, `fs.lstat` and `Stats.nlink`: https://nodejs.org/api/fs.html#fslstatpath-options-callback
- MDN, Private class features (`#field`, `#field in obj`): https://developer.mozilla.org/docs/Web/JavaScript/Reference/Classes/Private_properties
