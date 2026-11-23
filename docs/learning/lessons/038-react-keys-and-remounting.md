# Lesson 038: React keys, reconciliation and forcing a remount
**Milestone:** M2 · **Date:** 2026-11-23 · **Related:** `src/renderer/hotbar/PinToHotbar.tsx`, `tests/e2e/hotbar.spec.ts`, issue #75

## The concept (plain words)
After every render, React compares the new tree of elements with the old one. This is called
**reconciliation**. If an element of the same type sits at the same position, React **reuses**
the existing DOM node and only updates its props. If the type or the `key` differs, React throws
the old node away and **mounts** a new one.

Some behaviour only happens on mount. `autoFocus` is one example: React focuses the element when
it's created, not when an existing element gets the prop. A `key` is how you tell React "this is
a different thing now, start fresh".

## Why Atlas Realm needs it
The "Pin to hotbar" dialog has steps: the slot list, then "Slot 3 is already in use, Replace?".
On the Replace step, **Cancel must have focus**, so that a stray Enter can never replace a
shortcut (§22.2 #2). Both steps end with a `div.form-actions` whose first button is a Cancel
button, and it sits at the same position in both. React reused the old Cancel button, so
`autoFocus` never fired and focus was left on nothing. The E2E test
`replacing asks first and names the shortcut` caught it.

## Where it lives in our code
`PinToHotbar.tsx` gives each step its own key:

```tsx
{replacing !== null ? (
  <Fragment key="replace">…<button autoFocus>Cancel</button>…</Fragment>
) : pinned !== undefined ? (
  <Fragment key="pinned">…</Fragment>
) : (
  <Fragment key="slots">…</Fragment>
)}
```

We already used the same trick elsewhere. `ProjectInspector` renders
`<SelectedProject key={projectId} …>`, so selecting another project starts with fresh messages
and no open dialog. `MainScreen` keys `ProjectsPanel` and `WorldView` by `world.id`.

## Common mistakes
- Expecting `autoFocus`, `useState(initial)` or a mount-only `useEffect` to run again when only the props change.
- Using an array index as the `key` in a list that can be reordered. State then sticks to the position instead of the item.
- Giving something a key that changes on every render (like `Math.random()`). It remounts constantly and loses its state and focus.

## Try it (5–15 min exercise)
In `PinToHotbar.tsx`, temporarily change `<Fragment key="replace">` back to `<>` (and its
closing tag). Run `pnpm build` and then `pnpm exec playwright test tests/e2e/hotbar.spec.ts`.
Which assertion fails? Restore the key and run the test again.

## Learn more
- React docs, "Preserving and Resetting State": https://react.dev/learn/preserving-and-resetting-state
- React docs, "Rendering Lists" (why keys): https://react.dev/learn/rendering-lists
