<script lang="ts">
  import type {
    ResultColumnView,
    ResultRowView,
    TaggedValueView
  } from '../generated/contracts';
  import {
    MIN_RESULT_COLUMN_WIDTH,
    autoResultColumnWidth
  } from '../result-grid-sizing';
  import ActionMenu, { type ActionMenuItem } from './ActionMenu.svelte';
  import FormPopover from './FormPopover.svelte';
  import Icon from './Icon.svelte';
  import ResultValueViewer from './ResultValueViewer.svelte';

  interface CellLocation {
    rowIndex: number;
    columnIndex: number;
  }

  interface Props {
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
      nullToken: string,
      viewIndexes: number[]
    ) => void;
    onstatus: (message: string) => void;
    tableFontFamily?: string;
    tableFontSizePx?: number;
  }

  let {
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
    onstatus,
    tableFontFamily = 'monospace',
    tableFontSizePx = 13
  }: Props = $props();

  let filterText = $state('');
  let sortColumn = $state<number | null>(null);
  let sortDirection = $state<1 | -1>(1);
  let selectedRows = $state<number[]>([]);
  let scrollTop = $state(0);
  let scrollLeft = $state(0);
  let viewportHeight = $state(320);
  let manualWidths = $state<Record<number, number>>({});
  let nullToken = $state('\\N');
  let focusedCell = $state<CellLocation | null>(null);
  let openedCell = $state<CellLocation | null>(null);
  const rowHeight = $derived(Math.max(34, tableFontSizePx + 18));
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
      .map((_, index) => `${columnWidth(index)}px`)
      .join(' ')
  );
  const selectionGridColumns = $derived(`2.4rem ${gridColumns}`);
  const allVisibleRowsSelected = $derived(
    viewIndexes.length > 0 &&
      viewIndexes.every((index) => selectedRows.includes(index))
  );
  const someVisibleRowsSelected = $derived(
    viewIndexes.some((index) => selectedRows.includes(index)) &&
      !allVisibleRowsSelected
  );
  const openedValue = $derived(
    openedCell
      ? (rows[openedCell.rowIndex]?.values[openedCell.columnIndex] ?? null)
      : null
  );
  const openedColumn = $derived(
    openedCell ? (columns[openedCell.columnIndex] ?? null) : null
  );

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

  function toggleAllVisibleRows() {
    if (allVisibleRowsSelected) {
      const visible = new Set(viewIndexes);
      selectedRows = selectedRows.filter((index) => !visible.has(index));
    } else {
      selectedRows = [...new Set([...selectedRows, ...viewIndexes])];
    }
  }

  function focusCell(rowIndex: number, columnIndex: number) {
    focusedCell = { rowIndex, columnIndex };
  }

  function openCell(rowIndex: number, columnIndex: number) {
    focusedCell = { rowIndex, columnIndex };
    openedCell = { rowIndex, columnIndex };
    const column = columns[columnIndex];
    onstatus(
      `Opened row ${rowIndex + 1}, ${column?.name ?? `column ${columnIndex + 1}`} in the result value viewer without changing the raw value.`
    );
  }

  function openFocusedCell() {
    if (focusedCell) {
      openCell(focusedCell.rowIndex, focusedCell.columnIndex);
    }
  }

  function openCellContextMenu(
    event: MouseEvent,
    rowIndex: number,
    columnIndex: number
  ) {
    event.preventDefault();
    openCell(rowIndex, columnIndex);
  }

  function copyActionItems(): ActionMenuItem[] {
    return [
      {
        id: 'visible',
        label: 'Copy visible rows',
        description: `${viewIndexes.length} rows in the current filter and order.`,
        icon: 'copy'
      },
      {
        id: 'headers',
        label: 'Copy with headers',
        description: 'Add column names as the first row.',
        icon: 'table'
      }
    ];
  }

  function selectCopyAction(itemId: string) {
    if (itemId === 'visible') void copyRows(false, false);
    else if (itemId === 'headers') void copyRows(true, false);
  }

  function exportResult(
    close: (restoreFocus?: boolean) => void,
    format: 'csv' | 'json',
    currentView: boolean
  ) {
    close();
    onexport(format, currentView, nullToken, viewIndexes);
  }

  function resizeColumn(event: PointerEvent, index: number) {
    event.preventDefault();
    const initialX = event.clientX;
    const initialWidth = columnWidth(index);
    const move = (moveEvent: PointerEvent) => {
      const next = Math.min(
        640,
        Math.max(
          MIN_RESULT_COLUMN_WIDTH,
          initialWidth + moveEvent.clientX - initialX
        )
      );
      manualWidths[index] = next;
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  }

  function columnWidth(index: number): number {
    return (
      manualWidths[index] ??
      autoResultColumnWidth(
        columns[index] ?? {
          name: 'Result',
          declared_type: '',
          nullable: null
        },
        rows,
        index,
        tableFontSizePx,
        tableFontFamily
      )
    );
  }

  async function copyCell(value: TaggedValueView) {
    await writeClipboard(canonicalText(value));
    onstatus(
      'Copied one visible cell using QueryNot’s canonical raw representation.'
    );
  }

  async function copyRows(withHeaders: boolean, selectionOnly: boolean) {
    const indexes = selectionOnly ? selectedRows : viewIndexes;
    if (selectionOnly && indexes.length === 0) {
      onstatus('Select at least one loaded row before copying a selection.');
      return;
    }
    const lineEnding = navigator.userAgent.includes('Windows') ? '\r\n' : '\n';
    const records = indexes.map((index) =>
      rows[index].values.map(tsvField).join('\t')
    );
    if (withHeaders)
      records.unshift(columns.map((column) => column.name).join('\t'));
    await writeClipboard(records.join(lineEnding));
    onstatus(
      `Copied ${indexes.length} ${selectionOnly ? 'selected' : 'loaded'} row${indexes.length === 1 ? '' : 's'}${withHeaders ? ' with one header row' : ''}; hidden and unreceived rows were excluded.`
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
  class:viewer-open={openedCell !== null}
  class:paused
  aria-label={`Result set with ${rows.length} received rows`}
>
  <div class="result-tools">
    <div class="result-filter">
      <label>
        <span class="sr-only">Filter loaded rows</span>
        <input
          type="search"
          aria-label="Filter loaded rows"
          placeholder="Filter loaded rows"
          bind:value={filterText}
        />
      </label>
      <span class="loaded-label">
        {viewIndexes.length === rows.length
          ? `${rows.length} loaded ${rows.length === 1 ? 'row' : 'rows'}`
          : `${viewIndexes.length} of ${rows.length} loaded rows`}
      </span>
    </div>
    <div class="result-actions" role="group" aria-label="Result actions">
      <ActionMenu
        class="result-copy-menu"
        label="Copy result rows"
        menuLabel="Actions for copying result rows"
        triggerText="Copy rows"
        triggerIcon="copy"
        heading="Copy rows"
        meta={`${viewIndexes.length} of ${rows.length} loaded rows visible`}
        items={copyActionItems()}
        onselect={selectCopyAction}
      />
      <button
        type="button"
        class="open-value"
        disabled={!focusedCell}
        title={focusedCell
          ? 'Open the focused field in the side value viewer'
          : 'Focus a result field first'}
        onclick={openFocusedCell}
      >
        <Icon name="view" size={13} />
        Open value
      </button>
      <FormPopover
        class="result-export-popover"
        label="Export result rows"
        triggerText="Export"
        triggerIcon="export"
        heading="Export retained rows"
        meta={`Statement ${statementIndex + 1} · ${rows.length} loaded rows`}
      >
        {#snippet children(close)}
          <section class="export-group" aria-labelledby="csv-export-heading">
            <div class="export-group-heading">
              <strong id="csv-export-heading">CSV</strong>
              <span>Spreadsheet-compatible text</span>
            </div>
            <label class="null-token">
              <span>NULL token</span>
              <input
                bind:value={nullToken}
                maxlength="64"
                aria-label="CSV null token"
              />
            </label>
            <p class="export-safety-note">
              Formula prefixes remain raw. Binary values use hexadecimal.
            </p>
            <div class="export-choices">
              <button
                type="button"
                onclick={() => exportResult(close, 'csv', false)}
              >
                <strong>Server order</strong>
                <small>All retained rows in received order.</small>
              </button>
              <button
                type="button"
                onclick={() => exportResult(close, 'csv', true)}
              >
                <strong>Current view</strong>
                <small>Visible rows in the current filter and order.</small>
              </button>
            </div>
          </section>
          <section class="export-group" aria-labelledby="json-export-heading">
            <div class="export-group-heading">
              <strong id="json-export-heading">JSON</strong>
              <span>Lossless tagged values</span>
            </div>
            <p class="export-safety-note">
              Binary values use tagged base64; the CSV NULL token is ignored.
            </p>
            <div class="export-choices">
              <button
                type="button"
                onclick={() => exportResult(close, 'json', false)}
              >
                <strong>Server order</strong>
                <small>All retained rows in received order.</small>
              </button>
              <button
                type="button"
                onclick={() => exportResult(close, 'json', true)}
              >
                <strong>Current view</strong>
                <small>Visible rows in the current filter and order.</small>
              </button>
            </div>
          </section>
        {/snippet}
      </FormPopover>
    </div>
    {#if selectedRows.length > 0}
      <div class="selection-tools" aria-label="Selected row actions">
        <span class="selection-label"
          >{selectedRows.length} row{selectedRows.length === 1 ? '' : 's'} selected</span
        >
        <button type="button" onclick={() => void copyRows(false, true)}
          ><Icon name="copy" size={13} />Copy selected</button
        >
        <button type="button" onclick={() => void copyRows(true, true)}
          >Copy selected with headers</button
        >
        <button
          type="button"
          class="clear-selection"
          onclick={() => (selectedRows = [])}>Clear selection</button
        >
      </div>
    {/if}
  </div>

  <div class:viewer-open={openedCell !== null} class="result-content">
    <div class="grid-shell">
      <div class="grid-header-viewport">
        <div
          class="grid-header"
          style:grid-template-columns={selectionGridColumns}
          style:transform={`translateX(${-scrollLeft}px)`}
          role="row"
        >
          <div class="row-selector-header" role="columnheader">
            <input
              type="checkbox"
              checked={allVisibleRowsSelected}
              aria-checked={someVisibleRowsSelected
                ? 'mixed'
                : allVisibleRowsSelected}
              aria-label="Select all visible loaded rows"
              onchange={toggleAllVisibleRows}
            />
          </div>
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
                    aria-label={sortDirection === 1
                      ? 'ascending'
                      : 'descending'}
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
        aria-colcount={columns.length + 1}
        tabindex="0"
        onscroll={handleScroll}
      >
        <div
          class="grid-canvas"
          style:height={`${viewIndexes.length * rowHeight}px`}
          style:min-width={`max(100%, ${columns.reduce((sum, _, index) => sum + columnWidth(index), 0) + 38.4}px)`}
        >
          {#each renderedIndexes as rowIndex, renderedPosition (rowIndex)}
            <div
              class="grid-row"
              class:selected={selectedRows.includes(rowIndex)}
              role="row"
              aria-rowindex={startIndex + renderedPosition + 1}
              style:top={`${(startIndex + renderedPosition) * rowHeight}px`}
              style:height={`${rowHeight}px`}
              style:grid-template-columns={selectionGridColumns}
            >
              <div class="row-selector-cell" role="rowheader">
                <input
                  type="checkbox"
                  checked={selectedRows.includes(rowIndex)}
                  aria-label={`Select loaded row ${rowIndex + 1}`}
                  onchange={() => toggleRow(rowIndex)}
                />
              </div>
              {#each rows[rowIndex].values as value, columnIndex (`${rowIndex}-${columnIndex}`)}
                <button
                  type="button"
                  role="gridcell"
                  aria-colindex={columnIndex + 2}
                  aria-selected={focusedCell?.rowIndex === rowIndex &&
                    focusedCell.columnIndex === columnIndex}
                  class:focused={focusedCell?.rowIndex === rowIndex &&
                    focusedCell.columnIndex === columnIndex}
                  class:null-value={value.value_type === 'null'}
                  title={`${previewText(value)} · Right-click or use Open value to inspect`}
                  onfocus={() => focusCell(rowIndex, columnIndex)}
                  onclick={() => focusCell(rowIndex, columnIndex)}
                  oncontextmenu={(event) =>
                    openCellContextMenu(event, rowIndex, columnIndex)}
                  ondblclick={() => void copyCell(value)}
                  >{previewText(value)}</button
                >
              {/each}
            </div>
          {/each}
        </div>
      </div>
    </div>

    {#if openedCell && openedValue && openedColumn}
      {#key `${openedCell.rowIndex}:${openedCell.columnIndex}`}
        <ResultValueViewer
          columnName={openedColumn.name}
          declaredType={openedColumn.declared_type}
          rowNumber={openedCell.rowIndex + 1}
          valueType={openedValue.value_type}
          rawText={canonicalText(openedValue)}
          onclose={() => (openedCell = null)}
          oncopy={() => void copyCell(openedValue)}
        />
      {/key}
    {/if}
  </div>

  <div class="result-footer">
    <span>
      Statement {statementIndex + 1} · {rows.length} rows retained ·
      {durationMs === null ? 'timing unavailable' : `${durationMs} ms`} ·
      {terminalState ?? (paused ? 'paused' : 'streaming')}
      {capped ? ' · hard cap reached; full-result export unavailable' : ''}
    </span>
    <span
      >Checkboxes select rows · right-click inspects a value · double-click
      copies one cell</span
    >
    {#if paused}
      <span class="cursor-warning"
        >Native cursor paused; it expires after five minutes.</span
      >
      <button type="button" class="primary" onclick={onloadmore}
        >Load more</button
      >
      <button type="button" onclick={ondiscard}>Discard remainder</button>
    {/if}
  </div>
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
    gap: 0.35rem;
    grid-template-rows: auto minmax(0, 1fr) auto;
    overflow: hidden;
  }

  .result-tools {
    display: grid;
    min-width: 0;
    grid-template-columns: minmax(14rem, 1fr) auto;
    align-items: center;
    gap: 0.35rem 0.55rem;
  }

  .result-filter,
  .result-actions,
  .selection-tools,
  .result-footer {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .result-filter {
    min-width: 0;
  }

  .result-filter label {
    flex: 0 1 12rem;
  }

  .result-filter input {
    width: 100%;
    min-height: 28px;
    padding: 4px 8px;
    font-size: 0.7rem;
  }

  .result-actions {
    justify-content: flex-end;
  }

  .selection-tools {
    grid-column: 1 / -1;
    min-height: 31px;
    padding: 3px 5px 3px 8px;
    border: 1px solid color-mix(in srgb, var(--accent) 38%, var(--divider));
    border-radius: 4px;
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }

  .selection-tools button {
    display: inline-flex;
    min-height: 25px;
    align-items: center;
    padding: 3px 7px;
    gap: 0.3rem;
    font-size: 0.68rem;
  }

  .selection-tools .clear-selection {
    margin-left: auto;
    border-color: transparent;
    color: var(--muted);
    background: transparent;
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

  .open-value {
    display: inline-flex;
    min-height: 28px;
    align-items: center;
    padding: 4px 8px;
    gap: 0.3rem;
    border: 1px solid var(--divider);
    border-radius: 4px;
    color: var(--text);
    background: var(--surface-raised);
    font-size: 0.7rem;
  }

  .export-group {
    display: grid;
    gap: 7px;
  }

  .export-group + .export-group {
    padding-top: 9px;
    border-top: 1px solid var(--divider);
  }

  .export-group-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  .export-group-heading strong {
    font-size: 0.7rem;
  }

  .export-group-heading span {
    color: var(--muted);
    font-size: 0.6rem;
  }

  .export-safety-note {
    margin: 0;
    color: var(--muted);
    font-size: 0.68rem;
    line-height: 1.35;
  }

  .export-choices {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 5px;
  }

  .export-choices button {
    display: grid;
    min-width: 0;
    min-height: 3rem;
    align-content: center;
    padding: 5px 7px;
    gap: 2px;
    text-align: left;
  }

  .export-choices button strong {
    font-size: 0.66rem;
  }

  .export-choices button small {
    color: var(--muted);
    font-size: 0.58rem;
    line-height: 1.25;
  }

  .loaded-label,
  .selection-label,
  .result-footer {
    color: var(--muted);
    font-size: 0.68rem;
  }

  .selection-label {
    color: var(--accent);
    font-weight: 700;
  }

  .result-set.viewer-open:not(.paused) .result-footer {
    display: none;
  }

  .result-content {
    display: grid;
    min-width: 0;
    min-height: 0;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.35rem;
    overflow: hidden;
  }

  .result-content.viewer-open {
    grid-template-columns: minmax(12rem, 1fr) minmax(14rem, 38%);
  }

  .grid-shell {
    display: grid;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr);
    overflow: hidden;
    border: 1px solid var(--divider);
    border-radius: 5px;
    background: var(--surface-raised);
  }

  .grid-header,
  .grid-row {
    display: grid;
    width: max-content;
    min-width: 100%;
    font-family: var(
      --table-font-family,
      'IBM Plex Mono',
      'Cascadia Code',
      ui-monospace,
      monospace
    );
    font-size: var(--table-font-size, 13px);
  }

  .grid-header-viewport {
    min-width: 0;
    overflow: hidden;
    border-bottom: 1px solid var(--divider);
    background: var(--surface-subtle);
  }

  .row-selector-header,
  .row-selector-cell {
    display: grid;
    place-items: center;
    border-right: 1px solid var(--divider);
  }

  .row-selector-header input,
  .row-selector-cell input {
    width: 0.9rem;
    height: 0.9rem;
    margin: 0;
  }

  .grid-row [role='gridcell'] {
    unicode-bidi: plaintext;
  }

  .grid-header {
    min-height: 2.2rem;
    background: var(--surface-subtle);
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
    font-weight: 650;
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
    font-family: inherit;
    font-size: inherit;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 0;
    border-right: 1px solid var(--divider);
    border-radius: 0;
    background: transparent;
  }

  .grid-row > button.focused {
    box-shadow: inset 0 0 0 2px var(--accent);
    background: color-mix(in srgb, var(--accent) 7%, transparent);
  }

  .grid-row > button.null-value {
    color: var(--muted);
    font-style: italic;
  }

  .cursor-warning {
    color: var(--warning);
  }

  @media (max-width: 900px) {
    .result-tools {
      grid-template-columns: minmax(0, 1fr);
    }

    .result-actions {
      justify-content: flex-start;
    }

    .selection-tools {
      grid-column: 1;
    }

    .result-content.viewer-open {
      grid-template-columns: minmax(10rem, 1fr) minmax(14rem, 44%);
    }
  }

  @media (max-width: 620px) {
    .result-content.viewer-open {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(8rem, 1fr) minmax(9rem, 1fr);
    }
  }
</style>
