<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    columnName: string;
    declaredType: string;
    rowNumber: number;
    valueType: string;
    rawText: string;
    onclose: () => void;
    oncopy: () => void;
  }

  interface JsonFormatting {
    candidate: boolean;
    formatted: string | null;
    message: string | null;
  }

  let {
    columnName,
    declaredType,
    rowNumber,
    valueType,
    rawText,
    onclose,
    oncopy
  }: Props = $props();

  let viewMode = $state<'formatted' | 'raw'>('formatted');
  const maxFormattedJsonCharacters = 1_000_000;
  const jsonFormatting = $derived(
    inspectJson(rawText, declaredType, maxFormattedJsonCharacters)
  );
  const formattedVisible = $derived(
    viewMode === 'formatted' && jsonFormatting.formatted !== null
  );
  const displayedText = $derived(
    formattedVisible ? (jsonFormatting.formatted ?? rawText) : rawText
  );

  function inspectJson(
    raw: string,
    type: string,
    limit: number
  ): JsonFormatting {
    const trimmed = raw.trim();
    const declaredJson = /(^|\W)json(\W|$)/i.test(type);
    const shapedLikeJson =
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'));
    if (!declaredJson && !shapedLikeJson) {
      return { candidate: false, formatted: null, message: null };
    }
    if (raw.length > limit) {
      return {
        candidate: true,
        formatted: null,
        message: `JSON formatting is limited to ${limit.toLocaleString()} characters; showing the exact raw value.`
      };
    }
    try {
      JSON.parse(trimmed);
      return {
        candidate: true,
        formatted: formatJsonWhitespace(trimmed),
        message: null
      };
    } catch {
      return {
        candidate: true,
        formatted: null,
        message:
          'This field is labelled or shaped like JSON, but its value is not valid JSON. Showing the exact raw value.'
      };
    }
  }

  function formatJsonWhitespace(raw: string): string {
    let output = '';
    let depth = 0;
    let inString = false;
    let escaped = false;
    let lastStructural = '';
    const indentation = () => '  '.repeat(depth);

    for (let index = 0; index < raw.length; index += 1) {
      const character = raw[index];
      if (inString) {
        output += character;
        if (escaped) {
          escaped = false;
        } else if (character === '\\') {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }
      if (character === '"') {
        inString = true;
        output += character;
        lastStructural = '';
        continue;
      }
      if (/\s/.test(character)) continue;
      if (character === '{' || character === '[') {
        output += character;
        depth += 1;
        lastStructural = character;
        const next = nextNonWhitespace(raw, index + 1);
        const closesImmediately =
          (character === '{' && next === '}') ||
          (character === '[' && next === ']');
        if (!closesImmediately) output += `\n${indentation()}`;
        continue;
      }
      if (character === '}' || character === ']') {
        depth = Math.max(0, depth - 1);
        if (!(
          (lastStructural === '{' && character === '}') ||
          (lastStructural === '[' && character === ']')
        )) {
          output += `\n${indentation()}`;
        }
        output += character;
        lastStructural = character;
        continue;
      }
      if (character === ',') {
        output += `,\n${indentation()}`;
        lastStructural = character;
        continue;
      }
      if (character === ':') {
        output += ': ';
        lastStructural = character;
        continue;
      }
      output += character;
      lastStructural = '';
    }
    return output;
  }

  function nextNonWhitespace(value: string, start: number) {
    for (let index = start; index < value.length; index += 1) {
      if (!/\s/.test(value[index])) return value[index];
    }
    return '';
  }
</script>

<div class="value-viewer" role="tabpanel" aria-labelledby="value-viewer-tab">
  <header>
    <div class="value-tabs" role="tablist" aria-label="Result detail tabs">
      <button
        id="value-viewer-tab"
        type="button"
        role="tab"
        aria-selected="true"
      >
        Value · {columnName}
      </button>
    </div>
    <button
      type="button"
      class="close-viewer"
      aria-label="Close value viewer"
      title="Close value viewer"
      onclick={onclose}
    >
      <Icon name="close" size={14} />
    </button>
  </header>

  <div class="viewer-bar">
    <div class="value-meta">
      <span>Row {rowNumber}</span>
      <span>{declaredType || valueType}</span>
      <span>{rawText.length.toLocaleString()} chars</span>
    </div>
    <div class="viewer-tools">
      {#if jsonFormatting.formatted !== null}
        <div class="view-modes" aria-label="Value display mode">
          <button
            type="button"
            aria-pressed={formattedVisible}
            onclick={() => (viewMode = 'formatted')}>Formatted</button
          >
          <button
            type="button"
            aria-pressed={!formattedVisible}
            onclick={() => (viewMode = 'raw')}>Raw</button
          >
        </div>
      {:else if jsonFormatting.candidate}
        <span class="format-message">{jsonFormatting.message}</span>
      {/if}
      <button type="button" class="copy-value" onclick={oncopy}>Copy raw</button
      >
    </div>
  </div>

  <pre
    class:formatted-json={formattedVisible}
    aria-label={formattedVisible
      ? 'Formatted JSON value'
      : 'Raw cell value'}>{displayedText}</pre>
</div>

<style>
  .value-viewer {
    display: grid;
    min-width: 18rem;
    min-height: 0;
    grid-template-rows: auto auto minmax(2.2rem, 1fr);
    overflow: hidden;
    border: 1px solid var(--divider);
    border-radius: 6px;
    background: var(--surface-raised);
  }

  header,
  .value-meta,
  .viewer-bar,
  .viewer-tools,
  .view-modes {
    display: flex;
    align-items: center;
  }

  header {
    min-width: 0;
    justify-content: space-between;
    border-bottom: 1px solid var(--divider);
    background: var(--surface);
  }

  .value-tabs {
    min-width: 0;
  }

  .value-tabs button {
    min-height: 2rem;
    max-width: 16rem;
    padding: 0.35rem 0.65rem;
    overflow: hidden;
    border: 0;
    border-bottom: 2px solid var(--accent);
    border-radius: 0;
    color: var(--text);
    text-overflow: ellipsis;
    white-space: nowrap;
    background: transparent;
    font-size: 0.7rem;
  }

  .close-viewer {
    display: grid;
    width: 2rem;
    min-height: 2rem;
    padding: 0;
    place-items: center;
    border: 0;
    border-radius: 0;
    color: var(--muted);
    background: transparent;
  }

  .value-meta {
    min-width: max-content;
    flex-wrap: wrap;
    gap: 0.25rem 0.55rem;
    color: var(--muted);
    font-size: 0.64rem;
  }

  .viewer-bar {
    min-width: 0;
    min-height: 2.3rem;
    padding: 0.35rem 0.5rem;
    gap: 0.35rem 0.55rem;
    border-bottom: 1px solid var(--divider);
  }

  .viewer-tools {
    min-width: 0;
    margin-left: auto;
    gap: 0.3rem;
  }

  .view-modes {
    gap: 0.2rem;
  }

  .viewer-tools button {
    min-height: 1.75rem;
    padding: 0.25rem 0.5rem;
    font-size: 0.64rem;
  }

  .viewer-tools button[aria-pressed='true'] {
    border-color: var(--accent);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }

  .format-message {
    color: var(--muted);
    font-size: 0.62rem;
    line-height: 1.35;
  }

  pre {
    min-width: 0;
    min-height: 0;
    margin: 0;
    padding: 0.75rem;
    overflow: auto;
    color: var(--text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    unicode-bidi: plaintext;
    background: var(--surface-inset);
    font-family: 'IBM Plex Mono', 'Cascadia Code', ui-monospace, monospace;
    font-size: 0.72rem;
    line-height: 1.5;
  }

  pre.formatted-json {
    tab-size: 2;
  }

  @media (max-width: 900px) {
    .value-viewer {
      min-width: 14rem;
    }
  }
</style>
