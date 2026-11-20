# ADR-0025: Placement command contracts: refusal details, server-chosen appearance, fail-closed lost art, archived projects placeable

- **Status:** Accepted
- **Date:** 2026-11-21
- **Milestone(s) affected:** M2 (M2-3 #68; M2-4 #69 reuses the error-detail pattern; M2-6 #71 and M2-7 #72 build on the commands)
- **Decided by:** jash-aeio (asked via AskUserQuestion on 2026-11-21, during `/start-task 68`; archive/trash removing the building was decided on 2026-11-20 during M2 planning)

## Context
M2-3 exposes building placements to the renderer: list, create, move, remove (ARCHITECTURE §16.1, UI_SPEC §17.2, TEST_PLAN §22.2 #3–#5). The handler must run the shared placement rules (M2-1, ADR-0024) again on data it reads itself, whatever the preview said. The #66 security review asked for three things: validate rotation before the rules run (L1), never take a footprint from the payload (L2), and decide what happens when a stored building's appearance no longer resolves (L3). Four questions needed an answer:

1. **Refusals.** How does the UI learn *why* a placement was refused, and which buildings are in the way?
2. **Appearance.** Who picks a new building's art (and so its footprint)?
3. **Lost art.** What footprint does a stored building count as when its appearance ID is no longer in the manifest?
4. **Archived projects.** Archiving removes the building (decision of 2026-11-20). May an archived project be placed again afterwards?

## Options considered
| Question | Option | Pros | Cons |
|---|---|---|---|
| Refusals | **New code `placement_blocked` with `placement: { reason, blockingIds }`** | UI can highlight blockers; pattern reusable for M2-4 `slot_occupied` | Small change to the shared error shape |
| | Reuse `invalid_transition` with text | No contract change | Text only; no blockers |
| | `ok: true` with `{ placed: false, reason }` | Matches "valid placement or reason" literally | Two layers of success to check everywhere |
| Appearance | **Server uses the bundled default** | Nothing to forge; smallest surface | Field must be added when a picker exists |
| | Optional `appearanceId` in payload | Flexible now | More to validate; no picker planned in M2 |
| Lost art | **Count as 4×4 (largest building, ADR-0013), log once** | Nothing squeezes on top; world still works | A small building may block a little extra |
| | Count as 16×16 (manifest max) | Even safer | One bad row can make a small world feel full |
| | Refuse all changes in that world | Strictest | Blocks the user over a cosmetic problem |
| Archived | Active only | Simple | User must unarchive before placing |
| | **Archived may be placed** | User keeps archived projects visible on the map | Renderer must draw them differently |

## Decision
- **Channels** follow the issue: `placement.list`, `placement.create`, `placement.move`, `placement.remove` (ARCHITECTURE §16.1's example name `building.place` is updated). Every call names `worldId` (ADR-0020).
- **Refusals by the rules** are `placement_blocked`, with `placement.reason` = `out_of_bounds` | `reserved` | `overlaps` and `placement.blockingIds` (the buildings in the way; empty for the other reasons). `CommandError` gained optional details, and the router copies only the known fields across. Other refusals keep their codes: unknown project, another world's project, unknown world or another world's building → `not_found`; trashed project → `invalid_transition`; a second building for the same project → `already_exists`; stale revision → `revision_conflict` (checked before the rules on move); archived world → `invalid_transition` for create, move and remove (list still works).
- **The payload never carries a footprint or appearance.** Strict Zod objects refuse extra keys; rotation must be 0/90/180/270 and tiles whole numbers 0–255 in the schema. The main process reads footprints from the bundled asset manifest (`BuildingAppearances`, built into the main bundle) and uses `placeholder.building.2x2` for new buildings. Only `building` entries count.
- **Lost art fails closed as 4×4**, with one warning per appearance ID (quoted and cut short, so a damaged row can't forge log lines). `placement.list` reports that 4×4 as the building's `footprint`.
- **Archived projects may be placed** (user, 2026-11-21). Each listed placement carries `projectStatus`, so the world can draw an archived project's building differently. The different look, and offering "Unarchive" when it is clicked, are renderer work for M2-6 #71.
- **Archive and trash remove the building in the same transaction** as the status change (`ProjectService.withoutBuilding` → `withTransaction` → `PlacementRepository.removeByProject`). A refused change keeps the building; restore leaves the project unplaced.
- The rules check and the write run in one synchronous call on the single writer connection, with `occupied` read from the database in that call. `placement.list` is not paged; it is bounded by `MAX_PLACEMENTS_PER_WORLD` (project cap + service kinds).

## Consequences
- M2-4 can add `slot_occupied` with its occupant using the same `CommandErrorDetails` pattern.
- M2-6/M2-7 call `placement.list` once per world and draw `footprint` as returned; they must handle `projectStatus: 'archived'` (different look, unarchive on click).
- When an appearance picker arrives, add an optional `appearanceId` to `placement.create` (and probably a `placement.setAppearance`), validated against `building` manifest entries.
- Service structures can be listed, moved and removed, but not created yet; a later issue adds that.
- Signals to revisit: worlds with more buildings than one list reply should carry; a need to place trashed projects; reserved areas getting a real definition (the rules already support them; the service passes `[]`).

## Learning note
The renderer's preview and the main process run the same rules, but only the main process decides, and it only trusts what it can look up itself: tiles and rotation are user input, the footprint is not. Moving a "derived" value (the footprint) out of the payload is a simple way to remove a whole class of forged requests.
