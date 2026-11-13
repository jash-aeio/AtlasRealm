# ADR-0020: Project command contracts: world-scoped ownership, keyset cursor paging, stubbed active-runs check, namespaced template IDs (migration v4)

- **Status:** Accepted
- **Date:** 2026-11-13
- **Milestone(s) affected:** M1 (M1-7 #34; M1-10 #37 builds the project list UI on these commands), M4 (replaces the active-runs stub)
- **Decided by:** jash-aeio (asked via AskUserQuestion on 2026-11-13, during `/start-task 34`)

## Context
M1-7 exposes projects to the renderer: create, get, paged list, rename, goal, archive, restore, trash, restore from trash (PRD §5.6, PRODUCT_RULES §3.1, ARCHITECTURE §16.1). §16.1 asks every command to validate target ownership and the expected revision, and every query to be paged and scoped to the active profile and world. Four questions came up:

1. **World scope.** The app has no saved "active world" yet. Which world does a project command act in, and how is "this project belongs to that world" checked?
2. **Paging.** How does the renderer ask for the next page, and how big are pages?
3. **Active runs.** PRD §5.6 says archive requests cancellation of active work and trash requires handling active runs first. The run runtime only arrives in M4.
4. **Template IDs.** While implementing `create`, it turned out the `projects.template_id` CHECK from migration v2 (M1-3) only allowed `a-z0-9-`, max 64. Real template IDs are namespaced, e.g. `builtin.generic` (DATA_MODEL §10.1, `TemplateId` from M1-5), so no project could be created from a bundled template. M1-3 and M1-5 were built in parallel and never had to meet.

## Options considered
| Question | Option | Pros | Cons |
|---|---|---|---|
| World scope | **`worldId` on every call** | Ownership checked explicitly; a project from another world is `not_found` | Slightly more verbose calls |
| | `projectId` only | Simpler | Nothing to check "other-world" IDs against |
| | Saved "active world" setting | Short calls | New schema field; scope creep |
| Paging | **Opaque keyset cursor, 50 per page (max 100)** | Changes between page loads can't duplicate or skip rows | Cursor must be validated; can't jump to page N |
| | Offset numbers | Easy to understand | Rows shift when projects are added or removed |
| Active runs | **Refuse archive and trash if runs are active; label the stub** | Honest: nothing claims cancellation that doesn't exist | Archive is stricter than the PRD until M4 |
| | Refuse trash only | Closer to the PRD wording | Archive's "request cancellation" would silently do nothing |
| Template IDs | **Migration v4 rebuilds `projects`** | Matches the spec format; no data lost | One table rebuild; `graph_entities` must be rebuilt too |
| | Rename templates to `builtin-generic` | No migration | Departs from DATA_MODEL §10.1; changes M1-5's contract |
| | Strip `builtin.` on save | No migration | Ambiguous once other namespaces exist |

## Decision
- **Every `project.*` call names `worldId`** (and `projectId` where it targets one project). The service loads the project and refuses with `not_found` unless it is in that world. An unknown ID, another world's project and another profile's project all get the same answer. `project.list` for an unknown world is `not_found`, not an empty list.
- **`project.list` uses a keyset cursor**: the base64url-encoded `(name, id)` of the last row, bound to the world and status it was made for. The next page starts strictly after it (`ORDER BY name COLLATE NOCASE, id`). Default page 50, max 100. A cursor that doesn't decode, has the wrong shape, or belongs to another world/status is `invalid_payload`. One status per request (`active` by default).
- **Archive and trash ask an `ActiveRunsProbe`.** Until M4 it is `noActiveRunsStub`, which always reports none; both results carry `runCheck: 'stub'` so the UI can say run handling isn't available yet. If a probe reports runs, both refuse with `invalid_transition`.
- **Migration v4** rebuilds `projects` so `template_id` follows the `TemplateId` rule (lowercase words joined by single `.` or `-`, 1–100 chars). `graph_entities` references `projects`, so it is copied aside, dropped, and recreated after the swap. That order keeps foreign keys on the whole time, inside the runner's normal transaction. Every row, column and index is preserved; the repository validates with the same rule (`assertTemplateId`).
- Also (spec defaults, not asked): `create` needs a template that loaded and validated at startup (exact id + version, else `not_found`), refuses an archived world (`invalid_transition`), and caps a world at **1000 projects, trash included** (`limit_reached`).

## Consequences
- The project list UI (M1-10) passes `worldId` everywhere and keeps the `nextCursor` it gets back; it never builds a cursor.
- Renaming a project between page loads can make it appear on a later page again or not at all for that walk. That is the usual keyset trade-off and is fine for a list that reloads.
- M4 replaces the stub with a probe over persisted runs. Archive then requests cancellation instead of refusing, and `runCheck` gains a real value. Any UI text keyed on `'stub'` must change then.
- Each future change to a `projects` CHECK needs another rebuild, including `graph_entities` (and any later table that references `projects`).
- Signals to revisit: users need "jump to page N" or a total count; a world legitimately needs more than 1000 projects; a CHECK rebuild becomes common enough to want a reusable helper.

## Learning note
An offset says "skip 50 rows", so it breaks when rows move. A keyset cursor says "start after this exact row", so it doesn't. Separately, two features built in parallel can each be correct on their own and still not fit together. The first code that uses both (here `project.create`) is where you find out, which is why end-to-end tests with real data matter.
