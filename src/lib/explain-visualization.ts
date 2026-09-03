import type { ExplainPlanNodeView } from './generated/contracts';

export const EXPLAIN_GRAPH_NODE_LIMIT = 250;
export const EXPLAIN_GRAPH_MIN_ZOOM = 50;
export const EXPLAIN_GRAPH_MAX_ZOOM = 150;
export const EXPLAIN_GRAPH_ZOOM_STEP = 10;

export type ExplainPlanViewMode = 'graph' | 'tree' | 'raw';

const CARD_WIDTH = 220;
const CARD_HEIGHT = 60;
const HORIZONTAL_GAP = 36;
const VERTICAL_GAP = 48;
const CANVAS_PADDING = 8;

export type ExplainHotspotMetric = 'total_cost' | 'estimated_rows';
export type ExplainHotspotBand = 'lower' | 'middle' | 'upper';

export interface ExplainHotspotEstimate {
  nodeId: number;
  value: number;
  reportedValue: string;
  rank: number;
  band: ExplainHotspotBand;
}

export interface ExplainHotspotAnalysis {
  metric: ExplainHotspotMetric | null;
  metricLabel: string | null;
  coverage: number;
  totalNodes: number;
  estimates: ReadonlyMap<number, ExplainHotspotEstimate>;
  highest: readonly ExplainHotspotEstimate[];
}

export interface ExplainGraphNode {
  id: number;
  parentId: number | null;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExplainGraphEdge {
  id: string;
  parentId: number;
  childId: number;
  path: string;
}

export interface ExplainGraphLayout {
  width: number;
  height: number;
  nodes: readonly ExplainGraphNode[];
  edges: readonly ExplainGraphEdge[];
  rootIds: readonly number[];
  visualOrder: readonly number[];
  childrenById: ReadonlyMap<number, readonly number[]>;
}

export type ExplainGraphNavigationKey =
  'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

export function parseExplainEstimate(value: string | null): number | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized))
    return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function analyzeExplainHotspots(
  nodes: readonly ExplainPlanNodeView[]
): ExplainHotspotAnalysis {
  const candidates = (metric: ExplainHotspotMetric) =>
    nodes.flatMap((node, sourceIndex) => {
      const reportedValue = node[metric];
      const value = parseExplainEstimate(reportedValue);
      return value === null
        ? []
        : [
            {
              nodeId: node.id,
              reportedValue: reportedValue!,
              value,
              sourceIndex
            }
          ];
    });

  const totalCosts = candidates('total_cost');
  const estimatedRows = candidates('estimated_rows');
  const metric: ExplainHotspotMetric | null =
    totalCosts.length >= 2
      ? 'total_cost'
      : estimatedRows.length >= 2
        ? 'estimated_rows'
        : null;
  const selected =
    metric === 'total_cost'
      ? totalCosts
      : metric === 'estimated_rows'
        ? estimatedRows
        : [];

  if (metric === null) {
    return {
      metric: null,
      metricLabel: null,
      coverage: 0,
      totalNodes: nodes.length,
      estimates: new Map(),
      highest: []
    };
  }

  const distinctValues = [
    ...new Set(selected.map((entry) => entry.value))
  ].sort((a, b) => a - b);
  const estimates = new Map<number, ExplainHotspotEstimate>();

  for (const entry of selected) {
    const rankIndex = distinctValues.indexOf(entry.value);
    const rank =
      distinctValues.length === 1 ? 0 : rankIndex / (distinctValues.length - 1);
    const band: ExplainHotspotBand =
      rank >= 0.75 ? 'upper' : rank >= 0.25 ? 'middle' : 'lower';
    estimates.set(entry.nodeId, {
      nodeId: entry.nodeId,
      value: entry.value,
      reportedValue: entry.reportedValue,
      rank,
      band
    });
  }

  const highest = selected
    .slice()
    .sort(
      (left, right) =>
        right.value - left.value || left.sourceIndex - right.sourceIndex
    )
    .slice(0, 3)
    .map((entry) => estimates.get(entry.nodeId)!)
    .filter(Boolean);

  return {
    metric,
    metricLabel: metric === 'total_cost' ? 'Total cost' : 'Estimated rows',
    coverage: selected.length,
    totalNodes: nodes.length,
    estimates,
    highest
  };
}

export function clampExplainGraphZoom(value: number): number {
  if (!Number.isFinite(value)) return 100;
  const stepped =
    Math.round(value / EXPLAIN_GRAPH_ZOOM_STEP) * EXPLAIN_GRAPH_ZOOM_STEP;
  return Math.min(
    EXPLAIN_GRAPH_MAX_ZOOM,
    Math.max(EXPLAIN_GRAPH_MIN_ZOOM, stepped)
  );
}

