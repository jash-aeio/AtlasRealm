# Lesson 028: The ABA problem and explicit replacement

**Milestone:** M2 · **Date:** 2026-11-22 · **Related:** `src/main/services/hotbar-service.ts`, `src/common/contracts/hotbar.ts`, ADR-0026, ADR-0023, lesson 012

## The concept (plain words)
Lesson 012 introduced **optimistic concurrency**: a save names the version it last read, and it is refused if the data has moved on. It works only if a version marker never comes back.

The **ABA problem** is what happens when one does come back. You read state **A**. Someone changes it to **B**, then back to something that *looks like* **A** again. Your check says "unchanged" and lets a stale action through.

The hotbar has exactly this trap. An empty slot has no database row, so:

1. Slot 0 holds project *Alpha* at **revision 1**. Your screen shows Alpha.
2. Someone clears slot 0 (the row is deleted), then pins *Beta* there. It's a new row, so it's **revision 1** again.
3. You click "Unpin Alpha", which sends `expectedRevision: 1`. The check passes, and Beta disappears.

The fix is to compare what the user actually saw. The request says `expectedTargetId: <Alpha's ID>`. Beta's ID never matches, so the request is refused.

The second idea is **explicit replacement**. Filling a slot that already holds something is never a side effect. Without `replace`, the answer is `slot_occupied`, and it carries the current occupant so the UI can ask "Replace Alpha?". Only a second request that names Alpha goes through.

## Why Atlas Realm needs it
PRODUCT_RULES §3.1 and §22.2 #2 forbid silent replacement: a shortcut the user set up must never vanish because of a stale screen or an eleventh project. A pin is only a shortcut, but losing it without being asked still breaks the user's trust.

## Where it lives in our code
```ts
// src/main/services/hotbar-service.ts (simplified)
const current = slots.get(world.id, input.slot);
if (current === undefined) return slots.assign(...);            // empty: nothing to lose
if (input.replace?.expectedTargetId !== current.target.id) {
  throw this.occupied(current);                                 // slot_occupied + occupant
}
return slots.replace(world.id, input.slot, current.revision, input.target);
```
The read and the write happen in one synchronous call on the single writer connection, so nothing can change the slot in between (lesson 024). The repository still checks the revision as a second guard.

## Common mistakes
- Using a counter that restarts (a row that is deleted and re-created) as a version marker.
- Answering "occupied" without saying *by what*. The UI then has to guess or reload before it can ask the user.
- Treating "the slot is empty now" as an error when the user asked to replace. There's nothing to lose, so just fill it.

## Try it (5–15 min exercise)
1. Read the test "refuses a slot that was cleared and refilled, even though its revision is 1 again" in `tests/integration/hotbar-contract.test.ts`.
2. Imagine `clear` took `expectedRevision` instead. Write down which line of the test would then pass when it shouldn't.
3. Name another place in Atlas Realm where a version marker could repeat. Hint: think about rows that get deleted.

## Learn more
- [Wikipedia: ABA problem](https://en.wikipedia.org/wiki/ABA_problem)
- [Martin Fowler: Optimistic Offline Lock](https://martinfowler.com/eaaCatalog/optimisticOfflineLock.html)
