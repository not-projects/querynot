<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Attachment } from 'svelte/attachments';

  import { floatingPanelPosition } from '../floating-panel';
  import Icon from './Icon.svelte';

  interface Props {
    hotspotEstimatesEnabled: boolean;
    onopensettings: () => void;
  }

  let { hotspotEstimatesEnabled, onopensettings }: Props = $props();
  const uid = $props.id();
  let open = $state(false);
  let positioned = $state(false);
  let panelLeft = $state(0);
  let panelTop = $state(0);
  let root: HTMLElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  let panel: HTMLElement | undefined;

  const captureRoot: Attachment<HTMLElement> = (element) => {
    root = element;
    return () => {
      if (root === element) root = undefined;
    };
  };

  const captureTrigger: Attachment<HTMLButtonElement> = (element) => {
    trigger = element;
    return () => {
      if (trigger === element) trigger = undefined;
    };
  };

  const capturePanel: Attachment<HTMLElement> = (element) => {
    panel = element;
    return () => {
      if (panel === element) panel = undefined;
    };
  };

  async function openPanel() {
    open = true;
    positioned = false;
    await tick();
    if (root && trigger && panel) {
      const position = floatingPanelPosition(root, trigger, panel, 'end');
      panelLeft = position.left;
      panelTop = position.top;
    }
    positioned = true;
    await tick();
    panel?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  }

  function closePanel(restoreFocus = true) {
    if (!open) return;
    open = false;
    positioned = false;
    if (restoreFocus) void tick().then(() => trigger?.focus());
  }

  async function openSettings() {
    closePanel(true);
    await tick();
    onopensettings();
  }

  function handleWindowClick(event: MouseEvent) {
    if (!open || root?.contains(event.target as Node)) return;
    closePanel(false);
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (!open || event.key !== 'Escape') return;
    event.preventDefault();
    closePanel();
  }

  function handleFocusOut(event: FocusEvent) {
    const next = event.relatedTarget;
    if (next instanceof Node && root?.contains(next)) return;
    window.setTimeout(() => {
      if (open && !root?.contains(document.activeElement)) closePanel(false);
    }, 0);
  }

  onMount(() => {
    const closeWithoutFocus = () => closePanel(false);
    window.addEventListener('click', handleWindowClick);
    window.addEventListener('keydown', handleWindowKeydown);
    window.addEventListener('resize', closeWithoutFocus);
    return () => {
      window.removeEventListener('click', handleWindowClick);
      window.removeEventListener('keydown', handleWindowKeydown);
      window.removeEventListener('resize', closeWithoutFocus);
    };
  });
</script>

<div class="explain-info" {@attach captureRoot} onfocusout={handleFocusOut}>
  <button
    id={`${uid}-trigger`}
    type="button"
    class="explain-info-trigger"
    aria-label="About Explain and hotspot estimates"
    title="About Explain and hotspot estimates"
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-controls={open ? `${uid}-panel` : undefined}
    {@attach captureTrigger}
    onclick={() => (open ? closePanel() : void openPanel())}
  >
    <Icon name="info" size={12} />
  </button>

  {#if open}
    <div
      id={`${uid}-panel`}
      class="explain-info-panel"
      class:positioned
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${uid}-heading`}
      style:left={`${panelLeft}px`}
      style:top={`${panelTop}px`}
      {@attach capturePanel}
    >
      <div class="explain-info-heading">
        <strong id={`${uid}-heading`}>Explain and hotspot estimates</strong>
        <button
          type="button"
          aria-label="Close Explain information"
          onclick={() => closePanel()}
        >
          <Icon name="close" size={12} />
        </button>
      </div>
      <p>
        Explain asks the database for an estimated plan without executing the
        source statement.
      </p>
      <p>
        Hotspot estimates rank reported cost or rows locally within one plan
        only. They cannot predict elapsed time.
      </p>
      <p class="setting-state">
        Experimental hotspot estimates are currently <strong
          >{hotspotEstimatesEnabled ? 'on' : 'off'}</strong
        >.
      </p>
      <button
        type="button"
        class="settings-action"
        onclick={() => void openSettings()}
      >
        Open hotspot settings
      </button>
    </div>
  {/if}
</div>

<style>
  .explain-info {
    position: relative;
    display: inline-grid;
    flex: 0 0 auto;
  }

  .explain-info-trigger {
    display: inline-grid;
    width: 1.35rem;
    height: 1.35rem;
    place-items: center;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 50%;
    color: var(--muted);
    background: transparent;
  }

  .explain-info-trigger:hover,
  .explain-info-trigger:focus-visible,
  .explain-info:has(.explain-info-panel) .explain-info-trigger {
    border-color: var(--divider);
    color: var(--accent);
    background: var(--surface-raised);
  }

  .explain-info-panel {
    position: fixed;
    z-index: 50;
    display: grid;
    width: 18rem;
    max-width: calc(100vw - 12px);
    max-height: calc(100vh - 12px);
    padding: 0.65rem;
    gap: 0.5rem;
    overflow: auto;
    border: 1px solid var(--divider);
    border-radius: var(--radius-sm);
    visibility: hidden;
    color: var(--text);
    background: var(--surface-raised);
    box-shadow: var(--shadow);
  }

  .explain-info-panel.positioned {
    visibility: visible;
  }

  .explain-info-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-block-end: 0.4rem;
    border-bottom: 1px solid var(--divider);
    font-size: 0.74rem;
  }

  .explain-info-heading button {
    display: inline-grid;
    width: 1.5rem;
    height: 1.5rem;
    place-items: center;
    padding: 0;
    border: 0;
    color: var(--muted);
    background: transparent;
  }

  .explain-info-panel p {
    margin: 0;
    color: var(--muted);
    font-size: 0.7rem;
    line-height: 1.45;
  }

  .explain-info-panel .setting-state strong {
    color: var(--text);
  }

  .settings-action {
    justify-self: start;
    min-height: 1.8rem;
    padding: 0.3rem 0.55rem;
    border: 1px solid var(--divider);
    border-radius: var(--radius-sm);
    color: var(--text);
    background: var(--surface-subtle);
    font-size: 0.7rem;
  }

  .settings-action:hover,
  .settings-action:focus-visible {
    border-color: var(--accent);
  }
</style>
