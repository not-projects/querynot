<script lang="ts">
  import type {
    MutationPreviewView,
    TableColumnView,
    TableFilterView,
    TablePageView,
    TableSortView,
    TaggedValueView
  } from '../generated/contracts';
  import type {
    StagedMutationCell,
    StagedTableMutation
  } from '../table-staging';

  interface Props {
    page: TablePageView;
    filters: TableFilterView[];
    staged: StagedTableMutation[];
    preview: MutationPreviewView | null;
    busy: boolean;
    canGoBack: boolean;
    onstageupdate: (
      rowIndex: number,
      column: TableColumnView,
      cell: StagedMutationCell
    ) => void;
    onstagedelete: (rowIndex: number) => void;
    onstageinsert: (cells: StagedMutationCell[]) => void;
    onunstage: (operationIndex: number) => void;
    ondiscard: () => void;
    onreturn: () => void;
    onpreview: () => void;
    onapply: () => void;
    onnext: () => void;
    onprevious: () => void;
    onfilter: (filter: TableFilterView | null) => void;
    onremovefilter: (filterIndex: number) => void;
    onsort: (sort: TableSortView | null) => void;
    onstatus: (message: string) => void;
  }

  let {
    page,
    filters,
    staged,
    preview,
    busy,
    canGoBack,
    onstageupdate,
    onstagedelete,
    onstageinsert,
    onunstage,
    ondiscard,
    onreturn,
    onpreview,
    onapply,
    onnext,
    onprevious,
    onfilter,
    onremovefilter,
    onsort,
    onstatus
  }: Props = $props();

  let filterColumn = $state('');
  let filterOperator = $state('equal');
  let filterValue = $state('');
  let sortColumn = $state('');
  let sortDirection = $state('ascending');
  let insertModes = $state<
    Record<string, 'value' | 'null' | 'database_default'>
  >({});
  let insertValues = $state<Record<string, string>>({});

  const filterOperatorLabels: Record<string, string> = {
    equal: 'Equals',
    not_equal: 'Not equal',
    less_than: 'Less than',
    less_or_equal: 'Less or equal',
    greater_than: 'Greater than',
    greater_or_equal: 'Greater or equal',
    contains: 'Contains',
    starts_with: 'Starts with',
    is_null: 'Is NULL',
    is_not_null: 'Is not NULL'
  };

  const maxEditableOriginalBytes = 4 * 1024;
  const maxCellPreviewCharacters = 4_096;

  const stagedCount = $derived(staged.length);
  const validationErrors = $derived(
    staged.flatMap((operation) =>
      operation.cells.filter((cell) => cell.local_error !== null)
    )
  );

  function modeFor(column: TableColumnView) {
    return (
      insertModes[column.name] ??
      (column.generated || column.has_default
        ? 'database_default'
        : column.nullable
          ? 'null'
          : 'value')
    );
  }

  function valueText(value: TaggedValueView): string {
    if (value.value_type === 'null') return '';
    if (value.value_type === 'boolean') return value.boolean ? 'true' : 'false';
    if (value.value_type === 'bytes') {
      return `<binary ${value.bytes_base64?.length ?? 0} base64 chars>`;
    }
    return value.text ?? '';
  }

  function previewValueText(value: TaggedValueView): string {
    const text = valueText(value);
    return text.length > maxCellPreviewCharacters
      ? `${text.slice(0, maxCellPreviewCharacters)}…`
      : text;
  }

  function metadataPreview(value: string): string {
    return value.length > 160 ? `${value.slice(0, 160)}…` : value;
  }

  function displayedValue(rowIndex: number, column: TableColumnView): string {
    const columnIndex = page.definition.columns.findIndex(
      (candidate) => candidate.name === column.name
    );
    const update = stagedUpdate(rowIndex);
    const changed = update?.cells.find((cell) => cell.column === column.name);
    if (changed?.raw_input !== null && changed?.raw_input !== undefined) {
      return changed.raw_input;
    }
    return valueText(changed?.value ?? page.rows[rowIndex].values[columnIndex]);
  }

  function stagedUpdate(rowIndex: number): StagedTableMutation | undefined {
    return staged.find(
      (operation) =>
        operation.kind === 'update' &&
        sameRow(operation.original, page.rows[rowIndex]?.values)
    );
  }

  function isModified(rowIndex: number): boolean {
    return Boolean(stagedUpdate(rowIndex));
  }

  function isDeleted(rowIndex: number): boolean {
    const original = page.rows[rowIndex]?.values;
    return staged.some(
      (operation) =>
        operation.kind === 'delete' && sameRow(operation.original, original)
    );
  }

  function rowCanEdit(rowIndex: number): boolean {
    const row = page.rows[rowIndex];
    if (!page.definition.editable || !row) return false;
    return page.definition.columns.every((column, columnIndex) => {
      const compared =
        column.editable ||
        page.definition.identity_columns.includes(column.name);
      return !compared || originalValueCanCompare(row.values[columnIndex]);
    });
  }

  function originalValueCanCompare(
    value: TaggedValueView | undefined
  ): boolean {
    if (
      !value ||
      value.value_type === 'bytes' ||
      value.value_type.startsWith('adapter:')
    ) {
      return false;
    }
    const text = value.text ?? '';
    return (
      !text.includes('\0') &&
      new TextEncoder().encode(text).length <= maxEditableOriginalBytes
    );
  }

  function sameRow(
    left: TaggedValueView[] | undefined,
    right: TaggedValueView[] | undefined
  ): boolean {
    return Boolean(
      left && right && JSON.stringify(left) === JSON.stringify(right)
    );
  }

  function valueFor(column: TableColumnView, raw: string): TaggedValueView {
    const empty = {
      boolean: null,
      bytes_base64: null,
      timezone_or_offset: null
    };
    if (column.editor === 'integer') {
      if (!/^-?\d+$/.test(raw)) {
        throw new Error(`${column.name} requires an integer.`);
      }
      const value = BigInt(raw);
      const unsigned = column.declared_type.toUpperCase().includes('UNSIGNED');
      if (
        (unsigned && (value < 0n || value > 18_446_744_073_709_551_615n)) ||
        (!unsigned &&
          (value < -9_223_372_036_854_775_808n ||
            value > 9_223_372_036_854_775_807n))
      ) {
        throw new Error(`${column.name} is outside its safe integer range.`);
      }
      return {
        value_type: unsigned ? 'unsigned_integer' : 'signed_integer',
        text: raw,
        ...empty
      };
    }
    if (column.editor === 'decimal') {
      if (raw.length > 1_024 || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(raw)) {
        throw new Error(`${column.name} requires a decimal value.`);
      }
      return { value_type: 'decimal', text: raw, ...empty };
    }
    if (column.editor === 'float') {
      if (!/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) {
        throw new Error(`${column.name} requires a finite number.`);
      }
      const number = Number(raw);
      if (!Number.isFinite(number)) {
        throw new Error(`${column.name} requires a finite number.`);
      }
      return { value_type: 'float', text: String(number), ...empty };
    }
    if (column.editor === 'boolean') {
      if (raw !== 'true' && raw !== 'false') {
        throw new Error(`${column.name} requires true or false.`);
      }
      return {
        value_type: 'boolean',
        text: null,
        boolean: raw === 'true',
        bytes_base64: null,
        timezone_or_offset: null
      };
    }
    if (column.editor === 'date_time') {
      if (!validDateTime(column.declared_type, raw)) {
        throw new Error(
          `${column.name} requires a valid date/time in the engine's ISO-style format.`
        );
      }
      return {
        value_type: 'date_time',
        text: raw,
        boolean: null,
        bytes_base64: null,
        timezone_or_offset: null
      };
    }
    if (column.editor === 'enum_like') {
      const parsed = enumLikeOptions(column.declared_type);
      if (!parsed) {
        throw new Error(
          `${column.name} has malformed enum metadata and is read-only.`
        );
      }
      const values =
        parsed.set && raw === '' ? [] : parsed.set ? raw.split(',') : [raw];
      if (values.some((value) => !parsed.options.includes(value))) {
        throw new Error(
          `${column.name} requires ${parsed.set ? 'a comma-separated set of' : 'one of'} the declared values.`
        );
      }
    }
    if (column.editor === 'read_only') {
      throw new Error(`${column.name} does not have a supported typed editor.`);
    }
    if (
      new TextEncoder().encode(raw).length > 4 * 1024 * 1024 ||
      raw.includes('\0')
    ) {
      throw new Error(`${column.name} exceeds the safe text editor boundary.`);
    }
    return { value_type: 'text', text: raw, ...empty };
  }

  function validDateTime(declaredType: string, raw: string): boolean {
    const upper = declaredType.trim().toUpperCase();
    if (upper.includes('DATETIME') || upper.includes('TIMESTAMP')) {
      const match = raw.match(
        /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})?$/
      );
      return Boolean(
        match &&
        validDateParts(match) &&
        Number(match[4]) <= 23 &&
        Number(match[5]) <= 59 &&
        Number(match[6]) <= 59 &&
        validOffset(match[7])
      );
    }
    if (upper.includes('DATE')) {
      const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return Boolean(match && validDateParts(match));
    }
    if (upper.includes('TIME')) {
      const match = raw.match(/^(-)?(\d{1,3}):(\d{2}):(\d{2})(?:\.\d{1,6})?$/);
      return Boolean(
        match &&
        Number(match[2]) <= 838 &&
        Number(match[3]) <= 59 &&
        Number(match[4]) <= 59
      );
    }
    return false;
  }

  function validOffset(offset: string | undefined): boolean {
    if (!offset || offset === 'Z') return true;
    return Number(offset.slice(1, 3)) <= 23 && Number(offset.slice(4)) <= 59;
  }

  function validDateParts(match: RegExpMatchArray): boolean {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [
      0,
      31,
      leap ? 29 : 28,
      31,
      30,
      31,
      30,
      31,
      31,
      30,
      31,
      30,
      31
    ];
    return month >= 1 && month <= 12 && day >= 1 && day <= days[month];
  }

  function enumLikeOptions(
    declaredType: string
  ): { options: string[]; set: boolean } | null {
    const match = declaredType.trim().match(/^(ENUM|SET)\((.*)\)$/is);
    if (!match) return null;
    const options: string[] = [];
    const body = match[2];
    let index = 0;
    while (index < body.length) {
      while (/\s/.test(body[index] ?? '')) index += 1;
      if (body[index] !== "'") return null;
      index += 1;
      let value = '';
      let closed = false;
      while (index < body.length) {
        const character = body[index];
        if (character === '\\' && index + 1 < body.length) {
          value += body[index + 1];
          index += 2;
        } else if (character === "'" && body[index + 1] === "'") {
          value += "'";
          index += 2;
        } else if (character === "'") {
          index += 1;
          closed = true;
          break;
        } else {
          value += character;
          index += 1;
        }
      }
      if (!closed) return null;
      options.push(value);
      while (/\s/.test(body[index] ?? '')) index += 1;
      if (index === body.length) break;
      if (body[index] !== ',') return null;
      index += 1;
      while (/\s/.test(body[index] ?? '')) index += 1;
      if (index === body.length) return null;
    }
    return options.length > 0
      ? { options, set: match[1].toUpperCase() === 'SET' }
      : null;
  }

  function filterOperators(column: TableColumnView | undefined): string[] {
    if (!column) return [];
    const nullChecks = ['is_null', 'is_not_null'];
    if (column.editor === 'text' || column.editor === 'enum_like') {
      return ['equal', 'not_equal', 'contains', 'starts_with', ...nullChecks];
    }
    if (['integer', 'decimal', 'float', 'date_time'].includes(column.editor)) {
      return [
        'equal',
        'not_equal',
        'less_than',
        'less_or_equal',
        'greater_than',
        'greater_or_equal',
        ...nullChecks
      ];
    }
    if (column.editor === 'boolean') {
      return ['equal', 'not_equal', ...nullChecks];
    }
    return nullChecks;
  }

  function selectedFilterColumn(): TableColumnView | undefined {
    return page.definition.columns.find(
      (column) => column.name === filterColumn
    );
  }

  function selectFilterColumn(value: string) {
    filterColumn = value;
    const allowed = filterOperators(selectedFilterColumn());
    if (!allowed.includes(filterOperator)) {
      filterOperator = allowed[0] ?? 'equal';
    }
  }

  function nullValue(): TaggedValueView {
    return {
      value_type: 'null',
      text: null,
      boolean: null,
      bytes_base64: null,
      timezone_or_offset: null
    };
  }

  function mutationCell(
    column: TableColumnView,
    raw: string
  ): StagedMutationCell {
    try {
      return {
        column: column.name,
        mode: 'value',
        value: valueFor(column, raw),
        raw_input: null,
        local_error: null
      };
    } catch (error) {
      return {
        column: column.name,
        mode: 'value',
        value: null,
        raw_input: raw,
        local_error:
          error instanceof Error ? error.message : 'The typed value is invalid.'
      };
    }
  }

  function updateCell(rowIndex: number, column: TableColumnView, raw: string) {
    const cell = mutationCell(column, raw);
    onstageupdate(rowIndex, column, cell);
    if (cell.local_error) onstatus(cell.local_error);
  }

  function stageNull(rowIndex: number, column: TableColumnView) {
    if (!column.nullable) return;
    onstageupdate(rowIndex, column, {
      column: column.name,
      mode: 'value',
      value: nullValue(),
      raw_input: null,
      local_error: null
    });
  }

  function stageInsert() {
    try {
      const cells = page.definition.columns.map((column) => {
        const mode = modeFor(column);
        if (mode === 'database_default') {
          return {
            column: column.name,
            mode,
            value: null,
            raw_input: null,
            local_error: null
          };
        }
        if (mode === 'null') {
          return {
            column: column.name,
            mode: 'value',
            value: nullValue(),
            raw_input: null,
            local_error: null
          };
        }
        return mutationCell(column, insertValues[column.name] ?? '');
      });
      onstageinsert(cells);
      insertValues = {};
    } catch (error) {
      onstatus(
        error instanceof Error ? error.message : 'The new row is invalid.'
      );
    }
  }

  function applyFilter() {
    if (!filterColumn) {
      onfilter(null);
      return;
    }
    const column = page.definition.columns.find(
      (candidate) => candidate.name === filterColumn
    );
    if (!column) return;
    if (!filterOperators(column).includes(filterOperator)) {
      onstatus('Choose a filter operator supported by this column type.');
      return;
    }
    try {
      onfilter({
        column: filterColumn,
        operator: filterOperator,
        value: ['is_null', 'is_not_null'].includes(filterOperator)
          ? null
          : valueFor(column, filterValue)
      });
    } catch (error) {
      onstatus(
        error instanceof Error ? error.message : 'The filter is invalid.'
      );
    }
  }

  function stagedInsertValue(
    operation: StagedTableMutation,
    column: TableColumnView
  ): string {
    const cell = operation.cells.find(
      (candidate) => candidate.column === column.name
    );
    if (!cell || cell.mode === 'database_default') return 'DEFAULT';
    if (cell.raw_input !== null) {
      return cell.raw_input.length > maxCellPreviewCharacters
        ? `${cell.raw_input.slice(0, maxCellPreviewCharacters)}…`
        : cell.raw_input;
    }
    if (cell.value?.value_type === 'null') return 'NULL';
    return cell.value ? previewValueText(cell.value) : 'INVALID';
  }

  function filterValueText(filter: TableFilterView): string {
    if (!filter.value) return '';
    if (filter.value.value_type === 'null') return 'NULL';
    return valueText(filter.value);
  }

  function applySort() {
    if (sortColumn) {
      onsort({ column: sortColumn, direction: sortDirection });
    } else {
      onsort(null);
    }
  }
