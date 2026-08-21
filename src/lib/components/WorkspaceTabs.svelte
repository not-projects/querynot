<script lang="ts">
  import { tick } from 'svelte';
  import type { Attachment } from 'svelte/attachments';

  import type { SessionView, WorkspaceTabView } from '../generated/contracts';

  interface Props {
    tabs: WorkspaceTabView[];
    activeTabId: string | null;
    groupLabel: string;
    sessions: Record<string, SessionView>;
    sessionOpening: Record<string, boolean>;
    sessionErrors: Record<string, string>;
    onnewquery: () => void;
    onactivatetab: (tab: WorkspaceTabView) => void;
    onclosetab: (tab: WorkspaceTabView) => void;
    onrenametab: (tab: WorkspaceTabView, title: string) => void;
    onduplicatetab: (tab: WorkspaceTabView) => void;
    onpintab: (tab: WorkspaceTabView) => void;
    onmovetab: (tab: WorkspaceTabView, direction: -1 | 1) => void;
  }

  let {
    tabs,
    activeTabId,
    groupLabel,
    sessions,
    sessionOpening,
    sessionErrors,
    onnewquery,
    onactivatetab,
    onclosetab,
    onrenametab,
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

  function sessionLabel(tab: WorkspaceTabView) {
    if (sessionOpening[tab.id]) return 'Opening dedicated session';
    if (sessions[tab.id]) return 'Dedicated session online';
    if (sessionErrors[tab.id]) return 'Session open failed';
    return tab.profile_id ? 'Tab offline' : 'Offline draft';
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
    {#each tabs as tab (tab.id)}
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
          <span class="tab-indicators">
            {#if tab.pinned}<span aria-label="Pinned tab">◆</span>{/if}
            {#if tab.kind === 'table_data'}<span aria-label="Table-data tab"
                >▦</span
              >{/if}
            {#if tab.dirty}<span aria-label="Unsaved draft">●</span>{/if}
            <span
              class:online={Boolean(sessions[tab.id])}
              class:error={Boolean(sessionErrors[tab.id])}
              class:opening={Boolean(sessionOpening[tab.id])}
              class="tab-session"
              aria-label={sessionLabel(tab)}
              title={sessionLabel(tab)}
              >{sessionOpening[tab.id]
                ? '◌'
                : sessions[tab.id]
                  ? '●'
                  : sessionErrors[tab.id]
                    ? '!'
                    : '○'}</span
            >
          </span>
        </button>

        <details class="tab-overflow">
          <summary aria-label={`More actions for ${tab.title}`}>⋯</summary>
          <div>
            <label>
              <span>Rename</span>
              <input
                value={tab.title}
                maxlength="256"
                aria-label={`Rename ${tab.title}`}
                onchange={(event) =>
                  onrenametab(
                    tab,
                    (event.currentTarget as HTMLInputElement).value
                  )}
              />
            </label>
            <button type="button" onclick={() => onpintab(tab)}
              >{tab.pinned ? 'Unpin' : 'Pin'}</button
            >
            {#if tab.kind === 'query'}
              <button type="button" onclick={() => onduplicatetab(tab)}
                >Duplicate</button
              >
            {/if}
            <button type="button" onclick={() => onmovetab(tab, -1)}
              >Move left</button
            >
            <button type="button" onclick={() => onmovetab(tab, 1)}
              >Move right</button
            >
          </div>
        </details>

        <button
          type="button"
          class="tab-close"
          aria-label={`Close ${tab.title}`}
          onclick={() => onclosetab(tab)}>×</button
        >
      </div>
    {/each}
  </div>

  <button
    type="button"
    class="new-tab"
    aria-label={`New query in ${groupLabel}`}
    title={`New query in ${groupLabel}`}
    onclick={onnewquery}>+</button
  >
</div>

<style>
  .workspace-tab-strip {
    display: flex;
    min-width: 0;
    min-height: 2.35rem;
    align-items: end;
    padding: 0.25rem 0.5rem 0;
    gap: 0.25rem;
    overflow: hidden;
    border-bottom: 1px solid var(--divider);
    background: var(--surface-subtle);
  }

  .workspace-tabs {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: end;
    gap: 0.2rem;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .workspace-tab-item {
    display: flex;
    min-width: 8.5rem;
    max-width: 17rem;
    height: 2rem;
    flex: 0 1 13rem;
    align-items: center;
    border: 1px solid transparent;
    border-bottom: 0;
    border-radius: 6px 6px 0 0;
    background: transparent;
  }

  .workspace-tab-item:hover,
  .workspace-tab-item:focus-within {
    border-color: var(--divider);
    background: color-mix(in srgb, var(--surface-raised) 64%, transparent);
  }

  .workspace-tab-item.active {
    border-color: var(--divider);
    background: var(--surface-raised);
    box-shadow: inset 0 2px var(--accent);
  }

  .workspace-tab-main {
    display: flex;
    min-width: 0;
    min-height: 1.9rem;
    flex: 1;
    align-items: center;
    justify-content: space-between;
    padding: 0.25rem 0.4rem 0.2rem 0.5rem;
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
    gap: 0.2rem;
    color: var(--muted);
    font-size: 0.56rem;
  }

  .tab-session {
    display: inline-grid;
    width: 0.75rem;
    height: 0.75rem;
    place-items: center;
  }

  .tab-session.online {
    color: var(--accent);
  }

  .tab-session.error {
    color: var(--danger);
    font-weight: 800;
  }

  .tab-session.opening {
    color: var(--accent);
  }

  details {
    position: relative;
  }

  summary,
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

  summary {
    width: 1.55rem;
    list-style: none;
    cursor: pointer;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  details > div {
    position: fixed;
    z-index: 35;
    display: grid;
    width: 10rem;
    margin-block-start: 0.15rem;
    padding: 0.4rem;
    gap: 0.25rem;
    border: 1px solid var(--divider);
    border-radius: 6px;
    background: var(--surface-raised);
    box-shadow: var(--shadow);
  }

  details label {
    display: grid;
    gap: 0.2rem;
    color: var(--muted);
    font-size: 0.62rem;
  }

  details input,
  details button {
    width: 100%;
  }

  .tab-close {
    width: 1.45rem;
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
