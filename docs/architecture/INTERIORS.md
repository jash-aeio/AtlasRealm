# Enterable Interiors & Blueprint Mode

> **Source:** Atlas Realm Build Plan rev 1.1, §31 — copied verbatim from [the archived original](../archive/Atlas_Realm_Build_Plan_v1.1.md). Section numbers are kept so cross-references like "see section 33" still work. Edit this file (not the archive) when the spec changes, and record why in an ADR.

## 31. Enterable interiors and Blueprint mode

### 31.1 Approved visual approach

Use an isometric **2.5D cutaway interior**: layered pixel sprites create dimension, with front walls lowered or hidden for visibility. Keep a fixed readable projection initially. **Blueprint mode** replaces decorative detail with simplified room/station outlines, labels, selection highlights, and relevant functional connections.

The building preview used for placement is a **building blueprint**. Interior **Blueprint mode** is a different view; label them clearly. Fully rotatable real-time 3D is deferred and is not required by the approved design.

### 31.2 Entering and leaving

- Open/Enter on a selected building, double-click, or a project list action enters its workspace.
- An optional avatar can approach the door, but transition animations are skippable and never delay access.
- Show a breadcrumb such as World → Project → Current Item and a visible Return to World button.
- Keep project identity, current run, and unsaved editor state independent of scene transitions.
- Returning to the world does not cancel a run or discard edits. Prompt appropriately only if an actual unsaved edit would otherwise be lost.
- The context-sensitive Atlas follows the project and selection unless pinned.

### 31.3 Functional stations

| Fantasy station | Plain label | Opens or selects |
|---|---|---|
| Quest Board | Tasks | Task list, milestones, and blockers |
| War/Planning Table | Project Plan | Goal, requirements, decisions, workflow overview |
| Library Shelves | Notes & References | Approved sources, notes, evidence |
| Artisan Workbench | Agent Work | Assigned agent and actual active/queued tasks |
| Artifact Cabinet | Deliverables | Files, revisions, review/acceptance |
| Enchanted Clock | Automations | Schedules, next run, history, pause |

One reusable starter room with stations is sufficient. Do not generate one room for every file or reserve physical floor space for every task. Larger projects can group items into conceptual rooms or departments after the base experience is evaluated.

Station positions and room themes are cosmetic. Agent skills, file paths, permissions, and workflow execution do not depend on furniture placement. Stations without available capabilities show a clear disabled/setup state rather than pretending to function.

### 31.4 Editing and selection

Use conventional editors and safe previews beside the interior. MVP editing covers supported text/Markdown; CSV may use a simple validated table or text editor. Office documents, design files, and unsupported formats open through explicit external-app actions or dedicated adapters.

Selecting a station filters relevant project entities. Selecting a file highlights its graph node and opens its editor; its associated room/station can highlight without moving the original file. Support a split view with the editor central, interior minimized, and Atlas still available.

For linked external projects, opening is read-only until an explicit narrow edit grant exists. Before overwriting an external file, compare its current revision/digest and preserve a recoverable version or show a conflict. Do not treat an imported file as app-owned.

### 31.5 Blueprint behavior

Interior/Blueprint toggling preserves selected entity and editor position. Blueprint connections are a projection of the shared graph/workflow records, not an independently maintained set of truths. Offer selectable layers such as Stations, Work, and Knowledge to avoid displaying every relationship simultaneously.

Dragging a station updates interior layout only. Drawing a decorative connector never creates a tool grant or executable workflow dependency. If users choose a real Add Relationship action, validate and store a typed relation through the graph service.

### 31.6 Acceptance

A user can enter, open a source, edit an authorized note, inspect its connections, switch Blueprint mode, return to the world, and reopen the project with state intact. All these actions are available without walking an avatar. Active agent states agree across scene, task list, and Atlas. No scene transition starts a job without an explicit Run/automation trigger.
