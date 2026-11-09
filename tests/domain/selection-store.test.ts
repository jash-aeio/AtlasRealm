import { describe, expect, it, vi } from 'vitest';

import { createSelectionState } from '../../src/renderer/state/selection';
import {
  createStressGraph,
  graphProblems,
  SMALL_SPIKE_GRAPH,
} from '../../src/renderer/state/spike-graph';
import { createStore } from '../../src/renderer/state/store';

describe('createStore', () => {
  it('returns the stored value and notifies subscribers on change', () => {
    const store = createStore(1);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(2);
    expect(store.get()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('skips notifications when the value is equal', () => {
    const store = createStore({ n: 1 }, (a, b) => a.n === b.n);
    const before = store.get();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ n: 1 });
    expect(listener).not.toHaveBeenCalled();
    // get() must keep returning the same object, or useSyncExternalStore loops forever.
    expect(store.get()).toBe(before);
  });

  it('stops notifying after unsubscribe, even from inside a notification', () => {
    const store = createStore(0);
    const second = vi.fn();
    const unsubscribeSecond = store.subscribe(second);
    const first = vi.fn(() => {
      unsubscribeSecond();
    });
    store.subscribe(first);
    store.set(1); // both were subscribed when this change started
    store.set(2);
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('shared selection', () => {
  it('both views see the same ID, whichever view selected it', () => {
    const state = createSelectionState();
    const worldView = vi.fn();
    const atlasView = vi.fn();
    state.selection.subscribe(worldView);
    state.selection.subscribe(atlasView);

    expect(state.select('mock-website', 'atlas')).toBe(true);
    expect(state.selection.get()).toEqual({ entityId: 'mock-website', source: 'atlas' });
    expect(state.selectedEntity()?.tile).toEqual({ gx: 28, gy: 34 });

    expect(state.select('mock-garden', 'world')).toBe(true);
    expect(state.selection.get()).toEqual({ entityId: 'mock-garden', source: 'world' });
    expect(worldView).toHaveBeenCalledTimes(2);
    expect(atlasView).toHaveBeenCalledTimes(2);
  });

  it('refuses IDs that are not in the current graph', () => {
    const state = createSelectionState();
    const listener = vi.fn();
    state.selection.subscribe(listener);
    expect(state.select('no-such-entity', 'atlas')).toBe(false);
    expect(state.selection.get()).toEqual({ entityId: null });
    expect(listener).not.toHaveBeenCalled();
  });

  it('re-selecting the same entity from the same view does not notify again', () => {
    const state = createSelectionState();
    state.select('mock-thesis', 'atlas');
    const listener = vi.fn();
    state.selection.subscribe(listener);
    state.select('mock-thesis', 'atlas');
    expect(listener).not.toHaveBeenCalled();
  });

  it('clear() empties the selection', () => {
    const state = createSelectionState();
    state.select('mock-thesis', 'world');
    state.clear();
    expect(state.selection.get()).toEqual({ entityId: null });
    expect(state.selectedEntity()).toBeNull();
  });

  it('showGraph() drops a selection the new graph does not contain', () => {
    const state = createSelectionState();
    state.select('mock-thesis', 'atlas');
    state.showGraph(createStressGraph());
    expect(state.selection.get()).toEqual({ entityId: null });
    expect(state.select('stress-42', 'atlas')).toBe(true);
    state.showGraph(createStressGraph());
    expect(state.selection.get().entityId).toBe('stress-42');
  });
});

describe('mock graphs', () => {
  it('the small graph is valid', () => {
    expect(graphProblems(SMALL_SPIKE_GRAPH)).toEqual([]);
  });

  it('the stress graph has the GRAPH_MODEL §30.6 size and is valid', () => {
    const graph = createStressGraph();
    expect(graph.entities).toHaveLength(150);
    expect(graph.links).toHaveLength(300);
    expect(graphProblems(graph)).toEqual([]);
  });

  it('the stress graph is deterministic and valid at its upper bound', () => {
    expect(createStressGraph()).toEqual(createStressGraph());
    expect(graphProblems(createStressGraph(300, 1200))).toEqual([]);
  });

  it('rejects stress sizes it cannot build', () => {
    expect(() => createStressGraph(1, 0)).toThrow(RangeError);
    expect(() => createStressGraph(301, 0)).toThrow(RangeError);
    expect(() => createStressGraph(10, 41)).toThrow(RangeError);
    expect(() => createStressGraph(10.5, 1)).toThrow(RangeError);
  });

  it('graphProblems() reports broken data', () => {
    const [first] = SMALL_SPIKE_GRAPH.entities;
    if (first === undefined) throw new Error('empty fixture');
    const problems = graphProblems({
      name: 'broken',
      entities: [first, first, { ...first, id: 'off', tile: { gx: 64, gy: 0 } }],
      links: [
        { id: 'a', source: first.id, target: 'missing', relation: 'x' },
        { id: 'b', source: first.id, target: first.id, relation: 'x' },
      ],
    });
    expect(problems).toEqual([
      `duplicate entity ${first.id}`,
      'two entities on tile 30,30',
      'entity off is off the map',
      'link a has an unknown end',
      'link b points to itself',
    ]);
  });
});
