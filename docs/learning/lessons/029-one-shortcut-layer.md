# Lesson 029: One keyboard shortcut layer

**Milestone:** M2 · **Date:** 2026-11-22 · **Related:** `src/renderer/app/shortcuts.ts`, `src/renderer/app/ShortcutLayer.tsx`, `src/renderer/app/MainScreen.tsx`, UI_SPEC §6.2 and §6.6, lesson 020

## The concept (plain words)
A **keyboard shortcut layer** is one place that decides what a key press means. When you press a key, the browser sends a `keydown` event to the focused element. The event then **bubbles** up through its parents to `window`. One listener on `window` therefore hears every key, and can look at `event.target` to see where the key was pressed.

Two rules make shortcuts safe to use:
1. **Never take keys from text fields.** If focus is in an `input`, `textarea`, `select` or `contenteditable` element, the letter belongs to the text.
2. **Give focus back.** When a panel closes, focus returns to the button that opened it, so keyboard users don't land at the top of the page.

## Why Atlas Realm needs it
UI_SPEC §6.2 gives single-letter shortcuts: `E` opens the library, and `1`–`0` will trigger the hotbar. Without rule 1, typing "Release notes" as a project name would open the library twice. If every feature added its own listener, each one would need its own copy of that check, and sooner or later one copy would be wrong. With one layer, the check lives in one tested function.

The listener is an ordinary page listener, not a "global hook". It only hears keys while Atlas Realm has focus, so the app never takes keys from other programs.

## Where it lives in our code
```ts
// src/renderer/app/shortcuts.ts (shortened)
export function shouldHandle(event, modalOpen) {
  if (event.defaultPrevented || event.isComposing || event.repeat) return false;
  if (event.metaKey || modalOpen) return false;
  return !isEditableTarget(event.target);
}
```
Components register keys with `useShortcut('e', toggleLibrary)`. When two shortcuts use the same key, the newest wins, so an open tool's Escape will run before the screen's Escape.

Focus return is in `MainScreen.tsx`. Before a panel opens, the code remembers `document.activeElement`. On close, it focuses that element again if it is still on the page. If it isn't, it focuses the entrance button for that panel.

## Common mistakes
- Checking only `INPUT`. A `textarea` (the goal field) and `contenteditable` count too.
- Forgetting modal dialogs. While a `<dialog>` is open, Escape belongs to the dialog.
- Shortcuts that react to held-down keys. `event.repeat` would toggle the library on and off very fast.
- Restoring focus to an element that React has already removed. Check `isConnected` first.

## Try it (10 min)
In `tests/domain/shortcuts.test.ts`, add a test showing that `Alt+E` doesn't open the library. Then make `matches()` ignore `altKey` and watch the test fail. Put the check back afterwards.

## Learn more
- MDN: [KeyboardEvent](https://developer.mozilla.org/docs/Web/API/KeyboardEvent) and [Event bubbling](https://developer.mozilla.org/docs/Learn_web_development/Core/Scripting/Event_bubbling)
- WAI-ARIA APG: [Developing a keyboard interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
