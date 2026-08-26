<script lang="ts">
  import { tick } from 'svelte';
  import type { Attachment } from 'svelte/attachments';

  import type { WorkspaceTabView } from '../generated/contracts';
  import ActionMenu, { type ActionMenuItem } from './ActionMenu.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    tabs: WorkspaceTabView[];
    activeTabId: string | null;
    groupLabel: string;
    sessionOpening: Record<string, boolean>;
    sessionErrors: Record<string, string>;
    onnewquery: () => void;
    onactivatetab: (tab: WorkspaceTabView) => void;
    onclosetab: (tab: WorkspaceTabView) => void;
    onrequestrename: (tab: WorkspaceTabView) => void;
    onduplicatetab: (tab: WorkspaceTabView) => void;
    onpintab: (tab: WorkspaceTabView) => void;
    onmovetab: (tab: WorkspaceTabView, direction: -1 | 1) => void;
  }

  let {
    tabs,
    activeTabId,
    groupLabel,
    sessionOpening,
    sessionErrors,
    onnewquery,
    onactivatetab,
    onclosetab,
    onrequestrename,
    onduplicatetab,
    onpintab,
    onmovetab
  }: Props = $props();

  let tabList: HTMLElement | undefined;

  const captureTabList: Attachment<HTMLElement> = (element) => {
    tabList = element;
    return () => {
      if (tabList === element) tabList = undefined;
    };
  };

  function tabActionItems(
    tab: WorkspaceTabView,
    tabIndex: number
  ): ActionMenuItem[] {
    return [
      {
        id: 'rename',
        label: 'Rename tab…',
        description: 'Change the workspace label.',
        icon: 'edited'
      },
      {
        id: 'pin',
        label: tab.pinned ? 'Unpin tab' : 'Pin tab',
        description: tab.pinned
          ? 'Return it to the movable tab group.'
          : 'Keep it at the start of this group.',
        icon: 'pin'
      },
      ...(tab.kind === 'query'
        ? [
            {
              id: 'duplicate',
              label: 'Duplicate query',
              description: 'Copy this draft without its session.',
              icon: 'copy' as const
            }
          ]
        : []),
      {
        id: 'move-left',
        label: 'Move left',
        description: 'Move earlier in this group.',
        icon: 'arrow-left',
        disabled: tabIndex === 0,
        separatorBefore: true
      },
      {
        id: 'move-right',
        label: 'Move right',
        description: 'Move later in this group.',
        icon: 'arrow-right',
        disabled: tabIndex === tabs.length - 1
      }
    ];
  }

  function selectTabAction(tab: WorkspaceTabView, itemId: string) {
    if (itemId === 'rename') onrequestrename(tab);
    else if (itemId === 'pin') onpintab(tab);
    else if (itemId === 'duplicate') onduplicatetab(tab);
    else if (itemId === 'move-left') onmovetab(tab, -1);
    else if (itemId === 'move-right') onmovetab(tab, 1);
  }

  function handleTabKeydown(event: KeyboardEvent, tab: WorkspaceTabView) {
    const current = tabs.findIndex((candidate) => candidate.id === tab.id);
    if (current < 0) return;
    let next = current;
    if (event.key === 'ArrowLeft')
      next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    const nextTab = tabs[next];
    onactivatetab(nextTab);
    void tick().then(() => {
      tabList?.querySelectorAll<HTMLElement>('[role="tab"]').item(next).focus();
    });
  }
</script>

