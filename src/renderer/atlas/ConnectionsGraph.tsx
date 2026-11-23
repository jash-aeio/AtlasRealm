// The Connections graph (M2-13 #78, GRAPH_MODEL §30.4–30.6, ADR-0032): the world's projects and
// their links, drawn by React Flow from the saved data the Connections tab read.
//
// Selection is controlled: the shared ProjectSelection decides which node is selected, and the
// graph only reports what the user clicked or pressed, so it can't disagree with the world or
// the Map. Selecting never starts work.
//
// Nodes can be dragged. Their positions are display coordinates kept by the tab for this session
// (ADR-0032): they never move a building, a file or a permission (§30.5). Links can't be drawn
// or deleted on the canvas; the form and the list do that, so every change goes through a
// command and a confirmation. With reduced motion the fit-to-view zoom jumps instead of gliding.
import '@xyflow/react/dist/style.css';

import {
  Controls,
  MarkerType,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChangeset,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { GraphProjectNode } from '../../common/contracts/graph';
import type { RelationSummary } from '../../common/contracts/relation';
import {
  drawableEdges,
  EDGE_LABEL_LIMIT,
  edgeClassName,
  nodeClassName,
  nodeDescription,
  nodeLabel,
  RELATION_LABELS,
  ringLayout,
  type Point,
} from './connections-layout';

/** A node's React Flow ID *is* the project ID, so selection maps one to one. */
type ProjectNode = Node<{ label: string }>;

/** How long the fit-to-view zoom glides, unless motion is reduced. */
export const FIT_VIEW_DURATION_MS = 300;

interface ConnectionsGraphProps {
  readonly nodes: readonly GraphProjectNode[];
  readonly edges: readonly RelationSummary[];
  readonly selectedProjectId: string | null;
  readonly onSelect: (projectId: string) => void;
  /** Positions the user dragged nodes to this session, by project ID. */
  readonly moved: ReadonlyMap<string, Point>;
  readonly onMove: (projectId: string, position: Point) => void;
  /** Bumped by "Reset layout": the view fits the ring again. */
  readonly layoutResets: number;
  readonly reducedMotion: boolean;
}

export function ConnectionsGraph({
  nodes,
  edges,
  selectedProjectId,
  onSelect,
  moved,
  onMove,
  layoutResets,
  reducedMotion,
}: ConnectionsGraphProps) {
  const ring = useMemo(() => ringLayout(nodes), [nodes]);
  const flowNodes = useMemo<ProjectNode[]>(
    () =>
      nodes.map((node) => ({
        id: node.projectId,
        position: moved.get(node.projectId) ?? ring.get(node.projectId) ?? { x: 0, y: 0 },
        data: { label: nodeLabel(node) },
        className: nodeClassName(node),
        ariaLabel: nodeDescription(node),
        selected: node.projectId === selectedProjectId,
      })),
    [nodes, ring, moved, selectedProjectId],
  );
  const flowEdges = useMemo<Edge[]>(() => {
    const drawn = drawableEdges(nodes, edges);
    const labelled = drawn.length <= EDGE_LABEL_LIMIT;
    return drawn.map((edge) => ({
      id: edge.id,
      source: edge.sourceProjectId,
      target: edge.targetProjectId,
      label: labelled ? RELATION_LABELS[edge.type] : undefined,
      className: edgeClassName(edge.type),
      // The arrowhead is at the target: source → target is the direction (ADR-0029).
      markerEnd: { type: MarkerType.ArrowClosed },
      focusable: false,
      selectable: false,
    }));
  }, [nodes, edges]);

  // Since v13 changes arrive as a NodeChangeset. Only "selected" and "moved" are used; React
  // Flow's own copy of the nodes is never kept, so the saved data stays the only source.
  const onNodesChange = useCallback(
    (changes: NodeChangeset<ProjectNode>) => {
      for (const change of changes.getByType('select')) {
        if (change.selected) onSelect(change.id);
      }
      for (const change of changes.getByType('position')) {
        if (change.position !== undefined) onMove(change.id, change.position);
      }
    },
    [onSelect, onMove],
  );

  const duration = reducedMotion ? 0 : FIT_VIEW_DURATION_MS;
  const fitViewOptions = useMemo(() => ({ duration, padding: 0.15 }), [duration]);

  return (
    <div
      className="atlas-graph"
      data-testid="atlas-connections-graph"
      data-layout-animation={reducedMotion ? 'off' : 'on'}
      data-nodes={String(flowNodes.length)}
      data-edges={String(flowEdges.length)}
    >
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        forceColorMode="dark"
        fitView
        fitViewOptions={fitViewOptions}
        minZoom={0.1}
        nodesDraggable
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
      >
        <Controls showInteractive={false} fitViewOptions={fitViewOptions} />
        <FitOnReset resets={layoutResets} duration={duration} />
      </ReactFlow>
    </div>
  );
}

/** Fits the view again after "Reset layout" (not on mount: `fitView` above does that). */
function FitOnReset({ resets, duration }: { readonly resets: number; readonly duration: number }) {
  const flow = useReactFlow();
  const seen = useRef(resets);
  useEffect(() => {
    if (seen.current === resets) return;
    seen.current = resets;
    // Wait a frame so the reset positions are measured before fitting.
    const frame = requestAnimationFrame(() => {
      void flow.fitView({ duration, padding: 0.15 });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [resets, duration, flow]);
  return null;
}