</script>

<section class="table-data" aria-labelledby="table-data-heading">
  <div class="table-heading">
    <div>
      <p class="eyebrow">Single-table data</p>
      <h2 id="table-data-heading">
        {page.definition.namespace}.{page.definition.table}
      </h2>
    </div>
    <span class:warning={page.unstable} class="paging-label">
      {page.unstable
        ? 'Unstable read-only offset page'
        : 'Deterministic keyset page'}
    </span>
  </div>
  {#if filters.length > 0}
    <ul class="active-filters" aria-label="Active server filters">
      {#each filters as filter, filterIndex (`${filter.column}:${filter.operator}:${filterIndex}`)}
        <li>
          <code>
            {filter.column}
            {filter.operator.replaceAll('_', ' ')}
            {filterValueText(filter)}
          </code>
          <button
            type="button"
            disabled={stagedCount > 0 || busy}
            aria-label={`Remove filter ${filterIndex + 1}`}
            onclick={() => onremovefilter(filterIndex)}>Remove</button
          >
        </li>
      {/each}
    </ul>
    <p class="table-message">
      Active structured filters are combined with AND and bound natively.
    </p>
  {/if}

  <p class="table-message">{page.message}</p>
  {#if page.definition.read_only_reason}
    <p class="read-only-reason" role="status">
      {page.definition.read_only_reason}
    </p>
  {/if}

  <div class="browse-controls" aria-label="Server-side table controls">
    <label>
      <span>Filter column</span>
      <select
        value={filterColumn}
        disabled={stagedCount > 0 || busy}
        onchange={(event) =>
          selectFilterColumn((event.currentTarget as HTMLSelectElement).value)}
      >
        <option value="">No filter</option>
        {#each page.definition.columns.filter((column) => column.editor !== 'read_only') as column (column.name)}
          <option value={column.name}>{column.name}</option>
        {/each}
      </select>
    </label>
    <label>
      <span>Operator</span>
      <select
        bind:value={filterOperator}
        disabled={!filterColumn || stagedCount > 0 || busy}
      >
        {#each filterOperators(selectedFilterColumn()) as operator (operator)}
          <option value={operator}>{filterOperatorLabels[operator]}</option>
        {/each}
      </select>
    </label>
    <label>
      <span>Bound value</span>
      <input
        bind:value={filterValue}
        disabled={!filterColumn ||
          ['is_null', 'is_not_null'].includes(filterOperator) ||
          stagedCount > 0 ||
          busy}
      />
    </label>
    <button
      type="button"
      onclick={applyFilter}
      disabled={stagedCount > 0 || busy}
    >
      Apply filter
    </button>
    <label>
      <span>Sort column</span>
      <select bind:value={sortColumn} disabled={stagedCount > 0 || busy}>
        <option value="">Identity order</option>
        {#each page.definition.columns.filter((column) => column.editor !== 'read_only') as column (column.name)}
          <option value={column.name}>{column.name}</option>
        {/each}
      </select>
    </label>
    <label>
      <span>Direction</span>
      <select
        bind:value={sortDirection}
        disabled={!sortColumn || stagedCount > 0 || busy}
      >
        <option value="ascending">Ascending</option>
        <option value="descending">Descending</option>
      </select>
    </label>
    <button
      type="button"
      onclick={applySort}
      disabled={stagedCount > 0 || busy}
    >
      Apply sort
    </button>
  </div>
  {#if stagedCount > 0}
    <p class="staged-warning">
      Apply or discard staged changes before paging, filtering, sorting,
      refreshing, disconnecting, or closing. Staged values are not restored
      after a crash.
    </p>
  {/if}

  <div class="table-scroll">
    <table>
      <thead>
        <tr>
          <th scope="col">State</th>
          {#each page.definition.columns as column (column.name)}
            <th scope="col" title={column.name}>
              {metadataPreview(column.name)}
              <small>{metadataPreview(column.declared_type || 'unknown')}</small
              >
            </th>
          {/each}
          <th scope="col">Row action</th>
        </tr>
      </thead>
      <tbody>
        {#each page.rows as row, rowIndex (row)}
          <tr
            class:deleted={isDeleted(rowIndex)}
            class:modified={isModified(rowIndex)}
          >
            <th scope="row">
              {isDeleted(rowIndex)
                ? 'deleted'
                : isModified(rowIndex)
                  ? 'modified'
                  : rowCanEdit(rowIndex)
                    ? 'original'
                    : 'read-only'}
            </th>
            {#each page.definition.columns as column (column.name)}
              {@const columnIndex = page.definition.columns.findIndex(
                (candidate) => candidate.name === column.name
              )}
              <td>
                {#if rowCanEdit(rowIndex) && column.editable && !isDeleted(rowIndex)}
                  {#if column.editor === 'boolean'}
                    <select
                      value={displayedValue(rowIndex, column)}
                      aria-label={`${column.name} row ${rowIndex + 1}`}
                      onchange={(event) =>
                        updateCell(
                          rowIndex,
                          column,
                          (event.currentTarget as HTMLSelectElement).value
                        )}
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  {:else}
                    {@const changedCell = stagedUpdate(rowIndex)?.cells.find(
                      (cell) => cell.column === column.name
                    )}
                    <input
                      class:invalid-value={Boolean(changedCell?.local_error)}
                      value={displayedValue(rowIndex, column)}
                      aria-label={`${column.name} row ${rowIndex + 1}`}
                      aria-invalid={changedCell?.local_error
                        ? 'true'
                        : undefined}
                      aria-describedby={changedCell?.local_error
                        ? `table-error-${rowIndex}-${columnIndex}`
                        : undefined}
                      onchange={(event) =>
                        updateCell(
                          rowIndex,
                          column,
                          (event.currentTarget as HTMLInputElement).value
                        )}
                    />
                    {#if changedCell?.local_error}
                      <small
                        class="validation-error"
                        id={`table-error-${rowIndex}-${columnIndex}`}
                        >{changedCell.local_error}</small
                      >
                    {/if}
                  {/if}
                  {#if column.nullable}
                    <button
                      type="button"
                      class="cell-null"
                      onclick={() => stageNull(rowIndex, column)}>NULL</button
                    >
                  {/if}
                {:else}
                  <code
                    title={valueText(row.values[columnIndex]).length >
                    maxCellPreviewCharacters
                      ? 'Value preview truncated; this row is read-only for safe optimistic comparison.'
                      : (column.read_only_reason ?? column.name)}
                  >
                    {previewValueText(row.values[columnIndex]) || 'NULL'}
                  </code>
                {/if}
              </td>
            {/each}
            <td>
              {#if rowCanEdit(rowIndex)}
                <button
                  type="button"
                  disabled={busy}
                  onclick={() => onstagedelete(rowIndex)}
                >
                  {isDeleted(rowIndex) ? 'Undo delete' : 'Stage delete'}
                </button>
              {:else if page.definition.editable}
                <small
                  title="An identity or editable original value cannot be compared safely."
                  >Unsafe original value</small
                >
              {/if}
            </td>
          </tr>
        {/each}
        {#each staged as operation, operationIndex (`${operationIndex}:${operation.kind}`)}
          {#if operation.kind === 'insert'}
            <tr class="staged-insert">
              <th scope="row">inserted</th>
              {#each page.definition.columns as column (column.name)}
                <td><code>{stagedInsertValue(operation, column)}</code></td>
              {/each}
              <td>
                <button
                  type="button"
                  disabled={busy}
                  onclick={() => onunstage(operationIndex)}>Undo insert</button
                >
              </td>
            </tr>
          {/if}
        {/each}
        {#if page.definition.editable}
          <tr class="insert-row">
            <th scope="row">new</th>
            {#each page.definition.columns as column (column.name)}
              <td>
                <select
                  value={modeFor(column)}
                  aria-label={`${column.name} insert mode`}
                  onchange={(event) =>
                    (insertModes[column.name] = (
                      event.currentTarget as HTMLSelectElement
                    ).value as 'value' | 'null' | 'database_default')}
                >
                  <option value="value" disabled={column.generated}
                    >Value</option
                  >
                  <option value="null" disabled={!column.nullable}>NULL</option>
                  <option
                    value="database_default"
                    disabled={!column.has_default && !column.generated}
                    >Database default</option
                  >
                </select>
                {#if modeFor(column) === 'value'}
                  <input
                    bind:value={insertValues[column.name]}
                    aria-label={`${column.name} new-row value`}
                  />
                {/if}
              </td>
            {/each}
            <td
              ><button type="button" onclick={stageInsert}>Stage insert</button
              ></td
            >
          </tr>
        {/if}
      </tbody>
    </table>
  </div>

  <div class="table-actions">
    <button
      type="button"
      disabled={!canGoBack || stagedCount > 0 || busy}
      onclick={onprevious}
    >
      Previous page
    </button>
    <button
      type="button"
      disabled={!page.has_more || stagedCount > 0 || busy}
      onclick={onnext}>Next page</button
    >
    <span>{page.rows.length} loaded rows</span>
    {#if stagedCount > 0}
      <button type="button" disabled={busy} onclick={ondiscard}
        >Discard changes</button
      >
      <button
        type="button"
        class="primary"
        disabled={busy || validationErrors.length > 0}
        onclick={onpreview}
      >
        Preview {stagedCount} change{stagedCount === 1 ? '' : 's'}
      </button>
    {/if}
  </div>
  {#if validationErrors.length > 0}
    <p class="validation-error" role="alert">
      Correct {validationErrors.length} invalid staged value{validationErrors.length ===
      1
        ? ''
        : 's'} before preview or apply.
    </p>
  {/if}

  {#if preview}
    <section
      class="mutation-preview"
      aria-labelledby="mutation-preview-heading"
    >
      <h3 id="mutation-preview-heading">Immutable mutation preview</h3>
      <p>{preview.message}</p>
      <p>
        Target <code>{preview.target}</code> · {preview.affected_row_count} expected
        row{preview.affected_row_count === 1 ? '' : 's'}
      </p>
      <ol>
        {#each preview.operations as operation, index (`${index}:${operation.sql_template}`)}
          <li>
            <strong>{operation.kind}</strong>
            <code>{operation.sql_template}</code>
            <ul>
              {#each operation.parameters as parameter, parameterIndex (`${parameterIndex}:${parameter.value_type}`)}
                <li>
                  <span>{parameter.value_type}</span>
                  <code
                    >{parameter.display}{parameter.truncated ? '…' : ''}</code
                  >
                </li>
              {/each}
            </ul>
          </li>
        {/each}
      </ol>
      <div class="table-actions">
        <button type="button" disabled={busy} onclick={onreturn}
          >Return to editing</button
        >
        <button type="button" class="primary" disabled={busy} onclick={onapply}>
          Apply exact batch atomically
        </button>
      </div>
    </section>
  {/if}
</section>

<style>
  .table-data {
    min-width: 0;
    padding: 1rem;
    display: grid;
    gap: 0.8rem;
    background: var(--surface-raised);
    border: 1px solid var(--divider);
  }
  .table-heading,
  .table-actions,
  .browse-controls {
    display: flex;
    gap: 0.65rem;
    align-items: end;
    flex-wrap: wrap;
  }
  .table-heading {
    justify-content: space-between;
    align-items: center;
  }
  h2,
  h3,
  p {
    margin: 0;
  }
  .eyebrow {
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.72rem;
  }
  .paging-label {
    color: var(--accent);
  }
  .paging-label.warning,
  .read-only-reason,
  .staged-warning {
    color: var(--warning);
  }
  .browse-controls label {
    display: grid;
    gap: 0.25rem;
    font-size: 0.78rem;
    color: var(--muted);
  }
  .browse-controls input,
  .browse-controls select {
    min-width: 8rem;
  }
  .active-filters {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .active-filters li {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid var(--divider);
    padding: 0.25rem 0.4rem;
  }
  .table-scroll {
    overflow: auto;
    max-height: 48vh;
    border: 1px solid var(--divider);
  }
  table {
    border-collapse: collapse;
    min-width: 100%;
    font-size: 0.8rem;
  }
  th,
  td {
    border: 1px solid var(--divider);
    padding: 0.4rem;
    text-align: left;
    vertical-align: top;
  }
  thead {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--surface);
  }
  th small {
    display: block;
    color: var(--muted);
    font-weight: normal;
  }
  td input,
  td select {
    max-width: 13rem;
    width: 100%;
  }
  .invalid-value {
    border-color: var(--danger);
  }
  .validation-error {
    display: block;
    color: var(--danger);
    margin-top: 0.25rem;
  }
  tr.deleted {
    opacity: 0.62;
    text-decoration: line-through;
  }
  tr.modified,
  tr.staged-insert {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  tr.insert-row {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .cell-null {
    margin-top: 0.25rem;
    font-size: 0.68rem;
  }
  .table-actions span {
    color: var(--muted);
    margin-inline-end: auto;
  }
  .mutation-preview {
    display: grid;
    gap: 0.6rem;
    border: 1px solid var(--warning);
    padding: 0.8rem;
  }
  .mutation-preview ol {
    display: grid;
    gap: 0.7rem;
    margin: 0;
    padding-inline-start: 1.5rem;
  }
  .mutation-preview li > code {
    display: block;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .mutation-preview ul {
    margin-block: 0.35rem 0;
  }
</style>
