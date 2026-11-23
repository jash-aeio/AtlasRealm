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
1. **Storage:** new commands `profile.preferences.get` / `profile.preferences.update`, with a strict Zod schema. The main process merges the change into `preferences_json` without a revision check and without bumping the settings revision. Last write wins, which is fine for cosmetic preferences. No migration. ([ADR-0028](../adr/0028-comfort-preferences-and-building-labels.md))
2. **Labels:** fixed screen size. Labels are counter-scaled so the text stays about 13 px at every zoom. They're hidden only below 0.35×, where the map is an overview. ([ADR-0028](../adr/0028-comfort-preferences-and-building-labels.md))

## Plan
1. Contracts and main process: comfort schema plus a forgiving parser, the new IPC commands, a repository method that doesn't bump the revision, preload, unit and integration tests.
2. Renderer comfort store, reduced motion (attribute on the root element, CSS, OS media query), and a Comfort section in Settings.
3. Building name labels in the scene (fixed screen size, culled with the building), plus a Labels toggle in the world toolbar.
4. Saved camera: saved as the world point at the view centre plus zoom, debounced, restored on open and clamped to the map. E2E: a reload keeps the camera and the label setting.

## Done
Four commits on the branch, one per slice:
1. `feat(profile): comfort preferences IPC`: `src/common/preferences/comfort.ts` (schema, forgiving parser, merge with a 64-camera cap), `profile.preferences.get/update`, `ProfileSettingsRepository.updatePreferences` (one transaction, revision left alone), preload and API type.
2. `feat(settings): comfort section and reduced motion`: a renderer comfort store (`src/renderer/world/comfort.ts`), `data-motion` on `<html>` with CSS that turns transitions off, and the Settings Comfort section. It says plainly that there are no animations yet.
3. `feat(world): building name labels with a toggle`: `placement.list` reports `projectName`. Labels are scaled by 1 / zoom, hidden below 0.35×, cut to 32 characters and culled with their building. A Labels checkbox sits in the world toolbar, and the hover line names the project.
4. `feat(world): saved camera per world`: debounced saving of user moves only, restore clamped to the map, a late restore when the preferences arrive after the scene, and a flush when leaving a world.

Plus ADR-0028, lesson 033 (debouncing and last write wins), glossary terms, DATA_MODEL §9.3, the changelog and the status doc.

**Routine choices (no question asked):** placement.list got `projectName` (same pattern as `projectStatus`) instead of the world paging through `project.list`. Changes in Settings save straight away with no Save button. The labels toggle sits outside the "Zoom" button group, so screen readers don't hear it as a zoom control.

**Bugs caught while testing:**
- The first E2E run showed the saved zoom as 0.7813 while the live zoom was 0.78125, so I changed the rounding from 4 to 6 decimals.
- The clamp test raced the previous test's debounced Reset-view save. That race is correct app behaviour (last write wins), so the test now waits for the earlier save first.
- The test measured the view centre with Playwright's bounding box, which includes the host's border. It now uses `clientWidth`, like the app.

## Verification
typecheck, lint and format:check pass. Unit/integration 1022/1022. Full E2E 83/83, including 4 new comfort cases. Acceptance criteria:
- **Reduced motion follows the OS, with a saved override:** E2E "reduced motion follows the OS by default; Settings overrides it and it is saved" (emulated `prefers-reduced-motion`, then a reload). Units: `resolveReducedMotion`.
- **Labels toggle in Settings and the world, saved, readable at practical zoom:** E2E "a building shows its name label…" (shown at 0.5× and 0.4×, hidden at 0.32×) and "reload keeps the camera and the label setting".
- **Camera saved per world (debounced), restored and clamped:** E2E "reload keeps the camera…" and "a saved camera off the map opens clamped to the map edge". Units: the debounce, flush and math tests in `comfort-store.test.ts`.
- **Unit tests for the preference parsing:** `tests/domain/comfort-preferences.test.ts` (13) and `profile-contract` (+7).

**Reviews:** invariant-reviewer found no violations. security-auditor approved; L1 is fixed, and L2/L3 are known limitations (see the status doc).

## CI fix (same day)
The first CI run failed one test: the 100-building sanity bound (p95 frame gap 109 ms, limit 100). CI has no GPU, so it renders in software, and main already sat at 78 ms there. I reproduced it locally with software rendering and used an A/B test (labels on vs off, alternating in one app, to cancel out machine drift) to narrow it down:
- `BitmapText` instead of `Text`: no better.
- Text only or the box only: each cost the same as both.
- Hiding the whole label layer: the cost disappeared.
- Turning off Pixi's event system: no change.
- Stopping labels flipping visibility as they were culled: no change.

So the cost was drawing about 200 extra small objects per frame. **Fix:** each label is drawn once into a small texture (cached per text, freed when no longer shown, redrawn after a lost graphics context) and shown as a sprite, which batches like the building art. The world container also became a Pixi render group. The A/B went from +45% to +5–16%. Local full E2E 83/83; the GPU frame time is unchanged (6.9 ms).

## Open questions
- None blocking. Later: should labels hide when they overlap? Should deleting a world drop its saved camera? (Worlds can't be deleted yet.)
