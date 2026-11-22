# ADR-0028: Comfort preferences without a revision, and building labels at a fixed screen size

- **Status:** Accepted
- **Date:** 2026-11-23
- **Milestone(s) affected:** M2 (M2-14 #79), later anything that adds profile preferences
- **Decided by:** the user (asked via AskUserQuestion on 2026-11-23)

## Context
UI_SPEC §6.6 asks for reduced motion, building labels that can be toggled and "remain readable at practical zoom levels", and #79 adds a camera that comes back where you left it in each world.

The obvious home is `profile_settings.preferences_json`: it already exists, is a JSON object and is capped at 16 KiB (DATA_MODEL §9.2), so no migration is needed. Two things made this a real decision:

1. **No IPC route.** The renderer couldn't read or write preferences at all. `profile.settings.*` returned only the avatar, name and timezone.
2. **Revisions.** Every `profile.settings.update` takes `expectedRevision` and adds 1 to the row's revision (optimistic concurrency, ADR-0019). The camera is saved after every pan or zoom. Through that command, each save would bump the revision, and the avatar or name form, still holding the old one, would get `revision_conflict` on its next save.

Labels were the second question. Building art scales with the world zoom, and the default zoom is 0.5×. A 13 px label drawn the same way would be about 6 px tall: unreadable.

## Options considered
**Storage**

| Option | Pros | Cons |
|---|---|---|
| **A. New `profile.preferences.get/update`, merged without a revision** | Camera saves never conflict with settings forms. Strict Zod schema per field. No migration. | Last write wins. Two windows changing the same preference race, which is harmless for cosmetic values. |
| B. Add the fields to `profile.settings.update` | One contract | Every camera save bumps the revision, so the renderer must keep re-syncing it or forms conflict |
| C. Camera in new `worlds` columns (migration), toggles in preferences | Cleanest model per world | A schema change the issue meant to avoid, plus a world command |

**Labels**

| Option | Pros | Cons |
|---|---|---|
| **A. Fixed screen size**: counter-scale by 1 / zoom, hide below 0.35× | Readable at every zoom | At high zoom a label looks small next to its building |
| B. Scale with the world, hide when text would be under ~9 px | Looks "in world" | Hidden at the default 0.5× unless the font is made large |

## Decision
We chose **storage A** and **labels A**.

- `profile.preferences.get` / `profile.preferences.update` (`src/common/contracts/profile.ts`). The patch is `ComfortPatch` (`src/common/preferences/comfort.ts`): `reducedMotion` (`system` | `on` | `off`), `buildingLabels`, or one world's `camera`. At least one field must be given, and unknown fields are refused.
- The comfort values live under the `comfort` key of `preferences_json`. Other keys are kept untouched. `ProfileSettingsRepository.updatePreferences` does a read-modify-write in one transaction and does **not** change `revision` or `updated_at`.
- Reading is forgiving: each stored field that fails its schema falls back to its default on its own, and a bad camera entry is dropped.
- A saved camera is the world point at the view centre plus the zoom. That way a different window size still shows the same spot. Values are rounded (centre to 0.01, zoom to 6 decimals). At most 64 worlds keep a camera; the least recently saved is dropped first, so the 16 KiB cap is never reached. The renderer clamps a restored camera to the map and the zoom bounds.
- The renderer debounces camera saves (500 ms of stillness) and saves a waiting camera when you leave a world.
- Name labels are drawn in their own layer above all buildings. They are scaled by 1 / zoom, hidden below 0.35×, culled with their building and cut to 32 characters. `placement.list` gained `projectName` (next to `projectStatus`), so the world needs no extra project reads.

## Consequences
- Settings forms and camera saves never conflict. Future cosmetic preferences (UI scale, sound, animation pause) can join `ComfortPatch` the same way.
- Last write wins: two windows saving the same preference keep whichever arrived last. Fine for cosmetic values. A preference that guards something real (a permission, a schedule) must **not** use this route.
- Forward compatibility: only known fields under `comfort` are kept, so a newer app's extra comfort fields are dropped the next time this version writes. Other top-level preference keys are kept. If other keys ever fill the 16 KiB cap, comfort saves fail with `invalid_payload` until they shrink (security review L2).
- A camera saved for a world that no longer exists stays until the 64-entry cap pushes it out. The command doesn't check that the world exists.
- Reduced motion is stored and applied (`data-motion` on the root, CSS transitions off, `useReducedMotion` hook), but the app has no animations yet. M8 and the Atlas force layout must read the hook.
- Revisit if preferences grow past a few KiB, if several windows per profile arrive, or if users say labels clutter a dense world: per-label collision hiding would be the next step.

## Learning note
Not every piece of data needs a version check. Revisions protect edits where losing someone's change matters, like a project name. For a camera position or a toggle, the latest value is the right one, and a version check would only produce false conflicts. Pick the concurrency rule that fits what the data means.
