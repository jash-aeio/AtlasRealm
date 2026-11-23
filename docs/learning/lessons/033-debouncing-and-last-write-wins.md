# Lesson 033: Debouncing, and choosing a concurrency rule
**Milestone:** M2 · **Date:** 2026-11-23 · **Related:** `src/renderer/world/comfort.ts`, `src/common/preferences/comfort.ts`, `profile-settings-repository.ts` (`updatePreferences`), ADR-0028, lesson 012, UI_SPEC §6.6

## The concept (plain words)
**Debouncing** means waiting for a pause before acting. A middle-drag moves the camera about 60 times a second. Saving each move would mean 60 database writes a second. Instead, every move restarts a short timer, and only when the camera has been still for 500 ms does one save go out.

A **concurrency rule** decides what happens when two saves overlap. Atlas Realm already has one: **optimistic concurrency** (lesson 012). Each save names the revision it last read, and a stale save is refused, so nobody silently overwrites someone else's edit. The other common rule is **last write wins**: the newest save simply replaces what's there.

## Why Atlas Realm needs it
A project name needs revisions: losing someone's rename would be a real bug. A camera position doesn't. The newest camera *is* the right one. If camera saves went through `profile.settings.update`, every pan would bump the settings revision, and the avatar form, still holding the old revision, would fail with `revision_conflict` for no good reason. So comfort preferences got their own command that merges each change and leaves the revision alone (ADR-0028).

## Where it lives in our code
The debounce, in `comfort.ts`:
```ts
saveCamera(worldId, camera) {
  pendingCamera = { worldId, camera };          // keep only the latest
  if (timer !== null) timers.clearTimeout(timer); // restart the wait
  timer = timers.setTimeout(() => void flushCamera(), CAMERA_SAVE_DELAY_MS);
}
```
`flushCamera` is also called when you leave a world, so a waiting save isn't lost.

Last write wins, in `ProfileSettingsRepository.updatePreferences`: a read-modify-write inside one transaction, and an `UPDATE` that sets only `preferences_json`, with no `revision = revision + 1`.

## Common mistakes
- **Losing the final value.** A debounce that never flushes on exit drops the last change. Always flush when leaving.
- **Debouncing per call instead of keeping the latest.** Save the newest value, not the first one that started the timer.
- **Using last write wins for data that matters.** It's only safe when the newest value is always the correct one. Never use it for permissions, schedules or user text.
- **Letting replies overwrite local state.** If two quick toggles' replies arrive out of order, the older reply can undo the newer click. Our store ignores replies unless a save fails.

## Try it (5–15 min exercise)
In `tests/domain/comfort-store.test.ts`, the test "saves a camera once it has been still" uses hand-run timers. Add a case: call `saveCamera` five times, fire the timer, and check that `update` ran once with the fifth camera. Then change `CAMERA_SAVE_DELAY_MS` to 0 and think about what a real drag would do to the database.

## Learn more
- MDN, `setTimeout` / `clearTimeout`: https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout
- SQLite transactions: https://www.sqlite.org/lang_transaction.html
- MDN, `prefers-reduced-motion`: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
