<script lang="ts">
  import { tick } from 'svelte';

  import type { ExplainPlanView } from '../generated/contracts';
  import Icon from './Icon.svelte';

  interface Props {
    plan: ExplainPlanView;
    view: 'tree' | 'raw';
    onviewchange: (view: 'tree' | 'raw') => void;
    oncopyraw: () => void;
  }

  let { plan, view, onviewchange, oncopyraw }: Props = $props();

  const rawDisplay = $derived.by(() => {
    if (!['json', 'sqlite_query_plan_rows'].includes(plan.raw_format)) {
      return plan.raw_payload;
    }
    try {
      return JSON.stringify(JSON.parse(plan.raw_payload));
    } catch {
      return plan.raw_payload;
    }
  });

  function facts(node: ExplainPlanView['nodes'][number]) {
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

  function displayedDetail(node: ExplainPlanView['nodes'][number]) {
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
    if (
      warning.includes('SQLite documents EXPLAIN QUERY PLAN output as unstable')
    ) {
      return 'SQLite plan shapes can change between versions. Raw keeps the exact engine output.';
    }
    return warning;
  }

  async function handleTabKeydown(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tablist = (event.currentTarget as HTMLElement).closest<HTMLElement>(
      '[role="tablist"]'
    );
    if (!tablist) return;
    const next =
      event.key === 'End' ||
      (event.key === 'ArrowRight' && view === 'tree') ||
      (event.key === 'ArrowLeft' && view === 'tree')
        ? 'raw'
        : plan.nodes.length
          ? 'tree'
          : 'raw';
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
    {#if view === 'raw'}
      <button type="button" class="copy-raw" onclick={oncopyraw}>
        <Icon name="copy" size={13} />Copy raw
      </button>
    {/if}
  </div>

  {#if view === 'tree' && plan.nodes.length}
    <div class="plan-tree" role="tree" aria-label="Estimated query plan nodes">
      {#each plan.nodes as node, index (node.id)}
        <div
          class="plan-node"
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
            {#if node.condition}
              <p class="node-condition">
                <span>Condition</span>{node.condition}
              </p>
            {/if}
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
    gap: 0.65rem;
    padding: 0 0.9rem 0.9rem;
    overflow: hidden;
  }

  .plan-summary,
  .plan-view-actions,
  .node-title,
  .node-facts {
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

  .copy-raw {
    display: inline-flex;
    min-height: 2rem;
    align-items: center;
    padding: 0.35rem 0.6rem;
    gap: 0.35rem;
    border: 0;
    border-radius: 0;
    color: var(--muted);
    background: transparent;
    font-size: 0.7rem;
  }

  .copy-raw:hover:not(:disabled) {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 7%, transparent);
  }

  .plan-tree,
  .plan-raw {
    width: 100%;
    min-height: 0;
    flex: 1 1 auto;
    overflow: auto;
    border: 1px solid var(--divider);
    border-radius: var(--radius-sm);
    background: var(--surface-subtle);
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

  .node-facts {
    flex-wrap: wrap;
    margin: 0.35rem 0 0;
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

  @media (forced-colors: active) {
    .node-branch {
      border-color: Highlight;
    }
  }
</style>
