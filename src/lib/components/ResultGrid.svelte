<script lang="ts">
  import type {
    ResultColumnView,
    ResultRowView,
    TaggedValueView
  } from '../generated/contracts';
  import Icon from './Icon.svelte';

  interface Props {
    resultSetId: string;
    statementIndex: number;
    columns: ResultColumnView[];
    rows: ResultRowView[];
    capped: boolean;
    paused: boolean;
    terminalState: string | null;
    durationMs: number | null;
    onloadmore: () => void;
    ondiscard: () => void;
    onexport: (
      format: 'csv' | 'json',
      currentView: boolean,
      nullToken: string
    ) => void;
    onviewchange: (resultSetId: string, indexes: number[]) => void;
    onstatus: (message: string) => void;
  }

  let {
    resultSetId,
    statementIndex,
    columns,
    rows,
    capped,
    paused,
    terminalState,
    durationMs,
    onloadmore,
    ondiscard,
    onexport,
    onviewchange,
    onstatus
  }: Props = $props();

  let filterText = $state('');
  let sortColumn = $state<number | null>(null);
  let sortDirection = $state<1 | -1>(1);
  let selectedRows = $state<number[]>([]);
  let scrollTop = $state(0);
  let scrollLeft = $state(0);
  let viewportHeight = $state(320);
  let widths = $state<Record<number, number>>({});
  let nullToken = $state('\\N');
  let selectedCell = $state<TaggedValueView | null>(null);
  let openedLargeValue = $state<string | null>(null);
  const rowHeight = 34;
  const overscan = 8;
  const maxCellPreview = 512;

  const viewIndexes = $derived.by(() => {
    const query = filterText.toLocaleLowerCase();
    const indexes = rows
      .map((_, index) => index)
      .filter(
        (index) =>
          !query ||
          rows[index].values.some((value) =>
            canonicalText(value).toLocaleLowerCase().includes(query)
          )
      );
    const selectedSortColumn = sortColumn;
    if (selectedSortColumn !== null) {
      indexes.sort((left, right) => {
        const leftText = canonicalText(rows[left].values[selectedSortColumn]);
        const rightText = canonicalText(rows[right].values[selectedSortColumn]);
        return (
          leftText.localeCompare(rightText, undefined, {
            numeric: true,
            sensitivity: 'base'
          }) * sortDirection
        );
      });
    }
    return indexes;
  });
  const startIndex = $derived(
    Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  );
  const endIndex = $derived(
    Math.min(
      viewIndexes.length,
      Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan
    )
  );
  const renderedIndexes = $derived(viewIndexes.slice(startIndex, endIndex));
  const gridColumns = $derived(
    (columns.length
      ? columns
      : [{ name: 'Result', declared_type: '', nullable: null }]
    )
      .map((_, index) => `${widths[index] ?? 180}px`)
      .join(' ')
  );

  $effect(() => {
    onviewchange(resultSetId, [...viewIndexes]);
  });

  function handleScroll(event: Event) {
    const element = event.currentTarget as HTMLElement;
    scrollTop = element.scrollTop;
    scrollLeft = element.scrollLeft;
    viewportHeight = element.clientHeight;
  }

  function toggleSort(index: number) {
    if (sortColumn === index) sortDirection = sortDirection === 1 ? -1 : 1;
    else {
      sortColumn = index;
      sortDirection = 1;
    }
    selectedRows = [];
  }

  function toggleRow(index: number) {
    selectedRows = selectedRows.includes(index)
      ? selectedRows.filter((candidate) => candidate !== index)
      : [...selectedRows, index];
  }

  function selectCell(index: number, value: TaggedValueView) {
    selectedCell = value;
    toggleRow(index);
  }

  function resizeColumn(event: PointerEvent, index: number) {
    event.preventDefault();
    const initialX = event.clientX;
    const initialWidth = widths[index] ?? 180;
    const move = (moveEvent: PointerEvent) => {
      const next = Math.min(
        640,
        Math.max(80, initialWidth + moveEvent.clientX - initialX)
      );
      widths[index] = next;
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  }

  async function copyCell(value: TaggedValueView) {
    await writeClipboard(canonicalText(value));
    onstatus(
      'Copied one visible cell using QueryNot’s canonical raw representation.'
    );
  }

  async function copyRows(withHeaders: boolean) {
    const indexes = selectedRows.length ? selectedRows : viewIndexes;
    const lineEnding = navigator.userAgent.includes('Windows') ? '\r\n' : '\n';
    const records = indexes.map((index) =>
      rows[index].values.map(tsvField).join('\t')
    );
    if (withHeaders)
      records.unshift(columns.map((column) => column.name).join('\t'));
    await writeClipboard(records.join(lineEnding));
    onstatus(
      `Copied ${indexes.length} loaded row${indexes.length === 1 ? '' : 's'}${withHeaders ? ' with one header row' : ''}; hidden and unreceived rows were excluded.`
    );
  }

  async function writeClipboard(text: string) {
    if (!navigator.clipboard?.writeText) {
      onstatus('Clipboard access is unavailable in this desktop runtime.');
      return;
    }
    await navigator.clipboard.writeText(text);
  }

  function canonicalText(value: TaggedValueView | null | undefined): string {
    if (!value || value.value_type === 'null') return '\\N';
    if (value.value_type === 'boolean') return String(value.boolean);
    if (value.value_type === 'bytes') {
      const binary = atob(value.bytes_base64 ?? '');
      return `0x${Array.from(binary, (character) => character.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()).join('')}`;
    }
    return value.text ?? '';
  }

  function previewText(value: TaggedValueView | null | undefined): string {
    const raw = canonicalText(value);
    if (raw.length <= maxCellPreview) return raw;
    return `${raw.slice(0, maxCellPreview)}… [${raw.length} characters]`;
  }

  function tsvField(value: TaggedValueView): string {
    const raw = canonicalText(value);
    return /[\t\r\n"]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
  }
</script>

<section
  class="result-set"
  aria-label={`Result set with ${rows.length} received rows`}
>
  <div class="result-tools">
    <label>
      <span class="sr-only">Filter loaded rows</span>
      <input
        type="search"
        placeholder="Filter loaded rows"
        bind:value={filterText}
      />
    </label>
    <span class="loaded-label"
      >Loaded rows only · {viewIndexes.length}/{rows.length}</span
    >
    <button type="button" onclick={() => void copyRows(false)}>Copy rows</button
    >
    <button type="button" onclick={() => void copyRows(true)}
      >Copy with headers</button
    >
    <details class="export-options">
      <summary>Export…</summary>
      <div>
        <label class="null-token">
          <span>CSV NULL token</span>
          <input
            bind:value={nullToken}
            maxlength="64"
            aria-label="CSV null token"
          />
        </label>
        <p class="export-safety-note">
          CSV keeps raw spreadsheet-formula prefixes. NULL uses the configured
          token; binary values use hexadecimal in CSV and tagged base64 in JSON.
        </p>
        <button type="button" onclick={() => onexport('csv', false, nullToken)}
          >Server-order CSV</button
        >
        <button type="button" onclick={() => onexport('csv', true, nullToken)}
          >Current-view CSV</button
        >
        <button type="button" onclick={() => onexport('json', false, nullToken)}
          >Server-order JSON</button
        >
        <button type="button" onclick={() => onexport('json', true, nullToken)}
          >Current-view JSON</button
        >
      </div>
    </details>
  </div>

  <div class="grid-shell">
    <div class="grid-header-viewport">
      <div
        class="grid-header"
        style:grid-template-columns={gridColumns}
        style:transform={`translateX(${-scrollLeft}px)`}
        role="row"
      >
        {#each columns as column, index (`${index}-${column.name}`)}
          <div
            role="columnheader"
            title={`${column.name} · ${column.declared_type}`}
          >
            <button type="button" onclick={() => toggleSort(index)}>
              {column.name}
              {#if sortColumn === index}
                <span
                  role="img"
                  aria-label={sortDirection === 1 ? 'ascending' : 'descending'}
                >
                  <Icon
                    name={sortDirection === 1 ? 'arrow-up' : 'arrow-down'}
                    size={13}
                  />
                </span>
              {/if}
            </button>
            <button
              type="button"
              class="resize-handle"
              aria-label={`Resize ${column.name} column`}
              onpointerdown={(event) => resizeColumn(event, index)}
            ></button>
          </div>
        {/each}
      </div>
    </div>
    <div
      class="grid-viewport"
      role="grid"
      aria-rowcount={viewIndexes.length}
      aria-colcount={columns.length}
      tabindex="0"
      onscroll={handleScroll}
    >
      <div
        class="grid-canvas"
        style:height={`${viewIndexes.length * rowHeight}px`}
        style:min-width={`max(100%, ${columns.reduce((sum, _, index) => sum + (widths[index] ?? 180), 0)}px)`}
      >
        {#each renderedIndexes as rowIndex, renderedPosition (rowIndex)}
          <div
            class="grid-row"
            class:selected={selectedRows.includes(rowIndex)}
            role="row"
            aria-rowindex={startIndex + renderedPosition + 1}
            style:top={`${(startIndex + renderedPosition) * rowHeight}px`}
            style:grid-template-columns={gridColumns}
          >
            {#each rows[rowIndex].values as value, columnIndex (`${rowIndex}-${columnIndex}`)}
              <button
                type="button"
                role="gridcell"
                class:null-value={value.value_type === 'null'}
                title={previewText(value)}
                onclick={() => selectCell(rowIndex, value)}
                ondblclick={() => void copyCell(value)}
                >{previewText(value)}</button
              >
            {/each}
          </div>
        {/each}
      </div>
    </div>
  </div>

  <div class="result-footer">
    <span>
      Statement {statementIndex + 1} · {rows.length} rows retained ·
      {durationMs === null ? 'duration pending' : `${durationMs} ms`} ·
      {terminalState ?? (paused ? 'paused' : 'streaming')}
      {capped ? ' · hard cap reached; full-result export unavailable' : ''}
    </span>
    <span>Double-click copies one cell · selected rows are outlined</span>
    {#if paused}
      <span class="cursor-warning"
        >Native cursor paused; it expires after five minutes.</span
      >
      <button type="button" class="primary" onclick={onloadmore}
        >Load more</button
      >
      <button type="button" onclick={ondiscard}>Discard remainder</button>
    {/if}
    {#if selectedCell && canonicalText(selectedCell).length > maxCellPreview}
      <button
        type="button"
        onclick={() => (openedLargeValue = canonicalText(selectedCell))}
        >Open selected large value</button
      >
    {/if}
  </div>

  {#if openedLargeValue !== null}
    <div class="large-value" role="dialog" aria-label="Full cell value">
      <div>
        <strong>Full selected value</strong>
        <button type="button" onclick={() => (openedLargeValue = null)}
          >Close</button
        >
      </div>
      <pre>{openedLargeValue}</pre>
    </div>
  {/if}
</section>

<style>
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

  .result-set {
    display: grid;
    min-width: 0;
    min-height: 0;
    height: 100%;
    gap: 0.45rem;
    grid-template-rows: auto minmax(0, 1fr) auto;
    overflow: hidden;
  }

  .result-tools,
  .result-footer {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .result-tools input {
    width: 12rem;
  }

  .null-token {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--muted);
    font-size: 0.7rem;
  }

  .null-token input {
    width: 4.5rem;
  }

  .export-options {
    position: relative;
  }

  .export-options summary {
    min-height: 30px;
    padding: 6px 10px;
    border: 1px solid var(--divider);
    border-radius: 5px;
    background: var(--surface-raised);
    font-size: 0.72rem;
    cursor: pointer;
  }

  .export-options > div {
    position: absolute;
    z-index: 5;
    top: calc(100% + 4px);
    right: 0;
    display: grid;
    width: 13rem;
    padding: 0.55rem;
    gap: 0.35rem;
    border: 1px solid var(--divider);
    border-radius: 6px;
    background: var(--surface-raised);
    box-shadow: var(--shadow);
  }

  .export-safety-note {
    margin: 0;
    color: var(--muted);
    font-size: 0.68rem;
    line-height: 1.35;
  }

  .loaded-label,
  .result-footer {
    color: var(--muted);
    font-size: 0.78rem;
  }

  .grid-shell {
    display: grid;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr);
    overflow: hidden;
    border: 1px solid var(--divider);
    border-radius: 10px;
    background: var(--surface-raised);
  }

  .grid-header,
  .grid-row {
    display: grid;
    width: max-content;
    min-width: 100%;
  }

  .grid-header-viewport {
    min-width: 0;
    overflow: hidden;
    border-bottom: 1px solid var(--divider);
    background: var(--surface);
  }

  .grid-row [role='gridcell'] {
    unicode-bidi: plaintext;
  }

  .large-value {
    display: grid;
    max-height: 24rem;
    padding: 0.7rem;
    gap: 0.5rem;
    overflow: hidden;
    border: 1px solid var(--divider);
    border-radius: 8px;
    background: var(--surface-raised);
  }

  .large-value > div {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .large-value pre {
    margin: 0;
    overflow: auto;
    white-space: pre-wrap;
    unicode-bidi: plaintext;
  }

  .grid-header {
    min-height: 2.2rem;
    background: var(--surface);
    will-change: transform;
  }

  .grid-header > div {
    position: relative;
    min-width: 0;
    border-right: 1px solid var(--divider);
  }

  .grid-header button:not(.resize-handle) {
    width: 100%;
    height: 100%;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 0;
    border-radius: 0;
    background: transparent;
  }

  .resize-handle {
    position: absolute;
    z-index: 2;
    top: 0;
    right: -0.3rem;
    width: 0.6rem;
    height: 100%;
    padding: 0;
    cursor: col-resize;
    border: 0;
    background: transparent;
  }

  .grid-viewport {
    min-height: 0;
    overflow: auto;
  }

  .grid-canvas {
    position: relative;
  }

  .grid-row {
    position: absolute;
    left: 0;
    height: 34px;
    border-bottom: 1px solid var(--divider);
  }

  .grid-row.selected {
    box-shadow: inset 3px 0 var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .grid-row > button {
    overflow: hidden;
    padding: 0.35rem 0.55rem;
    color: var(--text);
    font-family: 'IBM Plex Mono', 'Cascadia Code', ui-monospace, monospace;
    font-size: 0.78rem;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 0;
    border-right: 1px solid var(--divider);
    border-radius: 0;
    background: transparent;
  }

  .grid-row > button.null-value {
    color: var(--muted);
    font-style: italic;
  }

  .cursor-warning {
    color: var(--warning);
  }
</style>
