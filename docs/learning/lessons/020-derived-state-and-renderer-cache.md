# Lesson 020: Derived state, and the renderer as a cache
**Milestone:** M1 · **Date:** 2026-11-18 · **Related:** `src/renderer/state/session.ts`, `src/renderer/onboarding/Onboarding.tsx`, ADR-0022, PRD §5.1

## The concept (plain words)
**Derived state** is a value you compute from data you already have instead of saving it separately. If you store it twice, the two copies can disagree; if you compute it, they can't.

A **cache** is a copy of data kept close by for speed. Our renderer (the web page) has no database access, so everything it shows is a cached copy of what the main process said. The rule for a cache: after anything changes, re-read it instead of guessing the new value.

## Why Atlas Realm needs it
- "Is this the first launch?" could be an `onboardingDone` flag. But a skipped avatar, a new profile or a restored backup could all leave that flag wrong. "The active profile has no world yet" is the actual reason to show onboarding, and the database already knows it.
- The product rules say: show real status. If the page updated its copy by itself after a rename, it could show a name that was never saved (for example, if the main process refused it).

## Where it lives in our code
```ts
// session.ts: the screen is computed, never stored
export function screenFor(state: SessionState): Screen {
  if (state.status !== 'ready') return state.status;
  return state.data.worlds.length === 0 ? 'onboarding' : 'main';
}

// every command re-reads afterwards; a conflict re-reads and tells the user
const result = await run();
if (result.ok) await load(null);
else if (result.error.code === 'revision_conflict') await load(CONFLICT_NOTICE);
```
**Newest reload wins:** `load` takes a ticket number. A slow, older read that finishes late sees it isn't the newest and drops its result, so "no worlds" can't overwrite "one world".

**Focus management** follows the same idea for the keyboard: when the step changes, `Onboarding.tsx` moves focus to the new heading (`tabIndex={-1}` + `focus()`). Otherwise keyboard users would be left on a button that no longer exists.

## Common mistakes
- Keeping a second copy (a React `useState` holding the worlds) next to the store, so the two drift apart.
- Updating the UI before the main process confirms ("optimistic update") without a plan for when it fails.
- Using a changing value as a React `key` (for example a name), which remounts the form and throws away its "Saved" message.

## Try it (5–15 min exercise)
In `tests/domain/session-store.test.ts`, remove the `ticket !== latestReload` check from `session.ts` and run `corepack pnpm vitest run tests/domain/session-store.test.ts`. Which test fails, and why? Put the check back.

## Learn more
- React: [Choosing the state structure: avoid redundant state](https://react.dev/learn/choosing-the-state-structure#avoid-redundant-state)
- React: [`useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore)
- MDN: [Keyboard-navigable JavaScript widgets (managing focus)](https://developer.mozilla.org/en-US/docs/Web/Accessibility/Keyboard-navigable_JavaScript_widgets)
