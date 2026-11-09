import { useMemo } from 'react';

import { spikeSelection, type SelectionState } from '../state/selection';
import { createStressGraph, SMALL_SPIKE_GRAPH } from '../state/spike-graph';
import { useStore } from '../state/use-store';
import { ConnectionsGraph } from './ConnectionsGraph';

const SOURCE_LABELS = { atlas: 'Connections', world: 'world view' } as const;

/**
 * Realm Atlas placeholder (M0-5 spike, GRAPH_MODEL §30.1): the upper-right panel. Only the
 * Connections tab exists, and it shows MOCK data. Map, resize, pin and real relations come
 * later. Selection lives in the shared store, so the world view sees the same entity.
 */
export function RealmAtlasPanel({ state = spikeSelection }: { state?: SelectionState }) {
  const graph = useStore(state.graph);
  const selection = useStore(state.selection);
  const selectedId = selection.entityId;
  const labels = useMemo(
    () => new Map(graph.entities.map((entity) => [entity.id, entity.label])),
    [graph],
  );
  const isStress = graph !== SMALL_SPIKE_GRAPH;

  return (
    <aside className="atlas" aria-labelledby="atlas-heading" data-testid="atlas">
      <div className="atlas-header">
        <h2 id="atlas-heading">Realm Atlas</h2>
        <span className="tag">M0 spike · mock data</span>
      </div>

      <div role="tablist" aria-label="Realm Atlas views" className="atlas-tabs">
        <button
          type="button"
          role="tab"
          aria-selected="false"
          disabled
          title="Comes in a later milestone"
        >
          Map (later)
        </button>
        <button type="button" role="tab" aria-selected="true" id="atlas-tab-connections">
          Connections
        </button>
      </div>

      <div role="tabpanel" aria-labelledby="atlas-tab-connections">
        <p className="muted atlas-meta" data-testid="atlas-dataset">
          {graph.name}: {graph.entities.length} entities, {graph.links.length} links
        </p>
        <ConnectionsGraph graph={graph} selectedId={selectedId} state={state} />

        <output className="atlas-selection" data-testid="atlas-selection">
          {selection.entityId === null
            ? 'Nothing selected. Click a node, a list item or a marker in the world.'
            : `Selected: ${labels.get(selection.entityId) ?? selection.entityId} (${selection.entityId}) · chosen in ${SOURCE_LABELS[selection.source]}`}
        </output>

        <div className="atlas-actions">
          <button
            type="button"
            data-testid="atlas-stress-toggle"
            onClick={() => {
              state.showGraph(isStress ? SMALL_SPIKE_GRAPH : createStressGraph());
            }}
          >
            {isStress ? 'Back to small graph' : 'Load stress graph (150 / 300)'}
          </button>{' '}
          <button type="button" disabled={selectedId === null} onClick={state.clear}>
            Clear selection
          </button>
        </div>

        {/* Keyboard-usable list equivalent of the graph (GRAPH_MODEL §30.6). */}
        <details className="atlas-list">
          <summary>List view</summary>
          <h3>Entities</h3>
          <ul data-testid="atlas-entity-list">
            {graph.entities.map((entity) => (
              <li key={entity.id}>
                <button
                  type="button"
                  aria-pressed={entity.id === selectedId}
                  onClick={() => {
                    state.select(entity.id, 'atlas');
                  }}
                >
                  {entity.label}
                </button>
              </li>
            ))}
          </ul>
          <h3>Links</h3>
          <ul>
            {graph.links.map((link) => (
              <li key={link.id}>
                {labels.get(link.source)} → <em>{link.relation}</em> → {labels.get(link.target)}{' '}
                <span className="muted">(mock)</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </aside>
  );
}
