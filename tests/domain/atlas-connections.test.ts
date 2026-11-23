// The Connections tab's pure layout and labels (M2-13 #78, ADR-0032): the ring layout is
// deterministic, keeps unplaced projects on an inner ring and never overlaps nodes on a ring;
// labels and classes show status and placement in words, not only colour.
import { describe, expect, it } from 'vitest';

import type { GraphProjectNode } from '../../src/common/contracts/graph';
import type { RelationSummary } from '../../src/common/contracts/relation';
import {
  drawableEdges,
  nodeClassName,
  nodeDescription,
  nodeLabel,
  ringLayout,
} from '../../src/renderer/atlas/connections-layout';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

function node(n: number, extra: Partial<GraphProjectNode> = {}): GraphProjectNode {
  return {
    projectId: id(n),
    name: `P${String(n)}`,
    status: 'active',
    placed: true,
    linkCount: 0,
    ...extra,
  };
}

/** A position that must exist (fails the test otherwise). */
function at(layout: Map<string, { x: number; y: number }>, key: string) {
  const point = layout.get(key);
  if (point === undefined) throw new Error(`no position for ${key}`);
  return point;
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe('ringLayout', () => {
  it('puts a lone project in the centre and gives every project a position', () => {
    expect(ringLayout([node(1)]).get(id(1))).toEqual({ x: 0, y: 0 });
    const many = Array.from({ length: 12 }, (_, i) => node(i + 1));
    expect(ringLayout(many).size).toBe(12);
    expect(ringLayout([]).size).toBe(0);
  });

  it('is deterministic: the same input gives the same positions', () => {
    const nodes = [node(1), node(2, { placed: false }), node(3), node(4, { placed: false })];
    expect([...ringLayout(nodes)]).toEqual([...ringLayout(nodes)]);
  });

  it('keeps unplaced projects on a ring inside the placed ones', () => {
    const nodes = [
      ...Array.from({ length: 6 }, (_, i) => node(i + 1)),
      ...Array.from({ length: 3 }, (_, i) => node(i + 10, { placed: false })),
    ];
    const layout = ringLayout(nodes);
    const origin = { x: 0, y: 0 };
    const outer = nodes
      .filter((n) => n.placed)
      .map((n) => distance(at(layout, n.projectId), origin));
    const inner = nodes
      .filter((n) => !n.placed)
      .map((n) => distance(at(layout, n.projectId), origin));
    expect(Math.min(...outer)).toBeGreaterThan(Math.max(...inner));
  });

  it('puts inner nodes between outer ones, never on the line across the ring or in the centre', () => {
    // Two placed projects sit top and bottom; a link between them runs down the middle.
    for (const innerCount of [1, 2]) {
      const nodes = [
        node(1),
        node(2),
        ...Array.from({ length: innerCount }, (_, i) => node(i + 10, { placed: false })),
      ];
      const layout = ringLayout(nodes);
      expect(at(layout, id(1)).x).toBe(0);
      expect(at(layout, id(2)).x).toBe(0);
      for (const n of nodes.filter((p) => !p.placed)) {
        expect(Math.abs(at(layout, n.projectId).x)).toBeGreaterThan(120);
      }
    }
  });

  it('uses the outer ring when no project has a building', () => {
    const nodes = [node(1, { placed: false }), node(2, { placed: false })];
    const layout = ringLayout(nodes);
    expect(distance(at(layout, id(1)), { x: 0, y: 0 })).toBeGreaterThan(100);
  });

  it('leaves room between neighbours even at 150 projects', () => {
    const nodes = Array.from({ length: 150 }, (_, i) => node(i + 1, { placed: i % 3 !== 0 }));
    const layout = ringLayout(nodes);
    const keys = [...layout.keys()];
    let closest = Infinity;
    for (const [i, a] of keys.entries()) {
      for (const b of keys.slice(i + 1)) {
        closest = Math.min(closest, distance(at(layout, a), at(layout, b)));
      }
    }
    expect(closest).toBeGreaterThan(150);
  });
});

describe('labels and classes', () => {
  it('names status and placement in words', () => {
    expect(nodeLabel(node(1))).toBe('P1');
    expect(nodeLabel(node(1, { status: 'archived', placed: false }))).toBe(
      'P1 (archived, no building)',
    );
    expect(nodeDescription(node(1, { linkCount: 1 }))).toBe('P1, 1 link');
    expect(nodeDescription(node(1, { linkCount: 2 }))).toBe('P1, 2 links');
  });

  it('gives archived and unplaced projects their own shape classes', () => {
    expect(nodeClassName(node(1))).toBe('atlas-node');
    expect(nodeClassName(node(1, { status: 'archived', placed: false }))).toBe(
      'atlas-node atlas-node-archived atlas-node-unplaced',
    );
  });
});

describe('drawableEdges', () => {
  it('drops a link whose end is not drawn', () => {
    const edge = (n: number, source: number, target: number): RelationSummary => ({
      id: id(100 + n),
      worldId: id(999),
      sourceProjectId: id(source),
      targetProjectId: id(target),
      type: 'supports',
      origin: 'user',
      confirmationState: 'confirmed',
      createdAt: '2026-11-23T00:00:00.000Z',
      updatedAt: '2026-11-23T00:00:00.000Z',
      revision: 1,
    });
    const kept = drawableEdges([node(1), node(2)], [edge(1, 1, 2), edge(2, 1, 3)]);
    expect(kept.map((e) => e.id)).toEqual([id(101)]);
  });
});
