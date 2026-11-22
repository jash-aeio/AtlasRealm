# Lesson 032: The command pattern and inverse operations (undo/redo)
**Milestone:** M2 · **Date:** 2026-11-22 · **Related:** `src/renderer/world/placement-history.ts`, `PlacementHistoryControls.tsx`, UI_SPEC §17.2, issue #73

## The concept (plain words)
The **command pattern** keeps each change as a small piece of data instead of "just doing it". Because the change is data, you can store it in a list, do it again later, or work out its **inverse**: the change that cancels it. Undo/redo is two lists (stacks). Undo pops the newest change, sends its inverse and pushes it onto the redo list. Redo does the reverse. A brand-new change empties the redo list, because the future it described no longer exists.

## Why Atlas Realm needs it
UI_SPEC §17.2 asks for undo of placement changes *without* undoing unrelated work. Recording only place/move/remove entries means archiving a project, files or runs can never be undone by accident. And an undo is not magic time travel. It is a **new ordinary command**, so the main process checks it like any other. If someone moved the building in the meantime, the undo is refused with `revision_conflict` instead of overwriting their work.

## Where it lives in our code
```ts
// placement-history.ts (simplified)
function inverse(entry) {
  switch (entry.kind) {
    case 'place':  return remove(entry.after);             // undo a place = remove it
    case 'move':   return move(entry.after, entry.from);   // move it back
    case 'remove': return create(entry.project, entry.spot); // place it again
  }
}
```
Each entry remembers the building *version* (ID + revision) it expects. The tool calls `history.record(change)` only after the main process confirmed a change (`placement-tool.ts`).

## Common mistakes
- **Forgetting that inverses create new identities.** Undoing a remove creates a *new* building with a new ID. Older entries still point at the old ID, so `replaceVersion` rewrites them. Our chain unit test caught a bug here: the entry currently being undone was on neither stack, so it kept the dead ID.
- **Forcing the undo.** Retrying with the newest revision would silently trample someone else's change. Drop the step and explain instead.
- **Resending when there was no answer.** The first try may have worked. Say "not sure", reload, and never repeat it (PRODUCT_RULES §3.1).
- **Recording failures.** Only confirmed changes go on the stack.

## Try it (5–15 min exercise)
In `tests/domain/placement-history.test.ts`, write a test: place Alpha, move it twice, then undo twice and check it is back at the first tile. Then move it from "another window" with `t.setRows(...)` between the two undos and check the second undo is refused with the conflict message.

## Learn more
- Refactoring Guru, Command pattern: https://refactoring.guru/design-patterns/command
- MDN, `KeyboardEvent.key` (how Ctrl+Z is matched): https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key
