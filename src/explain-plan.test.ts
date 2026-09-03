// @vitest-environment jsdom

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ExplainInfoPopover from './lib/components/ExplainInfoPopover.svelte';
import ExplainPlan from './lib/components/ExplainPlan.svelte';
import type {
  ExplainPlanNodeView,
  ExplainPlanView
} from './lib/generated/contracts';

let mounted: ReturnType<typeof mount> | null = null;

afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = null;
  document.body.innerHTML = '';
});

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
    relation: `relation_${id}`,
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

function plan(nodes: ExplainPlanNodeView[]): ExplainPlanView {
  return {
    engine: 'PostgreSQL',
    exact_version: '18.6',
    context: 'public',
    raw_format: 'json',
    raw_payload: '[{"Plan":{"Node Type":"Fixture"}}]',
    normalization_status: 'normalized',
    warnings: [],
    nodes
  };
}

describe('Graph-first Explain', () => {
  it('renders the graph, textual estimates, inspector, zoom bounds, and hierarchy navigation', async () => {
    const onviewchange = vi.fn();
    mounted = mount(ExplainPlan, {
      target: document.body,
      props: {
        plan: plan([
          node(1, null, { operation: 'Nested Loop', total_cost: '20.0' }),
          node(2, 1, {
            operation: 'Index Scan',
            total_cost: '2.0',
            condition: 'id = 4'
          }),
          node(3, 1, {
            operation: 'Seq Scan',
            total_cost: '80.0',
            detail: 'full detail'
          })
        ]),
        view: 'graph',
        hotspotEstimatesEnabled: true,
        onviewchange,
        oncopyraw: () => undefined
      }
    });
    flushSync();

    expect(
      [...document.querySelectorAll('[role="tab"]')].map(
        (tab) => tab.textContent
      )
    ).toEqual(['Graph', 'Tree', 'Raw']);
    expect(
      document.querySelector('[role="tab"]')?.getAttribute('aria-selected')
    ).toBe('true');
    expect(
      document
        .querySelector('.hotspot-summary')
        ?.textContent?.replace(/\s+/g, ' ')
    ).toContain('Total cost · 3 of 3 nodes');
    expect(
      document
        .querySelector('.hotspot-summary')
        ?.textContent?.replace(/\s+/g, ' ')
    ).toContain('Upper quartile');
    expect(document.querySelectorAll('.graph-node')).toHaveLength(3);
    expect(
      document.querySelector('.graph-node[data-hotspot-band="upper"]')
        ?.textContent
    ).toContain('Upper quartile');

    const root = document.querySelector<HTMLElement>(
      '[data-plan-node-id="1"]'
    )!;
    root.focus();
    root.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
    expect(document.activeElement?.getAttribute('data-plan-node-id')).toBe('2');
    expect(document.querySelector('.node-inspector')?.textContent).toContain(
      'id = 4'
    );
    expect(document.querySelector('.node-inspector')?.textContent).toContain(
      'Detail'
    );

    const zoomIn = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Zoom in"]'
    )!;
    for (let count = 0; count < 6; count += 1) zoomIn.click();
    flushSync();
    expect(
      document.querySelector('button[aria-label="Reset zoom"]')?.textContent
    ).toBe('150%');
    expect(zoomIn.disabled).toBe(true);

    const graphTab = [
      ...document.querySelectorAll<HTMLElement>('[role="tab"]')
    ][0];
    graphTab.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onviewchange).toHaveBeenCalledWith('tree');
  });

  it('disables Graph with explicit complete-view fallback copy above 250 nodes', () => {
    mounted = mount(ExplainPlan, {
      target: document.body,
      props: {
        plan: plan(
          Array.from({ length: 251 }, (_, index) => node(index, null))
        ),
        view: 'tree',
        hotspotEstimatesEnabled: false,
        onviewchange: () => undefined,
        oncopyraw: () => undefined
      }
    });
    flushSync();

    expect(
      document.querySelector<HTMLButtonElement>('[role="tab"]')?.disabled
    ).toBe(true);
    expect(
      document
        .querySelector('.graph-unavailable')
        ?.textContent?.replace(/\s+/g, ' ')
    ).toContain('Tree and Raw retain the complete plan');
  });
});

describe('Explain information popover', () => {
  it('describes the local estimate boundary and restores trigger focus before opening Settings', async () => {
    let activeElementWhenOpened: Element | null = null;
    mounted = mount(ExplainInfoPopover, {
      target: document.body,
      props: {
        hotspotEstimatesEnabled: false,
        onopensettings: () => {
          activeElementWhenOpened = document.activeElement;
        }
      }
    });
    flushSync();

    const trigger = document.querySelector<HTMLButtonElement>(
      'button[aria-label="About Explain and hotspot estimates"]'
    )!;
    trigger.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
    expect(
      document
        .querySelector('[role="dialog"]')
        ?.textContent?.replace(/\s+/g, ' ')
    ).toContain('without executing the source statement');
    expect(
      document
        .querySelector('[role="dialog"]')
        ?.textContent?.replace(/\s+/g, ' ')
    ).toContain('cannot predict elapsed time');

    document.querySelector<HTMLButtonElement>('.settings-action')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
    expect(activeElementWhenOpened).toBe(trigger);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
