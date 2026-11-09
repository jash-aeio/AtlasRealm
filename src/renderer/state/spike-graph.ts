// M0 MOCK DATA for the selection-sharing spike (M0-5, #8). These aren't real projects, and
// nothing here is stored. Real entities and relations come from the main process later
// (DATA_MODEL, GRAPH_MODEL §30). The UI labels everything built from this as mock data.
//
// One entity = one shared ID, used by both views:
// - the world view draws it on `tile` (a grid position, never pixels);
// - the Connections graph draws it at `graphPosition`, which is cosmetic layout only
//   (PRODUCT_RULES: a graph layout never moves files or grants anything).

import { DEFAULT_MAP, type GridPoint, type MapSize, type Point } from '../world/projection';

export interface SpikeEntity {
  readonly id: string;
  readonly label: string;
  readonly tile: GridPoint;
  readonly graphPosition: Point;
}

export interface SpikeLink {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly relation: string;
}

export interface SpikeGraph {
  /** Shown in the UI so it's clear which mock dataset is on screen. */
  readonly name: string;
  readonly entities: readonly SpikeEntity[];
  readonly links: readonly SpikeLink[];
}

function entity(id: string, label: string, gx: number, gy: number, x: number, y: number) {
  return { id, label, tile: { gx, gy }, graphPosition: { x, y } } satisfies SpikeEntity;
}

function link(source: string, target: string, relation = 'links to'): SpikeLink {
  return { id: `${source}->${target}`, source, target, relation };
}

/** Eight mock projects placed near the map centre, so they're visible in the default view. */
export const SMALL_SPIKE_GRAPH: SpikeGraph = {
  name: 'Small mock graph',
  entities: [
    entity('mock-thesis', 'Thesis notes', 30, 30, 0, 0),
    entity('mock-reading', 'Reading list', 34, 29, 0, 110),
    entity('mock-website', 'Website', 28, 34, 220, 0),
    entity('mock-photos', 'Photo archive', 33, 34, 220, 110),
    entity('mock-garden', 'Garden planner', 36, 32, 220, 220),
    entity('mock-recipes', 'Recipe book', 31, 37, 440, 0),
    entity('mock-budget', 'Budget sheet', 35, 36, 440, 110),
    entity('mock-gamejam', 'Game jam', 29, 32, 440, 220),
  ],
  links: [
    link('mock-thesis', 'mock-reading', 'cites'),
    link('mock-thesis', 'mock-website'),
    link('mock-reading', 'mock-photos'),
    link('mock-website', 'mock-photos', 'shows'),
    link('mock-website', 'mock-recipes', 'publishes'),
    link('mock-garden', 'mock-budget'),
    link('mock-photos', 'mock-budget'),
    link('mock-gamejam', 'mock-website', 'publishes'),
  ],
};

// Index offsets for stress edges: the first pass links each node to the next one, the
// second to the node in the next row, and so on. Distinct offsets mean no duplicate edges.
const STRESS_OFFSETS = [1, 15, 7, 31] as const;
const STRESS_COLUMNS = 15;

/**
 * A deterministic mock graph for the GRAPH_MODEL §30.6 limit check (150 nodes / 300 edges
 * by default). Same input, same graph, so performance runs are comparable.
 */
export function createStressGraph(nodeCount = 150, edgeCount = 300): SpikeGraph {
  if (!Number.isInteger(nodeCount) || nodeCount < 2 || nodeCount > 300) {
    throw new RangeError(`nodeCount must be an integer from 2 to 300, got ${String(nodeCount)}`);
  }
  const maxEdges = nodeCount * STRESS_OFFSETS.length;
  if (!Number.isInteger(edgeCount) || edgeCount < 0 || edgeCount > maxEdges) {
    throw new RangeError(`edgeCount must be an integer from 0 to ${String(maxEdges)}`);
  }
  const entities: SpikeEntity[] = [];
  for (let index = 0; index < nodeCount; index++) {
    const column = index % STRESS_COLUMNS;
    const row = Math.floor(index / STRESS_COLUMNS);
    // Every 4th column / 3rd row keeps markers apart on the 64 × 64 map (up to 300 nodes).
    entities.push(
      entity(
        `stress-${String(index)}`,
        `Stress ${String(index)}`,
        2 + column * 4,
        2 + row * 3,
        column * 170,
        row * 90,
      ),
    );
  }
  const links: SpikeLink[] = [];
  for (let index = 0; index < edgeCount; index++) {
    const source = index % nodeCount;
    const offset = STRESS_OFFSETS[Math.floor(index / nodeCount)] ?? 1;
    const target = (source + offset) % nodeCount;
    links.push(link(`stress-${String(source)}`, `stress-${String(target)}`));
  }
  return {
    name: `Stress graph (${String(nodeCount)} nodes / ${String(edgeCount)} edges)`,
    entities,
    links,
  };
}

/**
 * Lists everything wrong with a graph: duplicate IDs, links to unknown entities, or tiles
 * off the map. Empty means valid. Used by tests; real data gets checked in the main process.
 */
export function graphProblems(graph: SpikeGraph, map: MapSize = DEFAULT_MAP): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const tiles = new Set<string>();
  for (const { id, tile } of graph.entities) {
    if (ids.has(id)) problems.push(`duplicate entity ${id}`);
    ids.add(id);
    const key = `${String(tile.gx)},${String(tile.gy)}`;
    if (tiles.has(key)) problems.push(`two entities on tile ${key}`);
    tiles.add(key);
    const onMap =
      Number.isInteger(tile.gx) &&
      Number.isInteger(tile.gy) &&
      tile.gx >= 0 &&
      tile.gy >= 0 &&
      tile.gx < map.columns &&
      tile.gy < map.rows;
    if (!onMap) problems.push(`entity ${id} is off the map`);
  }
  const linkIds = new Set<string>();
  for (const { id, source, target } of graph.links) {
    if (linkIds.has(id)) problems.push(`duplicate link ${id}`);
    linkIds.add(id);
    if (!ids.has(source) || !ids.has(target)) problems.push(`link ${id} has an unknown end`);
    if (source === target) problems.push(`link ${id} points to itself`);
  }
  return problems;
}
