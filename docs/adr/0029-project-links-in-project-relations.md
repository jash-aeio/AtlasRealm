# ADR-0029: Project links live in a dedicated `project_relations` table, directed and kept while a project is trashed

- **Status:** Accepted
- **Date:** 2026-11-23
- **Milestone(s) affected:** M2 (M2-11 #76, M2-13 #78), later graph work (M3+ files, notes, parsed links)
- **Decided by:** jash-aeio (asked via AskUserQuestion on 2026-11-23, during #76, after an `architect` review)

## Context
M2-11 adds user-created, typed links between projects ("Project Relationships" preset, GRAPH_MODEL §30.3) and the bounded query that feeds the Atlas Connections tab (§30.6). §30.4 says to store the edge type, source and target, direction, origin, evidence, confirmation state and timestamps, and says a descriptive `depends_on` link never enforces scheduling, moves information or grants permission. §30.5 says deleting a manual edge removes the relation only, and that counts and titles must be filtered by access policy. DATA_MODEL §9.3 lists both a `project_relations` table and a general `graph_edges` table over `graph_entities` (ADR-0018). The issue was marked `needs-decision` on which one to use. Two smaller questions came up in the review: what "direction" means for the three link types, and what happens to links when a project goes to the trash.

## Options considered
**Where links are stored**

| Option | Pros | Cons |
|---|---|---|
| **Dedicated `project_relations`** (spec default) | Two composite foreign keys `(source_project_id, world_id)` and `(target_project_id, world_id)` → `projects (id, world_id)` make a cross-world link impossible in the database, the same pattern as migrations 3 and 5. A leaf table (nothing references it), so widening its CHECKs later is a cheap rebuild | File, note and task links will need the separate `graph_edges` table later (the spec plans both anyway) |
| General `graph_edges` over `graph_entities` | One edge table for every future link kind | Needs a new unique index on `graph_entities` plus a kind column to say "both ends are projects in this world". Every `graph_entities` rebuild (ADR-0018: adding a kind needs one) would also rebuild the edge table. Designs origin/evidence/index-revision columns before any code uses them. A spec deviation |

**Direction**

| Option | Pros | Cons |
|---|---|---|
| **The source → target order is the direction; all three types are directed** | Matches the spec's own `Budget Notes ──references──> Venue Quote`. Nothing can disagree with itself | No undirected links |
| A separate `direction` column | Could make `references` undirected | A–B and B–A would have to count as duplicates for undirected rows, and a constant column could contradict the order |

**Links of a trashed project**

| Option | Pros | Cons |
|---|---|---|
| **Kept but hidden** | Restoring the project from the trash brings its links back. Nothing about trashed projects leaks through the graph's counts | Hidden rows exist that the graph doesn't show |
| Shown greyed out | Users see everything | Trash leaks into the main graph |
| Deleted on trash | Simplest query | Restore loses data |

## Decision
We chose **a dedicated `project_relations` table**, **direction = source → target order**, and **links of trashed projects kept but hidden**.

- Migration 6 creates `project_relations`: `id` (UUID), `world_id`, `source_project_id`, `target_project_id`, `relation_type` (`depends_on`, `supports`, `references`), `origin` (only `user` for now), `confirmation_state` (`proposed`, `confirmed`, `rejected`; a `user` link is always `confirmed`), `created_at`, `updated_at`, `revision`. Both project references are composite foreign keys to the same world's project, `ON DELETE RESTRICT`. A CHECK refuses self-links. A unique index on `(source_project_id, target_project_id, relation_type)` refuses duplicates. There are no layout columns (layout goes in `graph_view_states` later, §30.7).
- A → B and B → A are different links, and so is the same pair with a different type. Cycles are allowed, because links are descriptive only. The issue's "direction" criterion is met by the source/target order; there is no `direction` column.
- `relation.create` refuses a trashed endpoint and allows an archived one (as hotbar and placement do). `relation.remove` takes the relation ID and the revision the caller saw, deletes only that row, and returns it (for undo). An unknown ID is `not_found`.
- `graph.worldConnections` reads `projects`, not placements, so unplaced projects are included (§30.1). It leaves trashed projects and every link touching one out of the nodes, edges **and** the totals. Archived projects are included with their status so the UI can style them.
- Bounds (§30.6): at most 150 nodes and 300 edges. Nodes are ordered active before archived, then by number of links (most first), then `created_at`, then `id`; the first 150 are kept. Edges are kept only when both ends were kept, ordered by `created_at`, then `id`; the first 300 are kept. The reply carries `totalNodes`, `totalEdges`, `omittedNodes` and `omittedEdges` (an edge dropped because an end was cut counts as omitted). Names are never used for ordering, because a rename would make the cut jump around.
- Profile isolation comes from one database file per profile (ADR-0014): another profile's IDs are simply `not_found`.

## Consequences
- **`depends_on` is descriptive only.** Nothing in scheduling, permissions, the workflow engine or file access may read `project_relations` (§30.4). Executable dependencies stay in the validated workflow definition. A reviewer should refuse any change that does.
- Adding the `parsed`, `execution` and `ai_proposed` origins, or evidence columns, means rebuilding this table in a later migration. That is cheap because nothing references it.
- File, note, task and artifact links will use `graph_edges` over `graph_entities` when indexing arrives (M3+). The Connections query then joins both sources.
- Trashing and restoring a project needs no change to links. Permanent deletion from the trash (later) must delete the project's links first, or the RESTRICT foreign keys will refuse it, which is the intended guard.
- The 150/300 limits are engineering limits, not stored limits. The M2-13 UI must show the omitted counts and must refetch after a committed change: React Flow's state is never the authoritative copy.
- Revisit if links ever need to connect a project to a non-project entity (then they move to `graph_edges`), or if users ask for undirected links.

## Learning note
A database can only guarantee what its constraints can express. Putting both ends of a link next to the world ID and pointing a two-column foreign key at `projects (id, world_id)` makes "a link stays inside one world" a database rule instead of a promise in code. And keeping a link's direction in a single place (the source/target order) means it can never contradict itself.
