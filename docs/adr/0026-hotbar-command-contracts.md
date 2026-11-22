# ADR-0026: Hotbar command contracts: expected-target guard and `slot_occupied`

- **Status:** Accepted
- **Date:** 2026-11-22
- **Milestone(s) affected:** M2
- **Decided by:** the developer (asked via AskUserQuestion on 2026-11-22)

## Context
M2-4 (#69) adds the IPC commands for the ten-slot hotbar (UI_SPEC §6.1–6.2). PRODUCT_RULES §3.1 and §22.2 #2 forbid **silent replacement**: filling a slot that already holds a shortcut must always be an explicit choice, and creating an eleventh project must never push a pin out. ADR-0023 stores each slot's target as typed columns and allows each target once per world. ADR-0025 introduced `CommandErrorDetails` so a refusal can carry structured detail. Three questions were open:
1. How do `replace` and `clear` make sure the caller isn't acting on an out-of-date view?
2. Can a trashed project be pinned?
3. What does `replace` do when the slot turns out to be empty?

## Options considered
| Question | Option | Pros | Cons |
|---|---|---|---|
| Stale-view guard | **Expected target ID** (chosen) | Says what the user means ("unpin *this*"). A cleared and refilled slot can't fool it | Not the `expectedRevision` pattern the other commands use |
| | Expected revision | Familiar pattern | A slot row is deleted when cleared, so a refilled slot restarts at revision 1, and an old revision can match a different pin |
| | Both | Strictest | More for the UI to track, with no added safety |
| Trashed project | **Refuse new pins** (chosen) | Matches placement (ADR-0025). No shortcuts into the trash | One more rule |
| | Allow | Simpler | Lets users create shortcuts to trashed work |
| Empty slot with `replace` | **Fill it** (chosen) | Nothing can be lost, so no extra round-trip | The caller's view was slightly stale |
| | Refuse (`not_found`) | Strict | Asks the user again for no safety gain |

## Decision
- Commands: `hotbar.list`, `hotbar.assign`, `hotbar.clear`. Slots are numbered 0–9 (slot 0 is key `1`, slot 9 is key `0`). A target is `{ type: 'project', id }` (a project of this world) or `{ type: 'service', id }` (one of `SERVICE_KINDS`). Anything else fails the Zod schema.
- `assign` without `replace` only fills an empty slot. `assign` with `replace: { expectedTargetId }` changes a filled slot only if the slot still holds that target. Otherwise the new code **`slot_occupied`** is returned, carrying `hotbar: { slot, occupant: { target, projectStatus } }`, and nothing is written. The router copies this field by field.
- `clear` takes `expectedTargetId` too. A mismatch is `slot_occupied`, and an empty slot is `not_found`. Clearing never touches the target.
- Assigning the target a slot already holds returns the slot unchanged. A target pinned to another slot is `already_exists`.
- Archived projects may be pinned. Trashed projects can't be newly pinned (`invalid_transition`). Existing pins stay when a project is archived or trashed, and `list` reports `projectStatus`.
- An archived world refuses `assign` and `clear` (`invalid_transition`). `list` still works (F5).

## Consequences
- The hotbar UI can show the occupant and ask "Replace X?" using the details from the refusal, then retry with `replace`.
- "Move a pin to another slot" is not a single command yet: a pinned target is `already_exists` elsewhere. The hotbar UI issue either clears and re-assigns (two steps, undoable) or adds a `hotbar.move` command.
- ARCHITECTURE §16.1's example name `hotbar.pin` becomes `hotbar.assign` / `hotbar.clear` / `hotbar.list`.
- Revisit if hotbar targets grow beyond projects and services (ADR-0023). An ID alone may then no longer say which target it is, and the guard would need the full `{ type, id }`.

## Learning note
An "optimistic concurrency" check (refusing a change when the data moved since you read it) is only as good as the version marker it compares. A revision counter that restarts when a row is deleted and re-created can repeat, so here the thing the user actually saw, the pinned target, is the safer marker.
