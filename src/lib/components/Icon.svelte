<script lang="ts">
  export type IconName =
    | 'arrow-down'
    | 'arrow-up'
    | 'chevron-down'
    | 'chevron-right'
    | 'close'
    | 'more'
    | 'offline'
    | 'pin'
    | 'plus'
    | 'routine'
    | 'table'
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
  {:else if name === 'close'}
    <path d="m6 6 12 12M18 6 6 18" />
  {:else if name === 'more'}
    <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none" />
  {:else if name === 'pin'}
    <path d="M8 4h8l-1 6 3 3v2H6v-2l3-3-1-6Z" />
    <path d="M12 15v6" />
  {:else if name === 'table'}
    <rect x="3" y="4" width="18" height="16" rx="1.5" />
    <path d="M3 9h18M9 9v11" />
  {:else if name === 'offline'}
    <circle cx="12" cy="12" r="9" />
    <path d="m5.6 5.6 12.8 12.8" />
  {:else if name === 'chevron-right'}
    <path d="m9 6 6 6-6 6" />
  {:else if name === 'chevron-down'}
    <path d="m6 9 6 6 6-6" />
  {:else if name === 'routine'}
    <path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14" />
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
