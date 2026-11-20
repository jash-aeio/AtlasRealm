# 2026-11-21: M2-3 placement commands (#68)

**Branch:** `feat/68-placement-commands` · **Issue:** [#68](https://github.com/jash-aeio/AtlasRealm/issues/68)

## Task
Add IPC commands that list, place, move and remove a project's building. The command handler checks every placement again with the M2-1 rules, using placements it reads from the database itself. Whatever the preview said, the handler decides (UI_SPEC §17.2; §22.2 #3, #4, #5). Archiving or trashing a project removes its building in the same transaction.

## Plan
1. **Error shape:** add a new `placement_blocked` error code. It carries `placement: { reason, blockingIds }` (`ipc-result.ts`, `router.ts`, plus a router test).
2. **Building appearances in main:** a small catalog that reads the bundled asset manifest at build time. It gives the default building appearance and each building's footprint. A stored appearance that no longer resolves counts as 4×4, and a warning is logged.
3. **Placement commands:** `src/common/contracts/placement.ts`, `src/main/services/placement-service.ts` and `src/main/ipc/commands/placement.ts`, wired into `channels.ts`, `atlas-api.ts`, the preload and `register.ts`. Integration tests go through the real router against real profile databases.
4. **Archive/trash hook:** `ProjectService.archive` and `trash` run the status change and `PlacementRepository.removeByProject` in one `withTransaction`. Tests show a failed change leaves the building in place, and restore leaves the project unplaced.
5. **E2E:** place, list, move and remove through `window.atlas.placement` in the built app.
6. **Docs:** ADR-0025, the ARCHITECTURE §16.1 row, this log. Then `/ship` (status, roadmap, lesson 027).

## Decisions
- **User, via AskUserQuestion, recorded in [ADR-0025](../adr/0025-placement-command-contracts.md):**
  - A refused placement uses the new code `placement_blocked`, with a `reason` (`out_of_bounds` / `overlaps` / `reserved`) and the blocking building IDs.
  - `placement.create` takes no appearance. The main process uses the bundled default building and reads its footprint from the trusted manifest, so a forged footprint is impossible (#66 security L2).
  - A stored appearance that no longer resolves counts as **4×4**, the largest building size (ADR-0013), and a warning is logged once per appearance (#66 security L3).
  - **Archived projects may be placed.** Archiving still removes the building (decision of 2026-11-20). Afterwards the user may place the archived project again. The world view should draw it differently, and clicking it should offer "Unarchive". That visual and click behaviour is renderer work, handed to M2-6 #71. This task adds `projectStatus` to each `placement.list` entry so the renderer has it.
- **Routine, following the spec and the issue:**
  - Channel names follow the issue (`placement.list/create/move/remove`), not ARCHITECTURE's example name `building.place`. The ARCHITECTURE table is updated to match.
  - Rotation is validated as 0/90/180/270 in the Zod schema (#66 security L1). Tiles are whole numbers from 0 to 255 in the schema; whether they fit inside this world is the rules' `out_of_bounds` answer.
  - Trashed project → `invalid_transition`. A second building for the same project → `already_exists`. An unknown project, or another world's project → `not_found`.
  - An archived world refuses every placement change (`invalid_transition`). Listing still works (F5, #59).
  - `move` and `remove` take the placement ID and the placement's revision. A stale revision → `revision_conflict`.
  - `placement.list` is not paged. It is bounded by the world's project cap plus the service kinds, oldest first.
  - The check and the write run in the same synchronous call on the single writer connection, so nothing can slip in between (lesson 024).

## What was done
- Slice 1 (`85f1a35`): `placement_blocked` error code. `CommandError` carries optional details, and the router copies only the known fields across (router test).
- Slice 2 (`5170899`): `src/main/world/building-appearances.ts` reads the bundled manifest into the main bundle. Only `building` entries count. Lost art counts as 4×4 with one quoted warning (5 unit tests).
- Slice 3 (`6b06969`): placement contracts, service, commands, plus wiring in channels, the API, the preload and `register.ts`. `MAX_TILE` in the repository now comes from the contract (27 integration tests through the real router).
- Slice 4 (`9f11d16`): `ProjectService.archive/trash` run the status change and `removeByProject` in one `withTransaction` (5 more tests). A temporary trigger that makes the delete fail shows both writes roll back together. Negative control: with the transaction removed, that test fails.
- Slice 5 (`126660f`): E2E `tests/e2e/placement.spec.ts` in the built app. The preload-shape test now lists `placement`.
- Slice 6: ADR-0025, the ARCHITECTURE §16.1 row, the status Decisions entry.
- The user wrote no code this session (project rule: Claude writes all code). The user made the four decisions above.

## Open questions
- **Handoff to M2-6 #71:** draw a building whose `projectStatus` is `archived` differently, and offer "Unarchive" when it is clicked (user, 2026-11-21).
- Service structures can be listed, moved and removed, but not created yet. Which issue adds that?
