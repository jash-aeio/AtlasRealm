# Lesson 026: Shared validation: one rule for the preview and the real check
**Milestone:** M2 · **Date:** 2026-11-20 · **Related:** `src/common/world/placement-rules.ts`, `tests/domain/placement-rules.test.ts`, ADR-0024, UI_SPEC §17.2

## The concept (plain words)
When you drag a building over the map, the game paints its footprint green ("fits") or red ("blocked"). That is the **preview**. When you let go, a trusted part of the app decides whether the building is really saved there. That is the **authoritative check**.

If two different pieces of code answer "does it fit?", they will drift apart sooner or later. Then the preview says green, the drop is refused, and the user rightly feels cheated. The fix is **shared validation**: write the rule once, as a pure function, and call that same function in both places.

Sharing the code does *not* mean trusting the preview. The renderer is untrusted (it could be buggy or tampered with), so main runs the rule again on its own data from the database. The preview is a hint. The handler decides.

## Why Atlas Realm needs it
UI_SPEC §17.2 says to "revalidate placement in the command handler, not only in the preview". PRODUCT_RULES §3.1 says the renderer can't be trusted with decisions. A shared module gives us both: matching answers, and a check that main runs itself.

## Where it lives in our code
`src/common/world/placement-rules.ts` is compiled into **both** the renderer and main. It imports nothing from Electron, the DOM, Pixi or the database, so it can run anywhere.

```ts
// renderer (M2-7): paint the preview
const preview = checkPlacement(world, buildingsOnScreen, { tileX, tileY, rotation, footprint });
// main (M2-3): decide, using rows it just read from the database
const verdict = checkPlacement(world, placementRepo.listByWorld(worldId)…, candidate);
if (verdict.kind !== 'ok') return refuse(verdict);
```

The result is a **discriminated union** (`kind: 'ok' | 'out_of_bounds' | …`). Each caller can switch on `kind` and show its own message without parsing strings.

## Common mistakes
- **Trusting the preview's answer.** Sending `{ ok: true }` from the renderer and believing it. Main must always re-run the rule.
- **Sneaking environment code into the shared file.** One `import { Graphics } from 'pixi.js'` and main can't use it anymore. Keep the module pure.
- **Different inputs.** The same function fed stale renderer data can still disagree with main. That's expected: main's answer wins, and the UI refreshes.
- **Throwing on user mistakes.** A bad drop is a normal result (`out_of_bounds`), not an exception. We only throw for values that could only come from a bug, such as a 0-wide footprint from the manifest.

## Try it (5–15 min exercise)
In `tests/domain/placement-rules.test.ts`, add a test that places a 3×3 building at (61, 61) in a 64×64 world (it fits), then at (62, 61) (out of bounds). Then make the change to `insideWorld` that makes it fail (use `<` instead of `<=`) and watch the test catch it. Undo your change.

## Learn more
- TypeScript handbook: [Discriminated unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions)
- OWASP: [Input validation (server-side is the one that counts)](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
