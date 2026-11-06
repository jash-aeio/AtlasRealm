# Realm Atlas & Relationship Graphs

> **Source:** Atlas Realm Build Plan rev 1.1, §30 — copied verbatim from [the archived original](../archive/Atlas_Realm_Build_Plan_v1.1.md). Section numbers are kept so cross-references like "see section 33" still work. Edit this file (not the archive) when the spec changes, and record why in an ADR.

## 30. Realm Atlas and relationship graphs

### 30.1 Purpose and placement

**Realm Atlas** is the context-sensitive panel anchored to the upper-right of the main workspace. It has two explicit tabs: **Map** and **Connections**. The first answers "Where is this?"; the second answers "How is this related?" A geographic minimap and a relationship network are not interchangeable.

Default panel size should be comfortable for orientation, with a visible Expand action for detailed inspection. Users can collapse, resize, or pin it to a chosen project. Persist these display preferences per profile/world. At narrow widths it becomes a drawer; it must not cover editing controls or approval decisions.

| Current context | Map tab | Connections tab |
|---|---|---|
| World/exterior | Project buildings, optional service structures, selected building, camera viewport | Projects with explicit cross-project links |
| Project interior | Simplified room/station arrangement and current selection | Authorized files, notes, tasks, agents, workflows, and artifacts in that project |
| File/note editor | Selected item's station/group if one exists | Focused neighborhood of the selected item, with bounded relationship depth |
| Task/run inspector | Relevant project/station | Inputs, assigned agent, producing steps, review, and outputs |

Clicking a node highlights its corresponding entity and offers Open, Inspect Connections, or an appropriate authorized action. Do not force a camera jump while a user is editing. A follow-selection toggle and a visible pinned-context indicator prevent disorientation. The default world Connections view includes unplaced projects so the map layout does not define existence.

### 30.2 Reference patterns

Obsidian's global graph and focused local graph are references for navigating links around an active note. Atlas Realm extends that pattern with typed project entities rather than copying Obsidian's implementation. [Obsidian Graph view](https://help.obsidian.md/plugins/graph).

Obsidian Canvas is a reference for intentional spatial planning with connected notes and files. Keep a distinction between a computed relationship view and a manually arranged planning board. [Obsidian Canvas](https://help.obsidian.md/plugins/canvas).

React Flow's minimap and grouped-node examples are relevant implementation references. Its graph minimap describes a diagram viewport; the world geographic minimap still derives from world placements. [React Flow MiniMap](https://reactflow.dev/api-reference/components/minimap), [grouped-node example](https://reactflow.dev/examples/grouping/sub-flows).

### 30.3 Focused view presets

| Preset | Nodes | Edges and user question |
|---|---|---|
| Project Relationships | Projects and explicitly shared deliverables | Depends on, supports, references; "Which projects relate to this one?" |
| Knowledge | Notes, documents, sources, decisions | Links to, cites, explains, supersedes; "What supports this idea?" |
| Work | Tasks, workflow steps, agents, artifacts | Requires, assigned to, produces, reviews; "Who is doing this and what does it produce?" |
| Files | Folders, files, supported code modules | Contains, references, imports, generated from; "Where does this item belong and what uses it?" |

The MVP builds edges from explicit user links, supported document links, existing task/workflow records, and actual execution receipts. Code import/dependency edges require language-specific parsers added later; do not claim complete software architecture from folder names. AI semantic suggestions are optional later and visibly proposed.

### 30.4 Relationship semantics

Store edge type, source and target IDs, direction, origin, evidence/source locator, parser or run revision, confirmation state, and timestamps. Initial origins: `user`, `parsed`, `execution`, and `ai_proposed`. Confidence can describe an inference; it is not a substitute for evidence or user approval.

Examples:

```text
Organization Event ──promoted_by──> Content Campaign
Budget Notes ──references──> Venue Quote
Budget Task ──assigned_to──> Coordinator
Budget Task ──produces──> Budget CSV revision 2
Reviewer ──reviews──> Budget CSV revision 2
```

Keep verbs consistent and display direction and a legend. A `contains` edge is structural; it does not mean two files discuss the same subject. A descriptive `depends_on` link between projects does not automatically enforce scheduling, transfer information, or grant permission. Executable dependencies remain in the separately validated workflow definition.

Show unconfirmed AI links with a dashed style and Proposed label. Accepting a suggestion records the decision and provenance. Rejecting it suppresses that same suggestion for the same source revision unless explicitly reconsidered. Do not show unrelated projects as connected just because they share a generic tag such as "work."

### 30.5 Indexing, identity, and source ownership

- Back the graph with existing SQLite entities and projections, not a second authoritative graph database.
- Keep stable IDs distinct from filenames, display names, and graph positions.
- Index only authorized roots, supported file types, and bounded content sizes.
- Parse explicit Markdown links and declared supported formats before attempting semantic inference.
- Update indexes incrementally using bounded file-watch queues, debounce, and explicit refresh. Show index freshness and errors.
- A rename/move detected with enough evidence can update a locator. Ambiguous external changes need reconciliation; do not invent identity matches.
- Missing targets appear as unresolved links when permitted. They must not trigger automatic file creation.
- Deleting a derived edge requires changing/ignoring its source through an explicit action; simply rearranging the graph cannot edit documents.
- Deleting a manual edge removes the relation only. Deleting a file is a different authorized command.
- Preserve manually confirmed relationships across reindexing; do not rebuild them from scratch as if they were a cache.
- Filter all graph metadata through access policy, including titles, counts, paths, search hits, and exports.

### 30.6 Clarity, layouts, and bounds

Default to a one-hop neighborhood when editing a file. Offer depth controls, search, type/origin filters, collapsed folder/task groups, focus-selected, and fit-to-view. Use stable layouts and preserve manual positions; avoid continuous movement while the user reads.

Initial implementation target: fetch at most 150 visible nodes and 300 visible edges per graph request, with explicit truncation/grouping and expansion controls. These are adjustable engineering limits, not limits on stored project size. Profile the selected renderer before increasing them. A large folder should never freeze the interface by rendering every file at once.

The graph has a keyboard-accessible list equivalent showing source, relation, target, and provenance. Icons/shapes and labels supplement color. Magical visual accents can show actual current work, but the graph must remain readable in reduced-motion mode.

### 30.7 Persistence and verification

Persist relation records and layout preferences separately. Persist significant index versions and reviewed links; pointer movement and layout animation remain ephemeral. Use committed application events to update the graph and scene without re-running work.

Acceptance: a project link survives restart; file selection focuses the correct authorized neighborhood; changing graph layout leaves paths/placements unchanged; an unauthorized project does not leak through counts; reindexing preserves manual edges; AI suggestions remain unconfirmed until reviewed; the graph works with Obsidian disabled.
