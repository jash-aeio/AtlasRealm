// The Connections tab's pure parts (M2-13 #78, GRAPH_MODEL §30.3–30.6, ADR-0032): where each
// project node goes, how projects and links become React Flow nodes and edges, and the words
// the legend and the list use for each link type.
//
// The layout is a deterministic ring, not a force simulation: the same projects always land in
// the same spots, so nothing moves while the user reads (§30.6). Projects with a building sit on
// the outer ring and unplaced projects on an inner one, so "has no building" reads at a glance
// as well as in the label. Positions are cosmetic display coordinates: they never touch
// placements, files or permissions (§30.5, UI_SPEC §6.4).
import type { GraphProjectNode } from '../../common/contracts/graph';
import type {
  RelationOrigin,
  RelationSummary,
  RelationType,
} from '../../common/contracts/relation';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** How each link type reads in the graph, the legend, the list and the form. */
export const RELATION_LABELS: Record<RelationType, string> = {
  depends_on: 'depends on',
  supports: 'supports',
  references: 'references',
};

/** The line style of each type, so types differ by shape and not only by colour (§30.6). */
export const RELATION_LINE_STYLES: Record<RelationType, string> = {
  depends_on: 'solid line',
  supports: 'dashed line',
  references: 'dotted line',
};

export const ORIGIN_LABELS: Record<RelationOrigin, string> = {
  user: 'made by you',
};

/** Spacing between neighbouring nodes on a ring, in graph units (a node is ~150 wide). */
const RING_SPACING = 190;
const MIN_OUTER_RADIUS = 220;
/** The inner ring's radius as a share of the outer ring's. */
const INNER_SHARE = 0.45;

/** Points evenly spaced on a circle around (0, 0), starting at the top, clockwise. */
function ring(count: number, radius: number): Point[] {
  if (count === 1 && radius === 0) return [{ x: 0, y: 0 }];
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
    return { x: Math.round(radius * Math.cos(angle)), y: Math.round(radius * Math.sin(angle)) };
  });
}

/** The radius that gives `count` nodes about RING_SPACING of room each. */
const radiusFor = (count: number, min: number) =>
  Math.max(min, Math.ceil((count * RING_SPACING) / (2 * Math.PI)));

/**
 * A position for every node, keyed by project ID, in the order the server sent them (which is
 * stable and never decided by names). A lone node sits in the centre.
 */
export function ringLayout(nodes: readonly GraphProjectNode[]): Map<string, Point> {
  const placed = nodes.filter((n) => n.placed);
  const unplaced = nodes.filter((n) => !n.placed);
  const positions = new Map<string, Point>();
  if (nodes.length === 1) {
    const only = nodes[0];
    if (only !== undefined) positions.set(only.projectId, { x: 0, y: 0 });
    return positions;
  }
  // With only one group there is one ring; with both, the inner ring must also leave room.
  const outerGroup = placed.length > 0 ? placed : unplaced;
  const innerGroup = placed.length > 0 ? unplaced : [];
  const innerRadius = innerGroup.length === 0 ? 0 : radiusFor(innerGroup.length, 0);
  const outerRadius = Math.max(
    radiusFor(outerGroup.length, MIN_OUTER_RADIUS),
    Math.ceil(innerRadius / INNER_SHARE),
  );
  const inner = innerGroup.length === 1 ? 0 : Math.max(innerRadius, outerRadius * INNER_SHARE);
  ring(outerGroup.length, outerRadius).forEach((point, i) => {
    const node = outerGroup[i];
    if (node !== undefined) positions.set(node.projectId, point);
  });
  ring(innerGroup.length, inner).forEach((point, i) => {
    const node = innerGroup[i];
    if (node !== undefined) positions.set(node.projectId, point);
  });
  return positions;
}

/** The text on a node: the name, plus what the node's shape also shows. */
export function nodeLabel(node: GraphProjectNode): string {
  const notes = [
    node.status === 'archived' ? 'archived' : null,
    node.placed ? null : 'no building',
  ].filter((note) => note !== null);
  return notes.length === 0 ? node.name : `${node.name} (${notes.join(', ')})`;
}

/** What a screen reader hears for a node. */
export function nodeDescription(node: GraphProjectNode): string {
  const links = `${String(node.linkCount)} ${node.linkCount === 1 ? 'link' : 'links'}`;
  return `${nodeLabel(node)}, ${links}`;
}

/** CSS classes for a node: its shape shows status and placement (see app.css). */
export function nodeClassName(node: GraphProjectNode): string {
  return [
    'atlas-node',
    node.status === 'archived' ? 'atlas-node-archived' : null,
    node.placed ? null : 'atlas-node-unplaced',
  ]
    .filter((c) => c !== null)
    .join(' ');
}

export const edgeClassName = (type: RelationType) => `atlas-edge atlas-edge-${type}`;

/** Edge labels on hundreds of edges are unreadable and costly; the list always has them. */
export const EDGE_LABEL_LIMIT = 60;

/** Only links whose both ends are drawn (the server already guarantees this; checked anyway). */
export function drawableEdges(
  nodes: readonly GraphProjectNode[],
  edges: readonly RelationSummary[],
): RelationSummary[] {
  const ids = new Set(nodes.map((n) => n.projectId));
  return edges.filter((e) => ids.has(e.sourceProjectId) && ids.has(e.targetProjectId));
}
