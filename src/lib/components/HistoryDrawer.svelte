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

  function statusKey(status: string) {
    return status
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
  }

  function statusLabel(status: string) {
    return status.length > 0
      ? `${status.charAt(0).toUpperCase()}${status.slice(1)}`
      : 'Unknown';
  }

  function rowCountLabel(count: number) {
    return `${count} ${count === 1 ? 'row' : 'rows'}`;
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
      <div class="history-heading-copy">
        <div class="history-title-line">
          <Icon name="history" size={16} />
          <h2 id="history-drawer-heading">History</h2>
        </div>
        <p>Queries and Explain outcomes saved on this device</p>
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
      <label class="history-search-field">
        <span class="sr-only">Search local query history</span>
        <Icon name="search" size={14} />
        <input
          type="search"
          placeholder="Search SQL or metadata"
          value={search}
          oninput={(event) =>
            onsearchchange((event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <button type="submit" class="history-search-button">Search</button>
    </form>

    <div class="history-content">
      {#if warning}<p class="history-warning" role="status">{warning}</p>{/if}

      <ul class="history-list">
        {#each entries as entry (entry.id)}
          <li>
            <button
              type="button"
              class="history-main"
              aria-label={`Open ${entry.status} ${entry.operation_kind} from ${entry.profile_label}`}
              onclick={() => onreopen(entry)}
            >
              <span class="history-entry-heading">
                <strong>
                  {#if entry.operation_kind === 'explain'}
                    <span class="history-operation">Explain</span>
                  {/if}
                  {entry.profile_label}
                </strong>
                <span
                  class="history-status"
                  data-status={statusKey(entry.status)}
                >
                  <span aria-hidden="true"></span>
                  {statusLabel(entry.status)}
                </span>
              </span>
              <code>{entry.sql.slice(0, 160)}</code>
              <span class="history-metadata">
                <time datetime={new Date(entry.timestamp_ms).toISOString()}>
                  {new Date(entry.timestamp_ms).toLocaleString()}
                </time>
                <span>{entry.duration_ms} ms</span>
                <span>
                  {entry.operation_kind === 'explain'
                    ? entry.status === 'succeeded'
                      ? 'Plan generated'
                      : 'No plan stored'
                    : rowCountLabel(entry.received_rows)}
                </span>
              </span>
              <span class="history-open-label">
                Open query
                <Icon name="arrow-right" size={13} />
              </span>
            </button>
            <button
              type="button"
              class="history-delete"
              aria-label={`Delete history entry from ${new Date(entry.timestamp_ms).toLocaleString()}`}
              onclick={() => ondelete(entry)}
              ><Icon name="trash" size={14} /></button
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
          <span>
            <strong>Clear all history?</strong>
            This removes every active local entry from QueryNot.
          </span>
          <span class="confirm-actions">
            <button type="button" onclick={onkeep}>Keep</button>
            <button type="button" class="danger" onclick={onclear}>Clear</button
            >
          </span>
        </div>
      {:else}
        <button type="button" class="clear-button" onclick={onrequestclear}>
          <Icon name="trash" size={14} />
          Clear all history…
        </button>
      {/if}
      <details class="history-privacy">
        <summary>Stored locally · SQL and metadata only</summary>
        <p>
          History never stores result rows, query-plan payloads, credentials,
          certificate contents, staged edits, or raw driver logs. Backup and
          storage-forensics deletion is outside QueryNot’s guarantee.
        </p>
      </details>
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
    background: rgb(8 20 17 / 42%);
  }

  .history-drawer {
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;
    display: grid;
    width: min(29rem, calc(100% - 1rem));
    min-width: 0;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    padding: 0;
    gap: 0;
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
    min-height: 4rem;
    padding: 0.8rem 1rem 0.7rem;
    gap: 1rem;
    border-block-end: 1px solid var(--divider);
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 1rem;
    letter-spacing: -0.01em;
  }

  .history-heading-copy {
    display: grid;
    gap: 0.18rem;
  }

  .history-heading-copy > p {
    color: var(--muted);
    font-size: 0.64rem;
  }

  .history-title-line {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--text);
  }

  .close-button {
    width: 1.9rem;
    min-height: 1.9rem;
    padding: 0;
    border: 0;
    color: var(--muted);
    background: transparent;
    font-size: 1.1rem;
  }

  .history-search {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    padding: 0.75rem 1rem;
    gap: 0.45rem;
    border-block-end: 1px solid var(--divider);
  }

  .history-search-field {
    position: relative;
    display: flex;
    min-width: 0;
    align-items: center;
  }

  .history-search-field > :global(svg) {
    position: absolute;
    z-index: 1;
    inset-inline-start: 0.65rem;
    color: var(--muted);
    pointer-events: none;
  }

  .history-search input {
    width: 100%;
    min-height: 2.05rem;
    padding-inline: 2rem 0.6rem;
  }

  .history-search-button {
    min-height: 2.05rem;
    padding: 0.3rem 0.7rem;
    color: var(--accent);
    font-size: 0.68rem;
    font-weight: 650;
  }

  .history-warning,
  .history-empty {
    color: var(--muted);
    padding: 0.75rem 0.9rem;
    font-size: 0.68rem;
    line-height: 1.4;
  }

  .history-content {
    display: grid;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr) auto;
  }

  .history-list {
    display: grid;
    min-height: 0;
    margin: 0;
    padding: 0;
    align-content: start;
    overflow: auto;
    list-style: none;
  }

  .history-list li {
    display: grid;
    min-width: 0;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    padding: 0.25rem 0.45rem 0.3rem 0.55rem;
    border-bottom: 1px solid var(--divider);
  }

  .history-main {
    display: grid;
    min-width: 0;
    min-height: 0;
    padding: 0.6rem 0.55rem;
    gap: 0.38rem;
    border: 0;
    text-align: left;
    background: transparent;
  }

  .history-main:hover,
  .history-main:focus-visible {
    background: color-mix(in srgb, var(--surface-subtle) 82%, transparent);
  }

  .history-main strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-main strong {
    min-width: 0;
    flex: 1 1 auto;
    font-size: 0.74rem;
  }

  .history-main code {
    display: -webkit-box;
    overflow: hidden;
    color: var(--muted);
    font-size: 0.66rem;
    line-height: 1.42;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .history-entry-heading {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-operation {
    display: inline-flex;
    margin-inline-end: 0.35rem;
    padding: 0.08rem 0.3rem;
    border: 1px solid var(--divider);
    border-radius: 999px;
    color: var(--accent);
    font-size: 0.56rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .history-status {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 0.28rem;
    color: var(--muted);
    font-size: 0.59rem;
    font-weight: 650;
  }

  .history-status > span {
    width: 0.38rem;
    height: 0.38rem;
    border-radius: 50%;
    background: currentColor;
  }

  .history-status[data-status='completed'],
  .history-status[data-status='succeeded'] {
    color: var(--accent);
  }

  .history-status[data-status='failed'],
  .history-status[data-status='error'] {
    color: var(--danger);
  }

  .history-status[data-status='cancelled'],
  .history-status[data-status='canceled'] {
    color: var(--warning);
  }

  .history-metadata {
    display: flex;
    min-width: 0;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.25rem;
    color: var(--muted);
    font-size: 0.6rem;
  }

  .history-metadata > * + *::before {
    margin-inline-end: 0.25rem;
    color: var(--divider);
    content: '·';
  }

  .history-open-label {
    display: inline-flex;
    width: max-content;
    align-items: center;
    gap: 0.25rem;
    color: var(--accent);
    font-size: 0.61rem;
    font-weight: 650;
  }

  .history-delete {
    width: 1.85rem;
    min-height: 1.85rem;
    margin-block-start: 0.35rem;
    padding: 0;
    border: 0;
    color: var(--muted);
    background: transparent;
  }

  .history-delete:hover:not(:disabled),
  .history-delete:focus-visible {
    border-color: transparent;
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 9%, transparent);
  }

  .history-footer {
    display: grid;
    padding: 0.75rem 1rem 0.85rem;
    gap: 0.55rem;
    border-block-start: 1px solid var(--divider);
  }

  .confirm-strip {
    display: grid;
    padding: 0.6rem;
    gap: 0.55rem;
    border: 1px solid color-mix(in srgb, var(--warning) 38%, var(--divider));
    border-radius: 5px;
    background: color-mix(in srgb, var(--warning) 7%, transparent);
    color: var(--warning);
    font-size: 0.68rem;
    line-height: 1.4;
  }

  .confirm-strip > span:first-child {
    display: grid;
    gap: 0.12rem;
  }

  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
  }

  .confirm-actions button {
    min-height: 1.8rem;
    padding: 0.2rem 0.6rem;
    font-size: 0.64rem;
  }

  .clear-button {
    display: inline-flex;
    min-height: 1.8rem;
    align-items: center;
    justify-self: start;
    padding: 0.25rem 0.45rem;
    gap: 0.35rem;
    border-color: transparent;
    color: var(--danger);
    background: transparent;
    font-size: 0.64rem;
  }

  .clear-button:hover:not(:disabled) {
    border-color: transparent;
    background: color-mix(in srgb, var(--danger) 8%, transparent);
  }

  .history-privacy {
    color: var(--muted);
    font-size: 0.62rem;
    line-height: 1.45;
  }

  .history-privacy summary {
    width: max-content;
    color: var(--muted);
    cursor: pointer;
  }

  .history-privacy p {
    margin-block-start: 0.4rem;
  }
</style>
