<script lang="ts">
  export type IconName =
    | 'arrow-down'
    | 'arrow-right'
    | 'arrow-up'
    | 'chevron-down'
    | 'chevron-right'
    | 'close'
    | 'copy'
    | 'database'
    | 'edited'
    | 'export'
    | 'history'
    | 'more'
    | 'offline'
    | 'pin'
    | 'plus'
    | 'query'
    | 'routine'
    | 'search'
    | 'refresh'
    | 'run'
    | 'settings'
    | 'table'
    | 'trash'
    | 'view';

  let { name, size = 16 }: { name: IconName; size?: number } = $props();
</script>

<svg
  aria-hidden="true"
  focusable="false"
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  {#if name === 'plus'}
    <path d="M12 5v14M5 12h14" />
  {:else if name === 'arrow-right'}
    <path d="M5 12h14m-5-5 5 5-5 5" />
  {:else if name === 'close'}
    <path d="m6 6 12 12M18 6 6 18" />
  {:else if name === 'copy'}
    <rect x="8" y="8" width="11" height="11" rx="1.5" />
    <path
      d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-10A1.5 1.5 0 0 0 3 5.5v10A1.5 1.5 0 0 0 4.5 17H8"
    />
  {:else if name === 'database'}
    <ellipse cx="12" cy="5.5" rx="7.5" ry="3" />
    <path d="M4.5 5.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" />
    <path d="M4.5 11.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" />
  {:else if name === 'export'}
    <path d="M12 3v12m-4-4 4 4 4-4" />
    <path d="M5 14v5h14v-5" />
  {:else if name === 'history'}
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5M12 7v5l3 2" />
  {:else if name === 'more'}
    <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none" />
  {:else if name === 'edited'}
    <path d="m5 16-.8 3.8L8 19l9.7-9.7-3-3L5 16Z" />
    <path d="m13.7 7.3 3 3" />
  {:else if name === 'pin'}
    <path d="M8 4h8l-1 6 3 3v2H6v-2l3-3-1-6Z" />
    <path d="M12 15v6" />
  {:else if name === 'table'}
    <rect x="3" y="4" width="18" height="16" rx="1.5" />
    <path d="M3 9h18M9 9v11" />
  {:else if name === 'trash'}
    <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
  {:else if name === 'offline'}
    <circle cx="12" cy="12" r="9" />
    <path d="m5.6 5.6 12.8 12.8" />
  {:else if name === 'chevron-right'}
    <path d="m9 6 6 6-6 6" />
  {:else if name === 'chevron-down'}
    <path d="m6 9 6 6 6-6" />
  {:else if name === 'routine'}
    <path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14" />
  {:else if name === 'search'}
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  {:else if name === 'refresh'}
    <path d="M20 7v5h-5" />
    <path d="M4 17v-5h5" />
    <path d="M6.1 8.5A7 7 0 0 1 18.4 7L20 12M4 12l1.6 5a7 7 0 0 0 12.3-1.5" />
  {:else if name === 'run'}
    <path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none" />
  {:else if name === 'query'}
    <path d="M6 4h9l3 3v13H6V4Z" />
    <path d="M14 4v4h4M9 12h6M9 16h4" />
  {:else if name === 'settings'}
    <path d="M4 6h6m4 0h6M4 12h10m4 0h2M4 18h2m4 0h10" />
    <circle cx="12" cy="6" r="2" />
    <circle cx="16" cy="12" r="2" />
    <circle cx="8" cy="18" r="2" />
  {:else if name === 'view'}
    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
    <circle cx="12" cy="12" r="2.5" />
  {:else if name === 'arrow-up'}
    <path d="M12 19V5m-5 5 5-5 5 5" />
  {:else if name === 'arrow-down'}
    <path d="M12 5v14m-5-5 5 5 5-5" />
  {/if}
</svg>

<style>
  svg {
    display: block;
    flex: 0 0 auto;
  }
</style>
