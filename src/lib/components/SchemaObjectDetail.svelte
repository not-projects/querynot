<script lang="ts">
  import type {
    SchemaObjectDetailView,
    SchemaObjectView
  } from '../generated/contracts';
  import Icon from './Icon.svelte';

  interface Props {
    object: SchemaObjectView;
    detail: SchemaObjectDetailView | null;
    loading: boolean;
    error: string | null;
    connected: boolean;
    busy: boolean;
    onrefresh: () => void;
    oncopy: () => void;
    onquery: () => void;
    onbrowserows: () => void;
  }

  let {
    object,
    detail,
    loading,
    error,
    connected,
    busy,
    onrefresh,
    oncopy,
    onquery,
    onbrowserows
  }: Props = $props();

  const supportsRows = $derived(
    object.kind === 'table' || object.kind === 'view'
  );
</script>

<section class="object-workspace" aria-labelledby="object-workspace-heading">
  <header class="object-header">
    <div class="object-identity">
      <span class="object-kind" aria-hidden="true">
        <Icon
          name={object.kind === 'table'
            ? 'table'
            : object.kind === 'routine'
              ? 'routine'
              : 'view'}
          size={18}
        />
      </span>
      <div>
        <p>{object.kind}</p>
        <h2 id="object-workspace-heading">{object.name}</h2>
        <span>{object.namespace}.{object.name}</span>
      </div>
    </div>
    <div class="object-actions" aria-label="Object actions">
      <button type="button" disabled={busy} onclick={oncopy}>Copy name</button>
      {#if supportsRows}
        <button type="button" disabled={busy} onclick={onquery}
          >New query</button
        >
        <button
          type="button"
          disabled={!connected || busy}
          title={connected
            ? 'Open the paged row browser in this object tab'
            : 'Connect the profile to browse rows'}
          onclick={onbrowserows}>Browse rows</button
        >
      {/if}
      <button
        type="button"
        disabled={!connected || loading || busy}
        onclick={onrefresh}>Refresh structure</button
      >
    </div>
  </header>

  {#if !connected && detail}
    <p class="object-notice">
      Showing the metadata loaded during this application session. Reconnect the
      profile to refresh it.
    </p>
  {/if}

  {#if loading}
    <div class="object-state" role="status">Loading object structure…</div>
  {:else if error}
    <div class="object-state error" role="alert">
      <strong>Structure unavailable</strong>
      <span>{error}</span>
    </div>
  {:else if detail}
    <div class="structure-layout">
      <section
        class="structure-panel columns-panel"
        aria-labelledby="columns-heading"
      >
        <div class="section-heading">
          <h3 id="columns-heading">Columns</h3>
          <span>{detail.columns.length}</span>
        </div>
        {#if detail.columns.length > 0}
          <div class="columns-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Key</th>
                  <th>Null</th>
                  <th>Default</th>
                  <th>Extra</th>
                </tr>
              </thead>
              <tbody>
                {#each detail.columns as column (`${column.name}:${column.primary_key_position}`)}
                  <tr>
                    <th scope="row"><code>{column.name}</code></th>
                    <td>{column.declared_type || 'untyped'}</td>
                    <td>
                      {column.primary_key_position
                        ? `Primary ${column.primary_key_position}`
                        : '—'}
                    </td>
                    <td>{column.nullable ? 'Yes' : 'No'}</td>
                    <td><code>{column.default_expression ?? '—'}</code></td>
                    <td>{column.generated ? 'Generated' : '—'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <p class="empty-copy">No column metadata was reported.</p>
        {/if}
      </section>

      <section class="structure-panel" aria-labelledby="indexes-heading">
        <div class="section-heading">
          <h3 id="indexes-heading">Indexes</h3>
          <span>{detail.indexes.length}</span>
        </div>
        {#if detail.indexes.length > 0}
          <ul>
            {#each detail.indexes as index (index.name)}
              <li>
                <code>{index.name}</code>
                <span>{index.columns.join(', ')}</span>
                <small
                  >{index.unique ? 'Unique' : 'Non-unique'} · {index.origin}</small
                >
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty-copy">No indexes were reported.</p>
        {/if}
      </section>

      <section class="structure-panel" aria-labelledby="foreign-keys-heading">
        <div class="section-heading">
          <h3 id="foreign-keys-heading">Foreign keys</h3>
          <span>{detail.foreign_keys.length}</span>
        </div>
        {#if detail.foreign_keys.length > 0}
          <ul>
            {#each detail.foreign_keys as foreignKey (`${foreignKey.id}:${foreignKey.sequence}`)}
              <li>
                <code>{foreignKey.from_column}</code>
                <span>
                  {foreignKey.referenced_table}.{foreignKey.to_column ??
                    '(adapter default)'}
                </span>
                <small>
                  Update {foreignKey.on_update} · delete {foreignKey.on_delete}
                </small>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty-copy">No foreign keys were reported.</p>
        {/if}
      </section>
    </div>

    {#if detail.definition}
      <details class="definition-panel">
        <summary>Engine definition</summary>
        <pre>{detail.definition}</pre>
      </details>
    {/if}

    {#if object.kind === 'routine'}
      <p class="object-notice">
        {detail.routines_supported
          ? 'Routine metadata is supported by this adapter.'
          : 'Routine metadata is unavailable for this adapter.'}
      </p>
    {/if}
  {:else}
    <div class="object-state">
      {connected
        ? 'Select Refresh structure to load metadata for this object.'
        : 'Connect the profile to load this object’s structure.'}
    </div>
  {/if}
</section>

<style>
  .object-workspace {
    display: grid;
    min-width: 0;
    min-height: 0;
    align-content: start;
    padding: 1rem 1.1rem 1.25rem;
    gap: 0.9rem;
    overflow: auto;
    background: var(--surface-raised);
  }

  .object-header {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 0.8rem;
    gap: 1rem;
    border-bottom: 1px solid var(--divider);
  }

  .object-identity,
  .object-actions,
  .section-heading {
    display: flex;
    align-items: center;
  }

  .object-identity {
    min-width: 0;
    gap: 0.65rem;
  }

  .object-kind {
    display: grid;
    width: 2.1rem;
    height: 2.1rem;
    flex: 0 0 auto;
    place-items: center;
    border: 1px solid var(--divider);
    border-radius: 5px;
    color: var(--accent);
    background: var(--surface-subtle);
  }

  .object-identity > div {
    min-width: 0;
  }

  .object-identity p,
  .object-identity span,
  .empty-copy,
  .object-notice,
  .structure-panel small {
    color: var(--muted);
  }

  .object-identity p {
    font-size: 0.64rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .object-identity h2 {
    overflow: hidden;
    margin: 0.08rem 0;
    font-size: 1rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .object-identity span {
    display: block;
    overflow: hidden;
    font-size: 0.68rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .object-actions {
    flex: 0 0 auto;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.35rem;
  }

  .object-actions button {
    min-height: 1.8rem;
    padding: 0.28rem 0.55rem;
    font-size: 0.68rem;
  }

  .structure-layout {
    display: grid;
    min-width: 0;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 0.75rem;
  }

  .structure-panel,
  .definition-panel {
    min-width: 0;
    border: 1px solid var(--divider);
    border-radius: 6px;
    background: color-mix(in srgb, var(--surface) 60%, transparent);
  }

  .columns-panel {
    grid-column: 1 / -1;
  }

  .section-heading {
    justify-content: space-between;
    min-height: 2.25rem;
    padding: 0.45rem 0.65rem;
    border-bottom: 1px solid var(--divider);
  }

  .section-heading h3 {
    margin: 0;
    font-size: 0.76rem;
  }

  .section-heading span {
    color: var(--muted);
    font-size: 0.66rem;
  }

  .columns-scroll {
    min-width: 0;
    overflow: auto;
  }

  table {
    width: 100%;
    min-width: 44rem;
    border-collapse: collapse;
    font-size: 0.7rem;
  }

  th,
  td {
    padding: 0.48rem 0.65rem;
    border-bottom: 1px solid var(--divider);
    text-align: left;
    vertical-align: top;
  }

  thead th {
    color: var(--muted);
    background: var(--surface-subtle);
    font-size: 0.62rem;
    font-weight: 650;
  }

  tbody tr:last-child > * {
    border-bottom: 0;
  }

  tbody th {
    color: var(--text);
    font-weight: 650;
  }

  .structure-panel ul {
    display: grid;
    margin: 0;
    padding: 0.35rem 0.65rem 0.55rem;
    gap: 0;
    list-style: none;
  }

  .structure-panel li {
    display: grid;
    min-width: 0;
    padding: 0.42rem 0;
    gap: 0.18rem;
    border-bottom: 1px solid var(--divider);
  }

  .structure-panel li:last-child {
    border-bottom: 0;
  }

  .structure-panel li span,
  .structure-panel li small {
    overflow-wrap: anywhere;
  }

  .empty-copy,
  .object-notice,
  .object-state {
    margin: 0;
    padding: 0.7rem;
    font-size: 0.7rem;
    line-height: 1.45;
  }

  .object-notice,
  .object-state {
    border: 1px solid var(--divider);
    border-radius: 5px;
    background: var(--surface-subtle);
  }

  .object-state {
    display: grid;
    gap: 0.25rem;
  }

  .object-state.error {
    border-color: color-mix(in srgb, var(--danger) 55%, var(--divider));
    color: var(--danger);
  }

  .definition-panel {
    padding: 0.65rem;
  }

  .definition-panel summary {
    color: var(--text);
    font-size: 0.7rem;
    font-weight: 700;
    cursor: pointer;
  }

  .definition-panel pre {
    max-height: 16rem;
    margin: 0.65rem 0 0;
    padding: 0.7rem;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: var(--surface-inset);
  }

  @media (max-width: 900px) {
    .object-header {
      align-items: flex-start;
      flex-direction: column;
    }

    .object-actions {
      justify-content: flex-start;
    }

    .structure-layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .columns-panel {
      grid-column: auto;
    }
  }
</style>
