// React Flow structural styles. Vite bundles this into our own stylesheet, so the strict CSP
// (`style-src 'self'`) still holds; React Flow injects no <style> tags at runtime.
import '@xyflow/react/dist/style.css';

import {
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { useCallback, useMemo } from 'react';

import type { SelectionState } from '../state/selection';
import type { SpikeGraph } from '../state/spike-graph';

/** A graph node is a view of one shared entity: its React Flow ID *is* the entity ID. */
type EntityNode = Node<{ label: string }>;

function toNodes(graph: SpikeGraph): EntityNode[] {
  return graph.entities.map((entity) => ({
    id: entity.id,
    position: entity.graphPosition,
    data: { label: entity.label },
  }));
}

function toEdges(graph: SpikeGraph): Edge[] {
  // Edge labels on a 300-edge graph are unreadable and costly; the list view has them.
  const labelled = graph.links.length <= 30;
  return graph.links.map((link) => ({
    id: link.id,
    source: link.source,
    target: link.target,
    label: labelled ? link.relation : undefined,
    markerEnd: { type: MarkerType.ArrowClosed },
    focusable: false,
  }));
}

interface ConnectionsGraphProps {
  readonly graph: SpikeGraph;
  readonly selectedId: string | null;
  readonly state: SelectionState;
}

/**
 * The Connections graph (M0 spike). Selection is *controlled*: the shared store decides
 * which node is selected, and React Flow only reports what the user clicked or pressed.
 * Nodes can't be dragged, connected or deleted here; layout is cosmetic (GRAPH_MODEL §30.5).
 */
export function ConnectionsGraph({ graph, selectedId, state }: ConnectionsGraphProps) {
  const baseNodes = useMemo(() => toNodes(graph), [graph]);
  const edges = useMemo(() => toEdges(graph), [graph]);
  // Only the selected node gets a new object; the others keep their identity, so React Flow
  // re-renders one or two nodes per selection change, not all 150.
  const nodes = useMemo(
    () => baseNodes.map((node) => (node.id === selectedId ? { ...node, selected: true } : node)),
    [baseNodes, selectedId],
  );

  // React Flow reports selection as "changes" (from a click or from Enter/Space on a focused
  // node). We forward only "this node was selected" to the store and drop everything else,
  // so the graph can never disagree with the world about what's selected.
  const onNodesChange = useCallback(
    (changes: NodeChange<EntityNode>[]) => {
      for (const change of changes) {
        if (change.type === 'select' && change.selected) state.select(change.id, 'atlas');
      }
    },
    [state],
  );

  const onPaneClick = useCallback(() => {
    state.clear();
  }, [state]);

  return (
    <div className="atlas-graph" data-testid="atlas-graph">
      <ReactFlow
        // A new dataset remounts the graph so fitView frames it again.
        key={graph.name}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onPaneClick={onPaneClick}
        colorMode="dark"
        fitView
        minZoom={0.1}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
      >
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
