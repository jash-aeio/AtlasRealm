# Lesson 034: Accessible tabs (the WAI-ARIA tabs pattern and roving tabindex)
**Milestone:** M2 · **Date:** 2026-11-23 · **Related:** `src/renderer/library/{library-tabs.ts,LibraryPanel.tsx}`, `tests/e2e/library.spec.ts`, UI_SPEC §6.3 and §6.6

## The concept (plain words)
A row of buttons that *looks* like tabs is not a tab widget to a screen reader or a keyboard user. The **WAI-ARIA tabs pattern** is the agreed recipe that makes it one:
- a container with `role="tablist"` and a label;
- one `role="tab"` button per section, with `aria-selected="true"` on the chosen one and `aria-controls` pointing at its panel;
- a `role="tabpanel"` labelled by its tab (`aria-labelledby`).

A screen reader then says "Agents, tab, 2 of 6, selected".

**Roving tabindex** handles the keyboard. Only the selected tab has `tabindex="0"`; the others have `-1`. Tab stops on the tab list *once*, the arrow keys move between tabs, Home and End jump to the ends, and the next Tab goes into the panel. The `0` "roves" to whichever tab is selected.

## Why Atlas Realm needs it
UI_SPEC §6.6 asks for every canvas action to have a keyboard-usable list equivalent. The library has six tabs. Without roving tabindex, reaching the project list would cost six extra Tab presses every time, and screen readers wouldn't know which section is open.

## Where it lives in our code
The key logic is pure, so it is unit-tested in Node (`tests/domain/library-tabs.test.ts`):
```ts
// library-tabs.ts
export function tabForKey(current, key) {
  if (key === 'ArrowRight') next = index === last ? 0 : index + 1; // wraps
  else if (key === 'Home') next = 0;
  ...
  else return null; // not ours: leave the key alone
}
```
`LibraryPanel.tsx` applies it:
```tsx
<button role="tab" aria-selected={t.id === tab} tabIndex={t.id === tab ? 0 : -1} … />
// onKeyDown on the tablist:
event.preventDefault();      // so the app's shortcut layer ignores the key
onTabChange(next);           // automatic activation: moving selects
tabRefs.current.get(next)?.focus();
```
The tab is selected as soon as focus moves to it ("automatic activation"). That suits us because every panel shows at once; slow panels would wait for Enter instead.

## Common mistakes
- Setting the roles but forgetting the keyboard part: the screen reader announces tabs, but arrow keys do nothing.
- Leaving every tab at `tabindex="0"`: correct roles, but there's no point in roving.
- Changing the selection without moving focus: the next arrow press starts from the wrong tab.
- Not calling `preventDefault()`. In our app the shortcut layer (lesson 029) would then see the key too.

## Try it (5–15 min exercise)
Open the library (`E`), click the Projects tab, then press Tab: focus goes into the panel, not to "Agents". Then add a `PageDown` key to `tabForKey` that jumps to the last tab, write the failing test first in `library-tabs.test.ts`, and make it pass. (Undo it afterwards; PageDown isn't part of the pattern.)

## Learn more
- WAI-ARIA Authoring Practices, Tabs pattern: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
- Roving tabindex: https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/#kbd_roving_tabindex
