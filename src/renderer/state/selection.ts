// Shared selection for the Realm Atlas spike (M0-5, #8; ADR-0003).
//
// Both views read and write the same entity ID through these stores, and neither keeps its
// own copy of "what's selected". Selection is UI state: it isn't persisted, and selecting
// something never starts work or changes data (PRODUCT_RULES §3.1).

import { SMALL_SPIKE_GRAPH, type SpikeEntity, type SpikeGraph } from './spike-graph';
import { createStore, type Store } from './store';

/** Which view made the selection. Shown in the UI so the spike can prove the round trip. */
export type SelectionSource = 'atlas' | 'world';

export type Selection =
  { readonly entityId: null } | { readonly entityId: string; readonly source: SelectionSource };

const NOTHING_SELECTED: Selection = { entityId: null };

function sameSelection(a: Selection, b: Selection): boolean {
  if (a.entityId === null || b.entityId === null) return a.entityId === b.entityId;
  return a.entityId === b.entityId && a.source === b.source;
}

// Function properties (not methods) so they can be passed as event handlers, e.g.
// onClick={state.clear}, without losing `this` (they don't use it).
export interface SelectionState {
  /** The mock dataset both views draw. */
  readonly graph: Store<SpikeGraph>;
  readonly selection: Store<Selection>;
  /** Selects an entity of the current graph. Unknown IDs are refused (returns false). */
  readonly select: (entityId: string, source: SelectionSource) => boolean;
  readonly clear: () => void;
  /** Swaps the dataset. A selection that doesn't exist in the new graph is cleared. */
  readonly showGraph: (graph: SpikeGraph) => void;
  /** The selected entity, or null. */
  readonly selectedEntity: () => SpikeEntity | null;
}

export function createSelectionState(initialGraph: SpikeGraph = SMALL_SPIKE_GRAPH): SelectionState {
  const graph = createStore(initialGraph);
  const selection = createStore(NOTHING_SELECTED, sameSelection);
  const find = (entityId: string) =>
    graph.get().entities.find((candidate) => candidate.id === entityId) ?? null;

  return {
    graph,
    selection,
    select(entityId, source) {
      if (find(entityId) === null) return false;
      selection.set({ entityId, source });
      return true;
    },
    clear() {
      selection.set(NOTHING_SELECTED);
    },
    showGraph(next) {
      graph.set(next);
      const current = selection.get().entityId;
      if (current !== null && find(current) === null) selection.set(NOTHING_SELECTED);
    },
    selectedEntity() {
      const current = selection.get().entityId;
      return current === null ? null : find(current);
    },
  };
}

/** The one instance the app uses. Tests create their own with createSelectionState(). */
export const spikeSelection = createSelectionState();
