# Lesson 027: Trust boundaries for derived data

**Milestone:** M2 · **Date:** 2026-11-21 · **Related:** `src/main/services/placement-service.ts`, `src/main/world/building-appearances.ts`, `src/main/services/project-service.ts`, ADR-0025, UI_SPEC §17.2, lesson 026

## The concept (plain words)
A **trust boundary** is the line where data crosses from code you don't control into code you do. In Atlas Realm, that line is the IPC channel between the renderer and the main process. The rule for data crossing it is simple:

- Accept only what the user really chooses (here: which tiles, which rotation).
- Look up everything else yourself, from a source you trust.

A building's footprint is **derived data**: it follows from the building's art. If the request carried it, a forged request could lie about it.

## Why Atlas Realm needs it
Lesson 026 showed that the preview and the handler run the same rules. But the rules are only as honest as their inputs. Suppose `placement.create` took `footprint: { columns: 1, rows: 1 }` from the renderer. A compromised page could then squeeze a 2×2 building into a one-tile gap, and the rules would happily say "ok". The answer is not "validate the footprint harder". It is "never ask for it".

## Where it lives in our code
The contract has no footprint field, and strict Zod objects refuse unknown keys:

```ts
// src/common/contracts/placement.ts
PlacementCreateInput = z.strictObject({ worldId, projectId, tileX, tileY, rotation });
```

The service gets the footprint from the bundled manifest, and gets the other buildings from the database, in the same synchronous call as the write:

```ts
// src/main/services/placement-service.ts (simplified)
const occupied = placements.listByWorld(world.id)
  .map((p) => ({ ...p, footprint: appearances.footprintOf(p.appearanceId) }));
checkPlacement(world, occupied, { ...spot, footprint: appearances.footprintOf(defaultId) });
placements.create(...);
```

If a stored appearance is missing, `footprintOf` **fails closed**: it returns the largest building size (4×4) instead of guessing small.

A second idea in this task is that **one action is one transaction**. Archiving a project and removing its building happen inside one `withTransaction`. If removing the building fails, the archive is undone too. The test proves it with a temporary trigger that makes the delete fail.

## Common mistakes
- Re-validating a value the client should never have sent. Remove the field instead.
- Checking the rules against data read earlier (a cached list), then writing later. Something may have changed in between.
- Writing two related changes separately "because each one works". A failure halfway leaves a project archived but still standing on the map.
- Trusting a test that passed on the first run. Break the code on purpose (a **negative control**) and watch the test fail.

## Try it (5–15 min exercise)
1. In `project-service.ts`, temporarily replace `withTransaction(db, () => {…})` in `withoutBuilding` with a plain call to the function.
2. Run `corepack pnpm exec vitest run tests/integration/placement-contract.test.ts -t "rolled back"`. It fails. Why does the project end up archived?
3. Restore the file. Then, in `placement-contract.test.ts`, find the "smuggled footprint" case and explain which line of the contract refuses it.

## Learn more
- [Electron security: validate the sender and IPC input](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages)
- [SQLite transactions](https://www.sqlite.org/lang_transaction.html)
- [OWASP: input validation](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
