import { describe, expect, it } from 'vitest';
import type { ExplainPlanNodeView } from './lib/generated/contracts';
import {
  EXPLAIN_GRAPH_MAX_ZOOM,
  EXPLAIN_GRAPH_MIN_ZOOM,
  EXPLAIN_GRAPH_NODE_LIMIT,
  analyzeExplainHotspots,
  clampExplainGraphZoom,
  createExplainGraphLayout,
  explainGraphNavigationTarget,
  parseExplainEstimate
} from './lib/explain-visualization';

function node(
  id: number,
  parentId: number | null,
  overrides: Partial<ExplainPlanNodeView> = {}
): ExplainPlanNodeView {
  return {
    id,
    parent_id: parentId,
    depth: parentId === null ? 0 : 1,
    operation: `Operation ${id}`,
    relation: null,
    alias: null,
    access_type: null,
    join_type: null,
    index: null,
    estimated_rows: null,
    startup_cost: null,
    total_cost: null,
    width: null,
    condition: null,
    detail: null,
    ...overrides
  };
}

describe('Explain graph layout', () => {
  it('lays out a deterministic top-down forest without overlapping long-label cards', () => {
    const nodes = [
      node(1, null, {
        operation: 'A root operation with a deliberately very long label'
      }),
      node(2, 1),
      node(3, 1),
      node(4, null),
      node(5, 4)
    ];
    const first = createExplainGraphLayout(nodes)!;
    const second = createExplainGraphLayout(nodes)!;

    expect(second).toEqual(first);
    expect(first.rootIds).toEqual([1, 4]);
    expect(first.nodes.find((entry) => entry.id === 2)!.y).toBeGreaterThan(
      first.nodes.find((entry) => entry.id === 1)!.y
    );
    const cards = first.nodes;
    for (let left = 0; left < cards.length; left += 1) {
      for (let right = left + 1; right < cards.length; right += 1) {
        const a = cards[left];
        const b = cards[right];
        const overlap =
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y;
        expect(overlap).toBe(false);
      }
    }
  });

  it('supports hierarchy-aware keyboard navigation and visual endpoints', () => {
    const layout = createExplainGraphLayout([
      node(1, null),
      node(2, 1),
      node(3, 1),
      node(4, 2)
    ])!;
    expect(explainGraphNavigationTarget(layout, 1, 'ArrowDown')).toBe(2);
    expect(explainGraphNavigationTarget(layout, 2, 'ArrowUp')).toBe(1);
    expect(explainGraphNavigationTarget(layout, 2, 'ArrowRight')).toBe(3);
    expect(explainGraphNavigationTarget(layout, 3, 'ArrowLeft')).toBe(2);
    expect(explainGraphNavigationTarget(layout, 4, 'Home')).toBe(1);
    expect(explainGraphNavigationTarget(layout, 1, 'End')).toBe(4);
  });

  it('enforces the graph cutoff and zoom bounds', () => {
    expect(
      createExplainGraphLayout(
        Array.from({ length: EXPLAIN_GRAPH_NODE_LIMIT }, (_, index) =>
          node(index, null)
        )
      )
    ).not.toBeNull();
    expect(
      createExplainGraphLayout(
        Array.from({ length: EXPLAIN_GRAPH_NODE_LIMIT + 1 }, (_, index) =>
          node(index, null)
        )
      )
    ).toBeNull();
    expect(clampExplainGraphZoom(42)).toBe(EXPLAIN_GRAPH_MIN_ZOOM);
    expect(clampExplainGraphZoom(157)).toBe(EXPLAIN_GRAPH_MAX_ZOOM);
    expect(clampExplainGraphZoom(114)).toBe(110);
    expect(clampExplainGraphZoom(Number.NaN)).toBe(100);
  });
});

describe('Explain hotspot estimates', () => {
  it('parses only finite non-negative numeric estimates', () => {
    expect(parseExplainEstimate(' 12.5e2 ')).toBe(1250);
    expect(parseExplainEstimate('0')).toBe(0);
    expect(parseExplainEstimate('-1')).toBeNull();
    expect(parseExplainEstimate('Infinity')).toBeNull();
    expect(parseExplainEstimate('0x10')).toBeNull();
    expect(parseExplainEstimate(null)).toBeNull();
  });

  it('prefers cost, assigns tied ranks, and reports the three highest values', () => {
    const analysis = analyzeExplainHotspots([
      node(1, null, { total_cost: '1', estimated_rows: '1000' }),
      node(2, 1, { total_cost: '2', estimated_rows: '10' }),
      node(3, 1, { total_cost: '2', estimated_rows: '5' }),
      node(4, 1, { total_cost: '10', estimated_rows: '1' })
    ]);

    expect(analysis.metric).toBe('total_cost');
    expect(analysis.coverage).toBe(4);
    expect(analysis.estimates.get(2)?.rank).toBe(
      analysis.estimates.get(3)?.rank
    );
    expect(analysis.estimates.get(1)?.band).toBe('lower');
    expect(analysis.estimates.get(2)?.band).toBe('middle');
    expect(analysis.estimates.get(4)?.band).toBe('upper');
    expect(analysis.highest.map((entry) => entry.nodeId)).toEqual([4, 2, 3]);
  });

  it('falls back to rows and stays unavailable for sparse SQLite-style plans', () => {
    const rows = analyzeExplainHotspots([
      node(1, null, { total_cost: '4', estimated_rows: '10' }),
      node(2, 1, { estimated_rows: '20' })
    ]);
    expect(rows.metric).toBe('estimated_rows');
    expect(rows.coverage).toBe(2);

    const unavailable = analyzeExplainHotspots([
      node(1, null),
      node(2, 1, { estimated_rows: '4' }),
      node(3, 1, { total_cost: '-2' })
    ]);
    expect(unavailable.metric).toBeNull();
    expect(unavailable.coverage).toBe(0);
    expect(unavailable.estimates.size).toBe(0);
  });
});
