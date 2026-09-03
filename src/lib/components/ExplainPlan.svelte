<script lang="ts">
  import { tick } from 'svelte';
  import type { Attachment } from 'svelte/attachments';

  import {
    EXPLAIN_GRAPH_MAX_ZOOM,
    EXPLAIN_GRAPH_MIN_ZOOM,
    EXPLAIN_GRAPH_NODE_LIMIT,
    EXPLAIN_GRAPH_ZOOM_STEP,
    analyzeExplainHotspots,
    clampExplainGraphZoom,
    createExplainGraphLayout,
    explainGraphNavigationTarget,
    type ExplainGraphNavigationKey,
    type ExplainHotspotBand,
    type ExplainPlanViewMode
  } from '../explain-visualization';
  import type {
    ExplainPlanNodeView,
    ExplainPlanView
  } from '../generated/contracts';
  import Icon from './Icon.svelte';

  interface Props {
    plan: ExplainPlanView;
    view: ExplainPlanViewMode;
    hotspotEstimatesEnabled: boolean;
    onviewchange: (view: ExplainPlanViewMode) => void;
    oncopyraw: () => void;
  }

  let { plan, view, hotspotEstimatesEnabled, onviewchange, oncopyraw }: Props =
    $props();
  let selectedNodeId = $state<number | null>(null);
  let graphZoom = $state(100);
  let graphTree: HTMLElement | undefined;

  const captureGraphTree: Attachment<HTMLElement> = (element) => {
    graphTree = element;
    return () => {
      if (graphTree === element) graphTree = undefined;
    };
  };

  const graphLayout = $derived(createExplainGraphLayout(plan.nodes));
  const hotspots = $derived(analyzeExplainHotspots(plan.nodes));
  const selectedNode = $derived(
    plan.nodes.find((node) => node.id === selectedNodeId) ??
      plan.nodes[0] ??
      null
  );
  const selectedHotspot = $derived(
    selectedNode ? (hotspots.estimates.get(selectedNode.id) ?? null) : null
  );
  const nodeById = $derived(new Map(plan.nodes.map((node) => [node.id, node])));

  const rawDisplay = $derived.by(() => {
    if (!['json', 'sqlite_query_plan_rows'].includes(plan.raw_format))
      return plan.raw_payload;
    try {
      return JSON.stringify(JSON.parse(plan.raw_payload));
    } catch {
      return plan.raw_payload;
    }
  });

  function facts(node: ExplainPlanNodeView) {
    return [
      node.alias ? ['Alias', node.alias] : null,
      node.access_type ? ['Access', node.access_type] : null,
      node.join_type ? ['Join', node.join_type] : null,
      node.index ? ['Index', node.index] : null,
      node.estimated_rows ? ['Rows', node.estimated_rows] : null,
      node.startup_cost ? ['Startup cost', node.startup_cost] : null,
      node.total_cost ? ['Total cost', node.total_cost] : null,
      node.width ? ['Width', node.width] : null
    ].filter((fact): fact is string[] => fact !== null);
  }

  function normalizedFields(node: ExplainPlanNodeView) {
    return [
      ['Node ID', String(node.id)],
      ['Parent ID', node.parent_id === null ? 'None' : String(node.parent_id)],
      ['Depth', String(node.depth)],
      ['Operation', node.operation ?? 'Not reported'],
      ['Relation', node.relation ?? 'Not reported'],
      ['Alias', node.alias ?? 'Not reported'],
      ['Access type', node.access_type ?? 'Not reported'],
      ['Join type', node.join_type ?? 'Not reported'],
      ['Index', node.index ?? 'Not reported'],
      ['Estimated rows', node.estimated_rows ?? 'Not reported'],
      ['Startup cost', node.startup_cost ?? 'Not reported'],
      ['Total cost', node.total_cost ?? 'Not reported'],
      ['Width', node.width ?? 'Not reported'],
      ['Condition', node.condition ?? 'Not reported'],
      ['Detail', node.detail ?? 'Not reported']
    ];
  }

  function primaryEstimate(node: ExplainPlanNodeView) {
    if (node.total_cost) return `Cost ${node.total_cost}`;
    if (node.estimated_rows) return `Rows ${node.estimated_rows}`;
    return 'No estimate reported';
  }

  function hotspotBand(nodeId: number): ExplainHotspotBand | null {
    return hotspotEstimatesEnabled
      ? (hotspots.estimates.get(nodeId)?.band ?? null)
      : null;
  }

  function hotspotBandLabel(band: ExplainHotspotBand | null) {
    if (band === 'upper') return 'Upper quartile';
    if (band === 'middle') return 'Middle estimate';
    if (band === 'lower') return 'Lower estimate';
    return 'Not ranked';
  }

  function displayedDetail(node: ExplainPlanNodeView) {
    const detail = node.detail?.trim();
    if (!detail) return null;
    const title = [node.operation, node.relation]
      .filter(Boolean)
      .join(' ')
      .trim();
    const normalizedDetail = detail.toLocaleLowerCase();
    const normalizedTitle = title.toLocaleLowerCase();
    return normalizedDetail === normalizedTitle ||
      normalizedDetail.startsWith(`${normalizedTitle} `)
      ? null
      : detail;
  }

  function displayedWarning(warning: string) {
    return warning.includes(
      'SQLite documents EXPLAIN QUERY PLAN output as unstable'
    )
      ? 'SQLite plan shapes can change between versions. Raw keeps the exact engine output.'
      : warning;
  }

  async function handleTabKeydown(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tablist = (event.currentTarget as HTMLElement).closest<HTMLElement>(
      '[role="tablist"]'
    );
    if (!tablist) return;
    const available: ExplainPlanViewMode[] = [
      ...(graphLayout ? (['graph'] as const) : []),
      ...(plan.nodes.length ? (['tree'] as const) : []),
      'raw'
    ];
    const current = Math.max(0, available.indexOf(view));
    const next =
      event.key === 'Home'
        ? available[0]
        : event.key === 'End'
          ? available.at(-1)!
          : event.key === 'ArrowRight'
            ? available[(current + 1) % available.length]
            : available[(current - 1 + available.length) % available.length];
    onviewchange(next);
    await tick();
    tablist
      .querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.focus();
  }

  function handleTreeKeydown(event: KeyboardEvent) {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const currentItem = event.currentTarget as HTMLElement;
    const tree = currentItem.closest<HTMLElement>('[role="tree"]');
    if (!tree) return;
    const items = Array.from(
      tree.querySelectorAll<HTMLElement>('[role="treeitem"]')
    );
    const current = items.indexOf(currentItem);
    if (current < 0) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowUp'
            ? Math.max(0, current - 1)
            : Math.min(items.length - 1, current + 1);
    items[next]?.focus();
  }

  async function handleGraphKeydown(event: KeyboardEvent, nodeId: number) {
    if (
      !graphLayout ||
      ![
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End'
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    const target = explainGraphNavigationTarget(
      graphLayout,
      nodeId,
      event.key as ExplainGraphNavigationKey
    );
    selectedNodeId = target;
    await tick();
    graphTree
      ?.querySelector<HTMLElement>(`[data-plan-node-id="${target}"]`)
      ?.focus();
  }

  function changeZoom(change: number) {
    graphZoom = clampExplainGraphZoom(graphZoom + change);
  }
</script>

<div class="plan-shell">
  <div class="plan-summary">
    <span>{plan.engine} {plan.exact_version}</span>
    <span>{plan.context}</span>
    <span>{plan.nodes.length} {plan.nodes.length === 1 ? 'node' : 'nodes'}</span
    >
  </div>

  {#if plan.warnings.length}
    <div class="plan-notes" role="note" aria-label="Plan fidelity">
      {#each plan.warnings as warning (warning)}
        <p><span aria-hidden="true">i</span>{displayedWarning(warning)}</p>
      {/each}
    </div>
  {/if}

  <div class="plan-view-actions">
    <div
      class="plan-tabs view-switch"
      role="tablist"
      aria-label="Query plan view"
    >
      <button
        type="button"
        role="tab"
        aria-selected={view === 'graph'}
        tabindex={view === 'graph' ? 0 : -1}
        disabled={!graphLayout}
        title={!graphLayout && plan.nodes.length > EXPLAIN_GRAPH_NODE_LIMIT
          ? `Graph is available for plans with up to ${EXPLAIN_GRAPH_NODE_LIMIT} nodes`
          : undefined}
        onkeydown={handleTabKeydown}
        onclick={() => onviewchange('graph')}>Graph</button
      >
      <button
        type="button"
        role="tab"
        aria-selected={view === 'tree'}
        tabindex={view === 'tree' ? 0 : -1}
        disabled={plan.nodes.length === 0}
        onkeydown={handleTabKeydown}
        onclick={() => onviewchange('tree')}>Tree</button
      >
      <button
        type="button"
        role="tab"
        aria-selected={view === 'raw'}
        tabindex={view === 'raw' ? 0 : -1}
        onkeydown={handleTabKeydown}
        onclick={() => onviewchange('raw')}>Raw</button
      >
    </div>
    {#if view === 'graph' && graphLayout}
      <div class="graph-toolbar" aria-label="Graph zoom controls">
        <span>Graph zoom</span>
        <div>
          <button
            type="button"
            aria-label="Zoom out"
            disabled={graphZoom <= EXPLAIN_GRAPH_MIN_ZOOM}
            onclick={() => changeZoom(-EXPLAIN_GRAPH_ZOOM_STEP)}>−</button
          >
          <button
            type="button"
            aria-label="Reset zoom"
            onclick={() => (graphZoom = 100)}>{graphZoom}%</button
          >
          <button
            type="button"
            aria-label="Zoom in"
            disabled={graphZoom >= EXPLAIN_GRAPH_MAX_ZOOM}
            onclick={() => changeZoom(EXPLAIN_GRAPH_ZOOM_STEP)}>+</button
          >
        </div>
      </div>
    {:else if view === 'raw'}
      <button type="button" class="copy-raw" onclick={oncopyraw}>
        <Icon name="copy" size={13} />Copy raw
      </button>
    {/if}
  </div>

  {#if plan.nodes.length > EXPLAIN_GRAPH_NODE_LIMIT}
    <p class="graph-unavailable" role="note">
      Graph is unavailable for plans over {EXPLAIN_GRAPH_NODE_LIMIT} nodes. Tree and
      Raw retain the complete plan.
    </p>
  {/if}

  {#if hotspotEstimatesEnabled && plan.nodes.length && view !== 'raw'}
    <section
      class="hotspot-summary"
      class:ranked={Boolean(hotspots.metric)}
      aria-label="Relative plan estimates"
    >
      {#if hotspots.metric}
        <div class="hotspot-heading">
          <strong>Relative estimates</strong>
          <span
            >{hotspots.metricLabel} · {hotspots.coverage} of {hotspots.totalNodes}
            nodes</span
          >
        </div>
        <div class="hotspot-legend" aria-label="Relative estimate bands">
          <span><i class="legend-lower" aria-hidden="true"></i>Lower</span>
          <span><i class="legend-middle" aria-hidden="true"></i>Middle</span>
          <span
            ><i class="legend-upper" aria-hidden="true"></i>Upper quartile</span
          >
        </div>
        <ol
          class="hotspot-highest"
          aria-label="Three highest reported estimates"
        >
          {#each hotspots.highest as estimate (estimate.nodeId)}
            <li>
              {nodeById.get(estimate.nodeId)?.operation ??
                `Node ${estimate.nodeId}`}
              <span>{estimate.reportedValue}</span>
            </li>
          {/each}
        </ol>
      {:else}
        <div class="hotspot-heading">
          <strong>Relative estimate unavailable</strong>
          <span
            >Fewer than two nodes report comparable cost or row estimates.</span
          >
        </div>
      {/if}
    </section>
  {/if}

  {#if view === 'graph' && graphLayout}
    <div class="plan-graph-view">
      <div class="graph-panel">
        <div class="graph-scroll" aria-label="Scrollable estimated plan graph">
          <div
            class="graph-canvas"
            style:width={`${graphLayout.width * (graphZoom / 100)}px`}
            style:height={`${graphLayout.height * (graphZoom / 100)}px`}
          >
            <div
              class="graph-scale"
              role="tree"
              aria-label="Estimated query plan nodes"
              {@attach captureGraphTree}
              style:width={`${graphLayout.width}px`}
              style:height={`${graphLayout.height}px`}
              style:transform={`scale(${graphZoom / 100})`}
            >
              <svg
                class="graph-edges"
                width={graphLayout.width}
                height={graphLayout.height}
                viewBox={`0 0 ${graphLayout.width} ${graphLayout.height}`}
                aria-hidden="true"
              >
                {#each graphLayout.edges as edge (edge.id)}<path d={edge.path}
                  ></path>{/each}
              </svg>
              {#each graphLayout.nodes as layoutNode, index (layoutNode.id)}
                {@const node = nodeById.get(layoutNode.id)!}
                {@const band = hotspotBand(node.id)}
                <button
                  type="button"
                  class="graph-node"
                  class:selected={selectedNode?.id === node.id}
                  data-hotspot-band={band}
                  data-plan-node-id={node.id}
                  role="treeitem"
                  aria-level={layoutNode.depth + 1}
                  aria-selected={selectedNode?.id === node.id}
                  aria-label={`${node.operation ?? 'Plan node'}${node.relation ? ` on ${node.relation}` : ''}. ${primaryEstimate(node)}${band ? `. ${hotspotBandLabel(band)}` : ''}`}
                  tabindex={selectedNode?.id === node.id ||
                  (selectedNodeId === null && index === 0)
                    ? 0
                    : -1}
                  style:left={`${layoutNode.x}px`}
                  style:top={`${layoutNode.y}px`}
                  style:width={`${layoutNode.width}px`}
                  style:height={`${layoutNode.height}px`}
                  onfocus={() => (selectedNodeId = node.id)}
                  onclick={() => (selectedNodeId = node.id)}
                  onkeydown={(event) => handleGraphKeydown(event, node.id)}
                >
                  <strong>{node.operation ?? 'Plan node'}</strong>
                  <span class="graph-relation"
                    >{node.relation ?? 'No relation'}</span
                  >
                  <span class="graph-estimate">{primaryEstimate(node)}</span>
                  {#if band}<span class="graph-band"
                      >{hotspotBandLabel(band)}</span
                    >{/if}
                </button>
              {/each}
            </div>
          </div>
        </div>
      </div>

      {#if selectedNode}
        <aside class="node-inspector" aria-label="Selected plan node details">
          <div class="inspector-heading">
            <strong>{selectedNode.operation ?? 'Plan node'}</strong>
            <span>Node {selectedNode.id}</span>
          </div>
          {#if hotspotEstimatesEnabled}
            <div class="inspector-ranking">
              <span>Relative estimate</span>
              <strong>{hotspotBandLabel(selectedHotspot?.band ?? null)}</strong>
              {#if hotspots.metric && selectedHotspot}
                <small
                  >{hotspots.metricLabel}: {selectedHotspot.reportedValue}</small
                >
              {:else}
                <small>No comparable estimate reported for this node.</small>
              {/if}
            </div>
          {/if}
          <dl>
            {#each normalizedFields(selectedNode) as field (field[0])}
              <div>
                <dt>{field[0]}</dt>
                <dd>{field[1]}</dd>
              </div>
            {/each}
          </dl>
        </aside>
      {/if}
    </div>
  {:else if view === 'tree' && plan.nodes.length}
    <div class="plan-tree" role="tree" aria-label="Estimated query plan nodes">
      {#each plan.nodes as node, index (node.id)}
        {@const band = hotspotBand(node.id)}
        <div
          class="plan-node"
          data-hotspot-band={band}
          role="treeitem"
          aria-level={node.depth + 1}
          aria-selected="false"
          tabindex={index === 0 ? 0 : -1}
          onkeydown={handleTreeKeydown}
          style:--plan-depth={Math.min(node.depth, 64)}
        >
          <span class="node-branch" aria-hidden="true"></span>
          <div class="node-content">
            <div class="node-title">
              <strong>{node.operation ?? 'Plan node'}</strong>
              {#if node.relation}<span class="node-relation"
                  >{node.relation}</span
                >{/if}
              {#if displayedDetail(node)}<span>{displayedDetail(node)}</span
                >{/if}
              {#if band}<span class="tree-band">{hotspotBandLabel(band)}</span
                >{/if}
            </div>
            {#if facts(node).length}
              <dl class="node-facts">
                {#each facts(node) as fact (fact[0])}
                  <div>
                    <dt>{fact[0]}</dt>
                    <dd>{fact[1]}</dd>
                  </div>
                {/each}
              </dl>
            {/if}
            {#if node.condition}<p class="node-condition">
                <span>Condition</span>{node.condition}
              </p>{/if}
          </div>
        </div>
      {/each}
    </div>
  {:else if view === 'raw'}
    <textarea
      class="plan-raw"
      readonly
      aria-label="Raw estimated query plan"
      value={rawDisplay}></textarea>
  {/if}
</div>

<style>
  .plan-shell {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0 0.9rem 0.9rem;
    overflow: hidden;
  }
  .plan-summary,
  .plan-view-actions,
  .node-title,
  .node-facts,
  .hotspot-heading,
  .hotspot-legend,
  .graph-toolbar,
  .inspector-heading {
    display: flex;
    align-items: center;
  }
  .plan-summary {
    flex-wrap: wrap;
    gap: 0.35rem 0.8rem;
    color: var(--text);
    font-size: 0.75rem;
  }
  .plan-summary span + span::before {
    margin-inline-end: 0.8rem;
    color: var(--divider);
    content: '·';
  }
  .plan-notes {
    color: var(--muted);
  }
  .plan-notes p {
    display: flex;
    align-items: baseline;
    margin: 0;
    gap: 0.4rem;
    font-size: 0.7rem;
    line-height: 1.4;
  }
  .plan-notes span {
    display: inline-grid;
    width: 1rem;
    height: 1rem;
    flex: 0 0 1rem;
    place-items: center;
    border: 1px solid var(--divider);
    border-radius: 50%;
    font-size: 0.62rem;
    font-weight: 750;
  }
  .plan-view-actions {
    justify-content: space-between;
    gap: 0.75rem;
    border-bottom: 1px solid var(--divider);
  }
  .plan-tabs {
    align-self: stretch;
  }
  .copy-raw,
  .graph-toolbar button {
    display: inline-flex;
    align-items: center;
    border: 0;
    color: var(--muted);
    background: transparent;
  }
  .copy-raw {
    min-height: 2rem;
    padding: 0.35rem 0.6rem;
    gap: 0.35rem;
    border-radius: 0;
    font-size: 0.7rem;
  }
  .copy-raw:hover:not(:disabled),
  .graph-toolbar button:hover:not(:disabled) {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 7%, transparent);
  }
  .graph-unavailable {
    margin: 0;
    color: var(--muted);
    font-size: 0.72rem;
  }
  .hotspot-summary {
    display: grid;
    grid-template-columns: minmax(12rem, 1fr) auto;
    gap: 0.35rem 1rem;
    padding: 0.45rem 0.55rem;
    border-inline-start: 2px solid var(--divider);
    background: var(--surface-subtle);
    font-size: 0.7rem;
  }
  .hotspot-summary.ranked {
    border-inline-start-color: color-mix(
      in srgb,
      var(--warning) 65%,
      var(--divider)
    );
    background: color-mix(in srgb, var(--warning) 6%, var(--surface-subtle));
  }
  .hotspot-heading {
    min-width: 0;
    flex-wrap: wrap;
    gap: 0.25rem 0.55rem;
  }
  .hotspot-heading span,
  .hotspot-legend,
  .hotspot-highest {
    color: var(--muted);
  }
  .hotspot-legend {
    flex-wrap: wrap;
    justify-content: end;
    gap: 0.35rem 0.65rem;
  }
  .hotspot-legend span {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .hotspot-legend i {
    width: 0.55rem;
    height: 0.55rem;
    border: 1px solid var(--divider);
  }
  .legend-lower {
    background: var(--surface-raised);
  }
  .legend-middle {
    background: color-mix(in srgb, var(--warning) 11%, var(--surface-raised));
  }
  .legend-upper {
    background: color-mix(in srgb, var(--warning) 23%, var(--surface-raised));
  }
  .hotspot-highest {
    display: flex;
    min-width: 0;
    grid-column: 1 / -1;
    margin: 0;
    padding: 0;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    list-style-position: inside;
  }
  .hotspot-highest li span {
    color: var(--text);
    font-family: var(--table-font-family);
  }
  .plan-tree,
  .plan-raw,
  .plan-graph-view {
    width: 100%;
    min-height: 0;
    flex: 1 1 auto;
    border: 1px solid var(--divider);
    border-radius: var(--radius-sm);
    background: var(--surface-subtle);
  }
  .plan-tree,
  .plan-raw {
    overflow: auto;
  }
  .plan-graph-view {
    display: flex;
    overflow: hidden;
  }
  .graph-panel {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1 1 auto;
    flex-direction: column;
  }
  .graph-toolbar {
    min-height: 2rem;
    flex: 0 0 auto;
    gap: 0.5rem;
    padding-inline: 0.25rem 0.35rem;
    color: var(--muted);
    font-size: 0.7rem;
    white-space: nowrap;
  }
  .graph-toolbar div {
    display: inline-flex;
    border: 1px solid var(--divider);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .graph-toolbar button {
    min-width: 2rem;
    min-height: 1.6rem;
    justify-content: center;
    padding: 0 0.4rem;
    font-size: 0.7rem;
  }
  .graph-toolbar button + button {
    border-inline-start: 1px solid var(--divider);
  }
  .graph-scroll {
    min-width: 0;
    min-height: 0;
    flex: 1 1 auto;
    overflow: auto;
  }
  .graph-scroll:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .graph-canvas,
  .graph-scale {
    position: relative;
  }
  .graph-scale {
    transform-origin: left top;
  }
  .graph-edges {
    position: absolute;
    inset: 0;
    overflow: visible;
    pointer-events: none;
  }
  .graph-edges path {
    fill: none;
    stroke: color-mix(in srgb, var(--muted) 62%, transparent);
    stroke-width: 1.5;
  }
  .graph-node {
    position: absolute;
    display: grid;
    min-width: 0;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: auto auto 1fr;
    align-content: start;
    padding: 0.3rem 0.45rem;
    gap: 0.12rem 0.4rem;
    overflow: hidden;
    border: 1px solid var(--divider);
    border-radius: var(--radius-sm);
    color: var(--text);
    background: var(--surface-raised);
    text-align: start;
    box-shadow: 0 2px 7px color-mix(in srgb, var(--shadow) 13%, transparent);
  }
  .graph-node:hover,
  .graph-node.selected {
    border-color: color-mix(in srgb, var(--accent) 60%, var(--divider));
  }
  .graph-node:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .graph-node strong,
  .graph-node span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .graph-node strong {
    grid-column: 1 / -1;
    font-size: 0.76rem;
  }
  .graph-relation {
    grid-column: 1 / -1;
    color: var(--muted);
    font-family: var(--table-font-family);
    font-size: 0.68rem;
  }
  .graph-estimate,
  .graph-band,
  .tree-band {
    align-self: end;
    font-size: 0.64rem;
  }
  .graph-estimate {
    color: var(--muted);
  }
  .graph-band,
  .tree-band {
    color: var(--text);
    font-weight: 650;
  }
  .graph-node[data-hotspot-band='middle'],
  .plan-node[data-hotspot-band='middle'] {
    border-color: color-mix(in srgb, var(--warning) 45%, var(--divider));
    background: color-mix(in srgb, var(--warning) 10%, var(--surface-raised));
  }
  .graph-node[data-hotspot-band='upper'],
  .plan-node[data-hotspot-band='upper'] {
    border-color: color-mix(in srgb, var(--warning) 72%, var(--divider));
    background: color-mix(in srgb, var(--warning) 22%, var(--surface-raised));
  }
  .node-inspector {
    display: block;
    width: min(21rem, 38%);
    min-width: 15rem;
    overflow: auto;
    border-inline-start: 1px solid var(--divider);
    background: var(--surface-raised);
  }
  .inspector-heading {
    position: sticky;
    top: 0;
    z-index: 1;
    justify-content: space-between;
    padding: 0.55rem 0.65rem;
    gap: 0.5rem;
    border-bottom: 1px solid var(--divider);
    background: var(--surface-raised);
    font-size: 0.74rem;
  }
  .inspector-heading span {
    color: var(--muted);
    font-family: var(--table-font-family);
    font-size: 0.67rem;
  }
  .inspector-ranking {
    display: grid;
    padding: 0.5rem 0.65rem;
    border-bottom: 1px solid var(--divider);
    background: color-mix(in srgb, var(--warning) 6%, transparent);
    gap: 0.15rem;
    font-size: 0.68rem;
  }
  .inspector-ranking span,
  .inspector-ranking small {
    color: var(--muted);
  }
  .node-inspector dl {
    margin: 0;
    padding: 0.35rem 0.65rem 0.65rem;
  }
  .node-inspector dl div {
    display: grid;
    grid-template-columns: minmax(5.5rem, 0.38fr) minmax(0, 1fr);
    padding: 0.3rem 0;
    gap: 0.55rem;
    border-bottom: 1px solid color-mix(in srgb, var(--divider) 65%, transparent);
    font-size: 0.68rem;
  }
  .node-inspector dt {
    color: var(--muted);
  }
  .node-inspector dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
  .plan-tree {
    padding: 0.55rem;
  }
  .plan-node {
    display: grid;
    grid-template-columns: 0.8rem minmax(0, 1fr);
    margin-inline-start: calc(var(--plan-depth) * 1.15rem);
    padding: 0.42rem 0.45rem;
    gap: 0.35rem;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
  }
  .plan-node + .plan-node {
    margin-block-start: 0.2rem;
  }
  .plan-node:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .node-branch {
    width: 0.55rem;
    height: 0.55rem;
    margin-block-start: 0.28rem;
    border: 1px solid var(--accent);
    border-radius: 50%;
    background: var(--surface-raised);
  }
  .node-content {
    min-width: 0;
  }
  .node-title {
    flex-wrap: wrap;
    gap: 0.3rem 0.55rem;
  }
  .node-title strong {
    font-size: 0.8rem;
  }
  .node-title .node-relation {
    color: var(--text);
    font-family: var(--table-font-family);
    font-size: 0.74rem;
  }
  .node-title span,
  .node-condition {
    color: var(--muted);
    font-size: 0.74rem;
    overflow-wrap: anywhere;
  }
  .node-title .tree-band {
    margin-inline-start: auto;
    color: var(--text);
    font-size: 0.64rem;
  }
  .node-facts {
    margin: 0.35rem 0 0;
    flex-wrap: wrap;
    gap: 0.25rem 0.65rem;
  }
  .node-facts div {
    display: inline-flex;
    min-width: 0;
    gap: 0.25rem;
    font-size: 0.72rem;
  }
  .node-facts dt {
    color: var(--muted);
  }
  .node-facts dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .node-condition {
    margin: 0.35rem 0 0;
  }
  .node-condition span {
    margin-inline-end: 0.35rem;
    color: var(--text);
    font-weight: 650;
  }
  .plan-raw {
    margin: 0;
    padding: 0.35rem 0.55rem;
    color: var(--text);
    font:
      0.76rem/1.5 ui-monospace,
      SFMono-Regular,
      Consolas,
      monospace;
    white-space: pre;
    resize: none;
  }

  @media (max-width: 780px) {
    .hotspot-summary {
      grid-template-columns: 1fr;
    }
    .hotspot-legend {
      justify-content: start;
    }
    .plan-graph-view {
      flex-direction: column;
      overflow: auto;
    }
    .graph-panel {
      min-height: 11rem;
      flex: 0 0 11rem;
    }
    .node-inspector {
      width: auto;
      min-width: 0;
      max-height: 18rem;
      flex: 0 0 auto;
      border-block-start: 1px solid var(--divider);
      border-inline-start: 0;
    }
  }

  @media (forced-colors: active) {
    .node-branch,
    .hotspot-legend i,
    .graph-node[data-hotspot-band],
    .plan-node[data-hotspot-band] {
      border-color: Highlight;
    }
    .graph-band,
    .tree-band {
      text-decoration: underline;
    }
  }
</style>
