# Lesson 015: Atomic file writes and turning untrusted text into paths
**Milestone:** M1 · **Date:** 2026-11-13 · **Related:** `src/main/storage/profiles/`, `src/main/storage/app-database.ts`, ADR-0014, ADR-0017, DATA_MODEL §9.1

## The concept (plain words)
**Atomic write.** If the app crashes or the power goes out halfway through `writeFileSync(file, data)`, the file can end up half old and half new, or empty. An *atomic* write means readers only ever see the complete old file or the complete new file. The usual recipe:
1. write the new content to a temp file **in the same folder**;
2. `fsync` it, so the bytes are really on disk and not just in a memory buffer;
3. `rename` the temp file over the real one. A rename inside one folder is a single step for the file system: it either happened or it didn't.

**Untrusted IDs → paths.** Anything read from disk could have been edited by hand, by another program, or by malware. If we built a folder path straight from a field in `profiles-index.json`, an ID like `../../Windows` would point outside our data folder (*path traversal*).

## Why Atlas Realm needs it
`profiles-index.json` is the list of every local profile. A torn write would make the app forget all of them. And each profile ID becomes a folder name, `profiles/<id>/app.sqlite`, so one bad ID could make the app open or create a database anywhere on disk.

## Where it lives in our code
```ts
// profiles-index.ts: writeProfilesIndex
const fd = openSync(temp, 'wx'); // 'wx' = fail if the temp file already exists
writeSync(fd, content);
fsyncSync(fd);
closeSync(fd);
renameSync(temp, target);        // the all-or-nothing step
```
```ts
// profile-id.ts: only 'default' or a lowercase UUID, as a *branded* type
export const ProfileIdSchema = z.string().regex(PROFILE_ID_PATTERN).brand<'ProfileId'>();
// app-database.ts: the one place an ID becomes a path re-checks it at runtime
const profileDir = join(userDataDir, 'profiles', toProfileId(profileId));
```
The branded type makes the compiler refuse a plain `string` where a `ProfileId` is expected, so validation can't be forgotten. The runtime check catches anyone who forces the type with `as`.

When the index is invalid, startup **stops and reports it**. It never "repairs" the file by writing a fresh one, because that would silently drop every other profile.

## Common mistakes
- Writing the temp file in the system temp folder: renaming across drives isn't atomic (it becomes copy + delete).
- Skipping `fsync`: the rename can reach the disk before the data, so a crash leaves an empty file.
- Validating with a *blocklist* (`!id.includes('..')`) instead of an *allowlist* pattern. There are too many tricky spellings (`..\\`, `C:`, `CON`, `%2e%2e`).
- Treating a corrupt file as "missing" and recreating it.

## Try it (5–15 min exercise)
In `tests/integration/storage-profiles-index.test.ts`, add a case to the "refuses %s" table for the ID `"default "` (with a trailing space). Predict whether it passes before you run `corepack pnpm vitest run tests/integration/storage-profiles-index.test.ts`. Then explain which part of `PROFILE_ID_PATTERN` decides it.

## Learn more
- Node.js `fs.rename` and `fs.fsync`: https://nodejs.org/api/fs.html
- Zod brands: https://zod.dev/api#branded-types
- OWASP, Path Traversal: https://owasp.org/www-community/attacks/Path_Traversal
