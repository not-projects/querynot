<script lang="ts">
  import { tick } from 'svelte';
  import type { Attachment } from 'svelte/attachments';

  import type { HistoryEntryView } from '../generated/contracts';
  import Icon from './Icon.svelte';

  interface Props {
    entries: HistoryEntryView[];
    search: string;
    warning: string | null;
    clearConfirmation: boolean;
    onsearchchange: (value: string) => void;
    onsearch: () => void;
    onreopen: (entry: HistoryEntryView) => void;
    ondelete: (entry: HistoryEntryView) => void;
    onrequestclear: () => void;
    onkeep: () => void;
    onclear: () => void;
    onclose: () => void;
  }

  let {
    entries,
    search,
    warning,
    clearConfirmation,
    onsearchchange,
    onsearch,
    onreopen,
    ondelete,
    onrequestclear,
    onkeep,
    onclear,
    onclose
  }: Props = $props();

  let drawerElement: HTMLElement | undefined;

  const captureDrawer: Attachment<HTMLElement> = (element) => {
    drawerElement = element;
    void tick().then(() =>
      element.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
    );
    return () => {
      if (drawerElement === element) drawerElement = undefined;
    };
  };

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose();
      return;
    }
    if (event.key !== 'Tab' || !drawerElement) return;
    const focusable = Array.from(
      drawerElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
</script>

<div class="history-overlay">
  <button
    type="button"
    class="history-scrim"
    aria-label="Close query history"
    onclick={onclose}
  ></button>
  <div
    id="history-drawer"
    class="history-drawer"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-labelledby="history-drawer-heading"
    {@attach captureDrawer}
    onkeydown={handleKeydown}
  >
    <header>
      <div>
        <p class="eyebrow">Local execution record</p>
        <h2 id="history-drawer-heading">History</h2>
      </div>
      <button
        type="button"
        class="close-button"
        aria-label="Close query history"
        onclick={onclose}><Icon name="close" /></button
      >
    </header>

    <form
      class="history-search"
      onsubmit={(event) => {
        event.preventDefault();
        onsearch();
      }}
    >
      <label>
        <span class="sr-only">Search local query history</span>
        <input
          type="search"
          placeholder="Search SQL or metadata"
          value={search}
          oninput={(event) =>
            onsearchchange((event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <button type="submit">Search</button>
    </form>

    <div class="history-content">
      {#if warning}<p class="history-warning" role="status">{warning}</p>{/if}

      <ul class="history-list">
        {#each entries as entry (entry.id)}
          <li>
            <button
              type="button"
              class="history-main"
              onclick={() => onreopen(entry)}
            >
              <strong>{entry.status} · {entry.profile_label}</strong>
              <code>{entry.sql.slice(0, 160)}</code>
              <small>
                {new Date(entry.timestamp_ms).toLocaleString()} · {entry.duration_ms}
                ms · {entry.received_rows} rows
              </small>
            </button>
            <button
              type="button"
              class="history-delete"
              aria-label={`Delete history entry from ${new Date(entry.timestamp_ms).toLocaleString()}`}
              onclick={() => ondelete(entry)}
              ><Icon name="close" size={14} /></button
            >
          </li>
        {/each}
      </ul>

      {#if entries.length === 0}
        <p class="history-empty">No matching local history entries.</p>
      {/if}
    </div>

    <div class="history-footer">
      {#if clearConfirmation}
        <div class="confirm-strip" role="alert">
          <span>Clear all active local history entries?</span>
          <button type="button" onclick={onkeep}>Keep</button>
          <button type="button" onclick={onclear}>Clear</button>
        </div>
      {:else}
        <button type="button" class="clear-button" onclick={onrequestclear}>
          Clear all history…
        </button>
      {/if}
      <p>
        History never stores result rows, credentials, certificate contents,
        staged edits, or raw driver logs. Backup and storage-forensics deletion
        is outside QueryNot’s guarantee.
      </p>
    </div>
  </div>
</div>

<style>
  .history-overlay {
    position: absolute;
    z-index: 60;
    inset: 0;
    overflow: hidden;
  }

  .history-scrim {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: rgb(8 20 17 / 32%);
  }

  .history-drawer {
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;
    display: grid;
    width: min(26rem, calc(100% - 1.5rem));
    min-width: 0;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    padding: 1rem;
    gap: 0.75rem;
    overflow: hidden;
    border-inline-start: 1px solid var(--divider);
    color: var(--text);
    background: var(--surface-raised);
    box-shadow: var(--shadow);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    margin-block-start: 0.15rem;
    font-size: 1.05rem;
  }

  .eyebrow {
    color: var(--accent);
    font-size: 0.64rem;
    font-weight: 750;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }

  .close-button {
    width: 2rem;
    min-height: 2rem;
    padding: 0;
    border: 0;
    color: var(--muted);
    background: transparent;
    font-size: 1.1rem;
  }

  .history-search {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.4rem;
  }

  .history-search input {
    width: 100%;
    min-height: 2rem;
  }

  .history-warning,
  .history-empty {
    color: var(--muted);
    font-size: 0.68rem;
    line-height: 1.4;
  }

  .history-content {
    display: grid;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: 0.5rem;
  }

  .history-list {
    display: grid;
    min-height: 0;
    margin: 0;
    padding: 0;
    align-content: start;
    gap: 0.2rem;
    overflow: auto;
    list-style: none;
  }

  .history-list li {
    display: grid;
    min-width: 0;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    padding-block: 0.25rem;
    border-bottom: 1px solid var(--divider);
  }

  .history-main {
    display: grid;
    min-width: 0;
    min-height: 0;
    padding: 0.45rem 0.5rem;
    gap: 0.25rem;
    border: 0;
    text-align: left;
    background: transparent;
  }

  .history-main:hover,
  .history-main:focus-visible {
    background: var(--surface-subtle);
  }

  .history-main strong,
  .history-main code,
  .history-main small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-main strong {
    font-size: 0.72rem;
  }

  .history-main code,
  .history-main small {
    color: var(--muted);
    font-size: 0.65rem;
  }

  .history-delete {
    width: 1.8rem;
    min-height: 1.8rem;
    padding: 0;
    border: 0;
    color: var(--muted);
    background: transparent;
  }

  .history-footer {
    display: grid;
    padding-block-start: 0.7rem;
    gap: 0.65rem;
    border-block-start: 1px solid var(--divider);
  }

  .history-footer > p {
    color: var(--muted);
    font-size: 0.65rem;
    line-height: 1.45;
  }

  .confirm-strip {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;
    color: var(--warning);
    font-size: 0.68rem;
  }

  .clear-button {
    justify-self: start;
    color: var(--muted);
    background: transparent;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