export function createExplainGraphLayout(
  nodes: readonly ExplainPlanNodeView[]
): ExplainGraphLayout | null {
  if (nodes.length === 0 || nodes.length > EXPLAIN_GRAPH_NODE_LIMIT)
    return null;

  const uniqueNodes: ExplainPlanNodeView[] = [];
  const nodeById = new Map<number, ExplainPlanNodeView>();
  for (const node of nodes) {
    if (nodeById.has(node.id)) continue;
    nodeById.set(node.id, node);
    uniqueNodes.push(node);
  }

  const proposedChildren = new Map<number, number[]>();
  for (const node of uniqueNodes) proposedChildren.set(node.id, []);
  for (const node of uniqueNodes) {
    if (
      node.parent_id === null ||
      node.parent_id === node.id ||
      !nodeById.has(node.parent_id)
    )
      continue;
    proposedChildren.get(node.parent_id)!.push(node.id);
  }

  const proposedRoots = uniqueNodes
    .filter(
      (node) =>
        node.parent_id === null ||
        node.parent_id === node.id ||
        !nodeById.has(node.parent_id)
    )
    .map((node) => node.id);
  const roots: number[] = [];
  const acceptedChildren = new Map<number, number[]>();
  const acceptedParent = new Map<number, number>();
  for (const node of uniqueNodes) acceptedChildren.set(node.id, []);

  const visited = new Set<number>();
  const visiting = new Set<number>();
  const acceptSubtree = (nodeId: number) => {
    if (visited.has(nodeId) || visiting.has(nodeId)) return;
    visiting.add(nodeId);
    for (const childId of proposedChildren.get(nodeId) ?? []) {
      if (visited.has(childId) || visiting.has(childId)) continue;
      acceptedChildren.get(nodeId)!.push(childId);
      acceptedParent.set(childId, nodeId);
      acceptSubtree(childId);
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  for (const rootId of proposedRoots) {
    if (visited.has(rootId)) continue;
    roots.push(rootId);
    acceptSubtree(rootId);
  }
  for (const node of uniqueNodes) {
    if (visited.has(node.id)) continue;
    roots.push(node.id);
    acceptSubtree(node.id);
  }

  let nextLeaf = 0;
  let maximumDepth = 0;
  const positions = new Map<number, { x: number; depth: number }>();
  const positionSubtree = (nodeId: number, depth: number): number => {
    maximumDepth = Math.max(maximumDepth, depth);
    const children = acceptedChildren.get(nodeId) ?? [];
    let x: number;
    if (children.length === 0) {
      x = nextLeaf * (CARD_WIDTH + HORIZONTAL_GAP);
      nextLeaf += 1;
    } else {
      const childPositions = children.map((childId) =>
        positionSubtree(childId, depth + 1)
      );
      x = (childPositions[0] + childPositions[childPositions.length - 1]) / 2;
    }
    positions.set(nodeId, { x, depth });
    return x;
  };
  for (const rootId of roots) positionSubtree(rootId, 0);

  const contentWidth = Math.max(
    CARD_WIDTH,
    nextLeaf * CARD_WIDTH + Math.max(0, nextLeaf - 1) * HORIZONTAL_GAP
  );
  const width = contentWidth + CANVAS_PADDING * 2;
  const height =
    (maximumDepth + 1) * CARD_HEIGHT +
    maximumDepth * VERTICAL_GAP +
    CANVAS_PADDING * 2;
  const layoutNodes = uniqueNodes.map((node) => {
    const position = positions.get(node.id)!;
    return {
      id: node.id,
      parentId: acceptedParent.get(node.id) ?? null,
      depth: position.depth,
      x: position.x + CANVAS_PADDING,
      y: position.depth * (CARD_HEIGHT + VERTICAL_GAP) + CANVAS_PADDING,
      width: CARD_WIDTH,
      height: CARD_HEIGHT
    };
  });
  const layoutNodeById = new Map(layoutNodes.map((node) => [node.id, node]));
  const edges: ExplainGraphEdge[] = [];
  for (const [parentId, childIds] of acceptedChildren) {
    const parent = layoutNodeById.get(parentId)!;
    for (const childId of childIds) {
      const child = layoutNodeById.get(childId)!;
      const startX = parent.x + parent.width / 2;
      const startY = parent.y + parent.height;
      const endX = child.x + child.width / 2;
      const endY = child.y;
      const bendY = startY + (endY - startY) / 2;
      edges.push({
        id: `${parentId}-${childId}`,
        parentId,
        childId,
        path: `M ${startX} ${startY} C ${startX} ${bendY}, ${endX} ${bendY}, ${endX} ${endY}`
      });
    }
  }

  return {
    width,
    height,
    nodes: layoutNodes,
    edges,
    rootIds: roots,
    visualOrder: layoutNodes
      .slice()
      .sort((left, right) => left.y - right.y || left.x - right.x)
      .map((node) => node.id),
    childrenById: new Map(
      [...acceptedChildren].map(([parentId, childIds]) => [
        parentId,
        childIds.slice()
      ])
    )
  };
}

export function explainGraphNavigationTarget(
  layout: ExplainGraphLayout,
  currentNodeId: number,
  key: ExplainGraphNavigationKey
): number {
  const current = layout.nodes.find((node) => node.id === currentNodeId);
  if (!current)
    return layout.rootIds[0] ?? layout.visualOrder[0] ?? currentNodeId;

  if (key === 'Home') return layout.rootIds[0] ?? currentNodeId;
  if (key === 'End') return layout.visualOrder.at(-1) ?? currentNodeId;
  if (key === 'ArrowUp') return current.parentId ?? currentNodeId;
  if (key === 'ArrowDown')
    return layout.childrenById.get(currentNodeId)?.[0] ?? currentNodeId;

  const siblings =
    current.parentId === null
      ? layout.rootIds
      : (layout.childrenById.get(current.parentId) ?? [currentNodeId]);
  const siblingIndex = siblings.indexOf(currentNodeId);
  if (key === 'ArrowLeft')
    return siblings[Math.max(0, siblingIndex - 1)] ?? currentNodeId;
  return (
    siblings[Math.min(siblings.length - 1, siblingIndex + 1)] ?? currentNodeId
  );
}
