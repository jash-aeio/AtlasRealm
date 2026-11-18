# Lesson 021: Accessible confirmations: modal dialogs, focus return and live regions
**Milestone:** M1 · **Date:** 2026-11-18 · **Related:** `src/renderer/projects/ConfirmDialog.tsx`, `ProjectsPanel.tsx`, `ProjectItem.tsx`; UI_SPEC §6.6; PRD §5.6; #37

## The concept (plain words)
A **modal dialog** is a box the user must answer or close before the rest of the page works
again. The browser's native `<dialog>` element does most of the hard work once you open it with
`showModal()`. Keyboard focus stays inside the dialog, Escape closes it, and the page behind it
can't be clicked or tabbed into.

**Focus return** means that when the dialog closes, keyboard focus goes back to where the user
was, usually the button that opened it. Without it, focus falls to the top of the page and a
keyboard or screen-reader user loses their place.

A **live region** (`role="status"` or `role="alert"`) is a part of the page whose text changes
get read aloud without moving focus. `status` waits for a pause; `alert` interrupts.

## Why Atlas Realm needs it
PRD §5.6 says archive and trash must explain exactly what happens and what does not, and UI_SPEC
§6.6 says focus is "visible and restored after dialogs". The app also has to be fully usable by
keyboard, with screen-reader-friendly lists that don't announce every small change.

## Where it lives in our code
```tsx
// ConfirmDialog.tsx: remember the opener, open as modal, restore on close
useEffect(() => {
  const opener = document.activeElement as HTMLElement | null;
  dialog.current.showModal();
  return () => {
    if (opener?.isConnected) opener.focus();
    else fallback.current(); // the row is gone → focus the "Projects" heading
  };
}, []);
```
- **Cancel is first and has `autoFocus`**, so a stray Enter never confirms by accident.
- After archiving, the project leaves the Active filter and its button no longer exists. The
  dialog notices this (`isConnected` is false) and focuses the heading, which has
  `tabIndex={-1}`, instead.
- `ProjectsPanel` has **one** `role="status"` line ("Showing 3 active projects.") rather than
  announcing each row.

## Common mistakes
- Building a "dialog" out of a `<div>`: focus escapes behind it and Escape does nothing.
- Using `window.confirm()`: it blocks the whole app, can't explain much, and can't be styled.
- Forgetting focus return, or returning focus to an element that has just been removed.
- Making every list row a live region, so a screen reader reads out 50 rows.
- Putting the dangerous button first or giving it focus by default.

## Try it (5–15 min exercise)
Run `pnpm dev`, create a project, and use only the keyboard. Tab to **Archive** and press Enter,
then press Escape. Where is focus now? Do it again and confirm. Where is focus this time, and why
is it different? Then remove the `fallback.current()` line and see what happens to focus.

## Learn more
- MDN: [`<dialog>` element](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog)
- MDN: [ARIA live regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/ARIA_Live_Regions)
- WAI-ARIA APG: [Dialog (modal) pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
