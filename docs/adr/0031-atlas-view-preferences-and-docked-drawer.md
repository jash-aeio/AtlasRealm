# ADR-0031: Realm Atlas display preferences in the profile preferences, and a docked narrow drawer

- **Status:** Accepted
- **Date:** 2026-11-23
- **Milestone(s) affected:** M2 (M2-12 #77, M2-13 #78), later the graph view state (§30.7)
- **Decided by:** the user (asked via AskUserQuestion on 2026-11-23)

## Context
GRAPH_MODEL §30.1 says the Realm Atlas can be collapsed, resized, expanded and pinned to a
project, that these display preferences persist per profile and world, and that at narrow widths
the Atlas becomes a drawer that "must not cover editing controls or approval decisions". #77 adds
those controls, so two questions came up:

1. **Where to store them.** DATA_MODEL §9.3 lists a `graph_view_states` table (scope, active
   view/filter, pinned nodes, collapsed groups, layout coordinates). The profile preferences JSON
   already holds the comfort values (ADR-0028), which are just as cosmetic.
2. **How the narrow drawer avoids covering controls.** Since M2-5 it was a `position: fixed`
   overlay on the right, over the world, the placement tool bar and any open panel.

## Options considered
**Storage**

| Option | Pros | Cons |
|---|---|---|
| **A. `atlasViews` key in `preferences_json`, new `profile.atlasView.get/update`** | No migration. Same proven pattern as comfort (forgiving parse, no revision). | Shares the 16 KiB limit with comfort; last write wins. |
| B. `graph_view_states` table now (migration 7) | Matches the spec table | About a day more (migration, fixtures, repository, revisioned commands) for cosmetic values. Layout coordinates, the part that needs a table, don't exist yet. |

**Narrow drawer**

| Option | Pros | Cons |
|---|---|---|
| **A. Dock as a grid column** | Overlap is impossible by construction, and a test can check bounding boxes | The world gets narrower while the drawer is open |
| B. Overlay that auto-closes | The map stays large | Every new editing control needs its own close rule; easy to miss one |

## Decision
We chose **storage A** and **drawer A**.

- `src/common/preferences/atlas-view.ts`: per world, `tab` (`map` | `connections`),
  `collapsed`, `expanded`, `width` (whole CSS pixels, 256–720), `pinnedProjectId` (a project
  UUID or null) and `followSelection`. Defaults: Map, open, normal size, 320 px, unpinned, not
  following.
- Stored under `atlasViews` in `profile_settings.preferences_json`, keyed by world ID, least
  recently changed first, at most 32 worlds. With 64 saved cameras and 32 views the JSON stays
  under 16 KiB (a unit test checks the worst case).
- `profile.atlasView.get` (no payload) returns every saved view. `profile.atlasView.update`
  takes `{ worldId, change }`, where `change` is a strict partial with at least one field. Like
  ADR-0028 there is no revision, the settings revision isn't touched, and reading falls back
  field by field.
- The pinned project ID is a display choice only. It isn't checked against `projects` (the
  renderer reads it with the world-scoped `project.get` and shows "no longer here" if it's gone),
  and nothing reads it to decide access.
- The renderer debounces width saves (400 ms) while the resize handle is dragged.
- At ≤ 60rem the side column is a third grid column whose width is `auto`: empty when closed,
  `min(saved width, 50vw)` when open.

## Consequences
- Atlas layout saves never conflict with settings forms, and no migration was needed.
- Last write wins across windows; fine for cosmetic values. Anything that guards real behaviour
  must not use this route.
- Only known fields are kept, so a newer app's extra Atlas fields are dropped when this version
  writes. Views for deleted worlds stay until the 32-entry cap pushes them out.
- **Shared 16 KiB budget** (security review L1/L2): comfort and Atlas views each have their own cap, and only their sum keeps `preferences_json` under the limit (worst case about 12.4 KiB, checked by `atlas-view-preferences.test.ts` with the largest camera values). Any new preference key must join that test. Unknown top-level keys are kept on every write (forward compatibility), so a huge hand-edited key would make every preference save fail visibly, never silently.
- **World IDs aren't checked against `worlds`** (security review L3), the same as saved cameras: a view can be saved for a world that doesn't exist, and a deleted world's view stays until the cap pushes it out. Cosmetic only; pruning on world deletion can come when worlds can be deleted.
- `graph_view_states` still comes when graph layout coordinates or collapsed groups need saving
  (M2-13 or later, §30.7). Moving these values there then is a small read-and-copy.
- In very narrow windows an open drawer leaves the world small. A minimum world width can come
  with the M8 UI pass.

## Learning note
"Must not cover X" is easiest to guarantee by layout rather than by rules. If two things share
the grid, they can't overlap, and that stays true when someone adds a new control next month.
An overlay needs a rule for every control, and the rule you forget is the bug.
