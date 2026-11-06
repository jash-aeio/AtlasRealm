# Interface, Interaction & World Rendering Spec

> **Source:** Atlas Realm Build Plan rev 1.1, §6, §17 — copied verbatim from [the archived original](../archive/Atlas_Realm_Build_Plan_v1.1.md). Section numbers are kept so cross-references like "see section 33" still work. Edit this file (not the archive) when the spec changes, and record why in an ADR.

## 6. Interface and interaction specification

### 6.1 Main screen

The Realm Atlas occupies the upper-right corner; the inspector and approvals sit beneath it. At narrow widths these become collapsible drawers, preserving the editor and essential controls.

```text
+-----------------------------------------------------------------------+
| World selector | Search / commands       | Runner | Connections | User |
+-------------+-----------------------------------------+---------------+
| Projects    |                                         | REALM ATLAS   |
| Agents Guild|       Fantasy isometric world           |Map/Connections|
| Skill Lib.  |                                         | Expand / Hide |
| Tool Shops  |       [Project]    [Project]             |---------------|
| Automations |                                         | Inspector     |
| Activity    |          [Optional Guild]               |               |
| Settings    |                                         |               |
+-------------+-----------------------------------------+---------------+
| Library [E] | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 0 | Stop work     |
+-----------------------------------------------------------------------+
```

Use normal HTML controls for panels, forms, lists, tooltips, menus, and approvals. Use the rendering canvas for terrain, sprites, building previews, selection, and decorative movement.

### 6.2 Keyboard and pointer rules

| Input | Behavior |
|---|---|
| Click building | Select and show project summary |
| Open button or double-click building | Open project workspace |
| Drag with placement tool | Move building with collision preview |
| Mouse wheel / zoom controls | Zoom within defined bounds |
| Middle-drag or explicit pan mode | Pan camera |
| `E` | Toggle library when focus is not in an editable control |
| `1`–`9`, `0` | Activate hotbar shortcut when focus permits |
| Escape | Exit current placement/menu, never discard saved project data |
| Search shortcut | Open searchable commands and resources |
| Visible Stop control | Open active runs and stop selected/all work |

Do not use global keyboard hooks for ordinary world controls. Application shortcuts must not capture keys in other applications. Avatar movement is optional polish and must not be the only navigation method.

### 6.3 Library tabs

Projects, Agents, Skills, Tools, Workflows, and Building Appearances. Provide text search and filters for installed, missing requirements, archived, and offline-ready items. Keep resource management usable without the world canvas.

### 6.4 Project workspace

Consistent tabs: Overview, Team, Tasks, Files, Automations, Activity, Connections, Settings. Opening a building enters its functional 2.5D cutaway interior; a visible Interior/Blueprint control changes presentation. The upper-right Realm Atlas follows the selected project or file. Conventional editors and previews remain primary for actual content editing. Interior stations open these same tabs and commands; themes must not change their meaning. See sections 30–31 for the graph and interior specifications.

### 6.5 State visibility

Use text and icons together: Ready, Queued, Working, Needs approval, Waiting for connection, Paused, Interrupted, Failed, Completed, Cancelled. Do not rely on color alone.

Use stage-based progress such as "Draft complete; checking requirements" or "2 of 4 steps complete." Do not invent accurate-looking completion percentages or ETAs for unknown model work.

### 6.6 Accessibility and comfort

- Every essential canvas operation has a list or form equivalent.
- Keyboard focus is visible and restored after dialogs.
- Normal readable fonts for content; pixel fonts only for optional short decorative labels.
- Reduced motion mode, animation pause, UI scaling, zoom controls, and sound off by default.
- Screen-reader-friendly project/task lists with relevant status updates, not a stream of every animation event.
- Building labels can be toggled and remain readable at practical zoom levels.
- No mandatory walking, waiting for animations, or game tutorials to access work.
- Provide a keyboard-accessible relationship list and filters as alternatives to the graph canvas.
- Realm Atlas can be collapsed, resized, expanded, and pinned to a context; reduced motion disables force-layout animation.
- Use plain labels alongside fantasy names, such as Quest Board · Tasks and Enchanted Clock · Automations.

## 17. Isometric world rendering

### 17.1 Initial map model

Recommended starting map: 64 × 64 logical tiles, adjustable later. Store grid position and rotation, not screen pixels. Use one logical elevation initially and integer building footprints.

For tile width `W`, height `H`, and grid coordinates `(gx, gy)`:

```text
screenX = (gx - gy) * W / 2
screenY = (gx + gy) * H / 2

gx = screenX / W + screenY / H
gy = screenY / H - screenX / W
```

Convert the pointer into world-local coordinates by reversing camera pan/zoom before applying inverse projection. Test tile selection at edges, negative camera positions, and different zoom levels.

### 17.2 Placement and depth

- Validate bounds, reserved areas, building footprint, and rotation before commit.
- Revalidate placement in the command handler, not only in the preview.
- Use a stable depth-sorting convention based on the footprint's ground contact and explicit layers.
- Buildings cannot overlap occupied tiles; decorative sprites have separate collision rules.
- Undo/redo placement operations without undoing unrelated file or workflow operations.
- An invalid drop preserves the last valid location.
- An optional auto-place action finds a valid nearby plot for non-gamers.

### 17.3 Visual state and assets

Building appearances are cosmetic assets with versioned IDs. Start with idle, selected, working indicator, blocked indicator, and completion indicator. Characters need idle, working, waiting, and moving only if movement is implemented.

Use placeholder geometric sprites during engineering. Replace with reviewed original or licensed fantasy pixel assets before public release. PixelLab MCP is the user-selected production route; section 34 specifies the art bible, generation/review/export pipeline, offline packaging, service-cost caveat, and fallback sources. Do not copy Minecraft artwork, branding, or proprietary assets.

The approved interior is a 2.5D cutaway with Blueprint mode, built on this renderer. Fully rotatable 3D is deferred. Exterior tile coordinates, interior coordinates, and graph-layout coordinates are separate display spaces with shared entity references; moving one never silently changes another.

Animate from committed status or explicitly cosmetic loops. When three logical agents execute sequentially, show the waiting agents as waiting, not all as actively computing.

### 17.4 Performance targets

These are initial acceptance targets to measure on a documented reference computer, not guarantees for every device:

- World remains interactive with 100 visible project buildings and 20 visible agents.
- Aim for smooth 60 FPS on the reference machine; reduced-motion/low-power mode may target 30 FPS.
- Loading cached project data should not wait on network calls.
- Opening a normal project panel should feel immediate; measure a target of under 300 ms after local data is ready.
- Cull offscreen sprites and reduce animation when minimized.
- Do not make users run a GPU-intensive visual scene to keep automations alive.

Benchmark UI performance separately from local model throughput; local inference can saturate CPU/GPU resources.
