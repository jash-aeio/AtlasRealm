# 2026-11-23 · Comfort settings (M2-14 #79)

**Branch:** `feat/79-comfort-settings` (main checkout, from main @ e543bf7)

## Task
UI_SPEC §6.6 comfort options: reduced motion, a building labels toggle, and a camera that comes back where you left it in each world.

## What exploring the code showed
- `profile_settings.preferences_json` already exists (a JSON object, capped at 16 KiB), but no IPC command shows it to the renderer. The issue assumed it was already exposed.
- Every `profile.settings.update` adds 1 to the settings revision. If the camera were saved there, every pan would make the avatar and name forms hit a revision conflict.
- Buildings have no name labels yet. The only signs are "Archived" and "Missing art", drawn at world scale, so at the default 0.5× zoom the text is about 6 px tall.
- The app has no animations or easing yet. For now, reduced motion stores the choice and gives later animation code one place to ask. It has nothing to turn off today.

## Decisions (user, via AskUserQuestion)
1. **Storage:** new commands `profile.preferences.get` / `profile.preferences.update`, with a strict Zod schema. The main process merges the change into `preferences_json` without a revision check and without bumping the settings revision. Last write wins, which is fine for cosmetic preferences. No migration. (ADR-0028)
2. **Labels:** fixed screen size. Labels are counter-scaled so the text stays about 13 px at every zoom. They're hidden only below 0.35×, where the map is an overview. (ADR-0028)

## Plan
1. Contracts and main process: comfort schema plus a forgiving parser, the new IPC commands, a repository method that doesn't bump the revision, preload, unit and integration tests.
2. Renderer comfort store, reduced motion (attribute on the root element, CSS, OS media query), and a Comfort section in Settings.
3. Building name labels in the scene (fixed screen size, culled with the building), plus a Labels toggle in the world toolbar.
4. Saved camera: saved as the world point at the view centre plus zoom, debounced, restored on open and clamped to the map. E2E: a reload keeps the camera and the label setting.

## Done
_(filled in as slices land)_

## Open questions
_(none yet)_