<div class="workspace-tab-strip" {@attach captureTabList}>
  <div class="workspace-tabs" role="tablist" aria-label={`${groupLabel} tabs`}>
    {#each tabs as tab, tabIndex (tab.id)}
      <div class:active={activeTabId === tab.id} class="workspace-tab-item">
        <button
          type="button"
          class="workspace-tab-main"
          role="tab"
          aria-selected={activeTabId === tab.id}
          tabindex={activeTabId === tab.id ? 0 : -1}
          title={tab.title}
          onclick={() => onactivatetab(tab)}
          onkeydown={(event) => handleTabKeydown(event, tab)}
        >
          <span class="tab-title">{tab.title}</span>
          {#if tab.pinned || tab.kind === 'table_data' || tab.dirty || sessionOpening[tab.id] || sessionErrors[tab.id]}
            <span class="tab-indicators">
              {#if tab.pinned}
                <span role="img" aria-label="Pinned tab"
                  ><Icon name="pin" size={12} /></span
                >
              {/if}
              {#if tab.kind === 'table_data'}
                <span role="img" aria-label="Object structure tab"
                  ><Icon name="table" size={12} /></span
                >
              {/if}
              {#if tab.dirty}
                <span
                  role="img"
                  aria-label="Unsaved changes"
                  title="Unsaved changes"
                >
                  <Icon name="edited" size={12} />
                </span>
              {/if}
              {#if sessionOpening[tab.id]}
                <span class="tab-state" title="Opening dedicated session"
                  >Opening…</span
                >
              {:else if sessionErrors[tab.id]}
                <span
                  class="tab-state error"
                  title="Dedicated session failed to open">Error</span
                >
              {/if}
            </span>
          {/if}
        </button>

        <ActionMenu
          class="tab-action-menu"
          label={`More actions for ${tab.title}`}
          menuLabel={`Actions for ${tab.title}`}
          align="start"
          heading={tab.title}
          meta={`${tab.kind === 'query' ? 'Query' : 'Object'} · ${tab.pinned ? 'Pinned' : groupLabel}`}
          items={tabActionItems(tab, tabIndex)}
          onselect={(itemId) => selectTabAction(tab, itemId)}
        />

        <button
          type="button"
          class="tab-close"
          aria-label={`Close ${tab.title}`}
          onclick={() => onclosetab(tab)}
          ><Icon name="close" size={14} /></button
        >
      </div>
    {/each}
  </div>

  <button
    type="button"
    class="new-tab"
    aria-label={`New query in ${groupLabel}`}
    title={`New query in ${groupLabel}`}
    onclick={onnewquery}><Icon name="plus" /></button
  >
</div>

<style>
  .workspace-tab-strip {
    display: flex;
    min-width: 0;
    min-height: 2.2rem;
    align-items: stretch;
    padding: 0 0.45rem;
    gap: 0.2rem;
    overflow: hidden;
    border-bottom: 1px solid var(--divider);
    background: var(--surface-subtle);
  }

  .workspace-tabs {
    display: flex;
    min-width: 0;
    max-width: calc(100% - 2.2rem);
    flex: 0 1 auto;
    align-items: stretch;
    gap: 0;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .workspace-tab-item {
    position: relative;
    display: flex;
    width: 9.25rem;
    min-width: 7rem;
    max-width: 9.25rem;
    height: 2.15rem;
    flex: 0 1 9.25rem;
    align-items: center;
    border-inline-end: 1px solid
      color-mix(in srgb, var(--divider) 72%, transparent);
    background: transparent;
  }

  .workspace-tab-item:hover,
  .workspace-tab-item:focus-within {
    background: color-mix(in srgb, var(--surface-raised) 60%, transparent);
  }

  .workspace-tab-item.active {
    background: var(--surface-raised);
    box-shadow: inset 0 -2px var(--accent);
  }

  .workspace-tab-main {
    display: flex;
    min-width: 0;
    min-height: 1.9rem;
    flex: 1;
    align-items: center;
    justify-content: flex-start;
    padding: 0.25rem 2.85rem 0.2rem 0.5rem;
    gap: 0.4rem;
    border: 0;
    background: transparent;
    font-size: 0.68rem;
  }

  .tab-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-indicators {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    margin-left: auto;
    gap: 0.2rem;
    color: var(--muted);
    font-size: 0.56rem;
  }

  .tab-state {
    color: var(--accent);
    font-size: 0.58rem;
    font-weight: 700;
  }

  .tab-state.error {
    color: var(--danger);
  }

  .workspace-tab-item > :global(.tab-action-menu) {
    position: absolute;
    right: 1.35rem;
  }

  .tab-close,
  .new-tab {
    display: grid;
    min-height: 1.75rem;
    padding: 0;
    place-items: center;
    border: 0;
    color: var(--muted);
    background: transparent;
  }

  .workspace-tab-item :global(.tab-action-menu .action-menu-trigger) {
    width: 1.55rem;
    min-width: 1.55rem;
  }

  .tab-close {
    position: absolute;
    right: 0;
    width: 1.35rem;
  }

  .workspace-tab-item > :global(.tab-action-menu),
  .tab-close {
    opacity: 0;
  }

  .workspace-tab-item:hover > :global(.tab-action-menu),
  .workspace-tab-item:focus-within > :global(.tab-action-menu),
  .workspace-tab-item > :global(.tab-action-menu.open),
  .workspace-tab-item:hover .tab-close,
  .workspace-tab-item:focus-within .tab-close,
  .workspace-tab-item.active .tab-close {
    opacity: 1;
  }

  .new-tab {
    width: 2rem;
    min-width: 2rem;
    margin-block-end: 0.15rem;
    border: 1px solid transparent;
    border-radius: 5px;
    color: var(--accent);
    font-size: 1rem;
  }

  .new-tab:hover,
  .new-tab:focus-visible {
    border-color: var(--divider);
    background: var(--surface-raised);
  }
</style>
