// IPC contracts for the Realm Atlas graph queries (M2-11 #76, ADR-0029, GRAPH_MODEL §30.1, §30.6).
//
// `graph.worldConnections` feeds the Connections tab in the world context: the world's projects
// and the user-made links between them. It reads projects, not buildings, so unplaced projects
// are included (§30.1). Trashed projects and every link touching one are left out of the nodes,
// the edges *and* the totals, so the trash can't leak through counts (§30.5). The reply is
// bounded (§30.6) and says exactly how much was left out.
import { z } from 'zod';

import { DisplayName } from './display-name';
import { ProjectId } from './project';
import { RelationSummary } from './relation';
import { WorldId } from './world';

/** Engineering limits per request, not limits on stored data (§30.6). */
export const GRAPH_MAX_NODES = 150;
export const GRAPH_MAX_EDGES = 300;

export const GraphProjectNode = z.strictObject({
  projectId: ProjectId,
  name: DisplayName,
  /** Trashed projects are never returned. */
  status: z.enum(['active', 'archived']),
  /** Whether the project has a building. Unplaced projects are nodes too (§30.1). */
  placed: z.boolean(),
  /** Links among the world's visible projects that touch this one (before truncation). */
  linkCount: z.int().min(0),
});
export type GraphProjectNode = z.infer<typeof GraphProjectNode>;

const Count = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

export const GraphWorldConnectionsInput = z.strictObject({ worldId: WorldId });
export type GraphWorldConnectionsInput = z.infer<typeof GraphWorldConnectionsInput>;

/**
 * Nodes are ordered active before archived, then most links first, then oldest, then by ID;
 * the first 150 are kept. Edges are kept only when both ends were kept, oldest first (then by
 * ID); the first 300 are kept. Names never decide the cut, so a rename can't reshuffle it.
 * `omitted*` = `total*` − returned; an edge dropped because an end was cut counts as omitted.
 */
export const GraphWorldConnectionsOutput = z.strictObject({
  nodes: z.array(GraphProjectNode).max(GRAPH_MAX_NODES),
  edges: z.array(RelationSummary).max(GRAPH_MAX_EDGES),
  totalNodes: Count,
  totalEdges: Count,
  omittedNodes: Count,
  omittedEdges: Count,
});
export type GraphWorldConnectionsOutput = z.infer<typeof GraphWorldConnectionsOutput>;
