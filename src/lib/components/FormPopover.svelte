<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import type { Attachment } from 'svelte/attachments';

  import {
    floatingPanelPosition,
    type FloatingPanelAlign
  } from '../floating-panel';
  import Icon, { type IconName } from './Icon.svelte';

  interface Props {
    label: string;
    triggerText: string;
    triggerIcon: IconName;
    children: Snippet<[(restoreFocus?: boolean) => void]>;
    heading?: string;
    meta?: string;
    align?: FloatingPanelAlign;
    class?: string;
  }

  let {
    label,
    triggerText,
    triggerIcon,
    children,
    heading,
    meta,
    align = 'end',
    class: className = ''
  }: Props = $props();

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

  function placePanel() {
    if (!root || !trigger || !panel) return;
    const position = floatingPanelPosition(root, trigger, panel, align);
    panelLeft = position.left;
    panelTop = position.top;
  }

  async function openPanel() {
    open = true;
    positioned = false;
    await tick();
    placePanel();
    positioned = true;
    await tick();
    panel
      ?.querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'
      )
      ?.focus();
  }

  function closePanel(restoreFocus = true) {
    if (!open) return;
    open = false;
    positioned = false;
    if (restoreFocus) void tick().then(() => trigger?.focus());
  }

  function togglePanel() {
    if (open) closePanel();
    else void openPanel();
  }

  function handleTriggerKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    void openPanel();
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

  $effect(() => {
    if (!open) return;
    const boundary = root?.closest<HTMLElement>('[data-action-menu-boundary]');
    const closeWithoutFocus = () => closePanel(false);
    window.addEventListener('click', handleWindowClick);
    window.addEventListener('keydown', handleWindowKeydown);
    window.addEventListener('resize', closeWithoutFocus);
    boundary?.addEventListener('scroll', closeWithoutFocus, { passive: true });
    return () => {
      window.removeEventListener('click', handleWindowClick);
      window.removeEventListener('keydown', handleWindowKeydown);
      window.removeEventListener('resize', closeWithoutFocus);
      boundary?.removeEventListener('scroll', closeWithoutFocus);
    };
  });
</script>

<div
  class={['form-popover', className, { open }]}
  {@attach captureRoot}
  onfocusout={handleFocusOut}
>
  <button
    id={`${uid}-trigger`}
    type="button"
    class="form-popover-trigger"
    aria-label={label}
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-controls={open ? `${uid}-panel` : undefined}
    {@attach captureTrigger}
    onclick={togglePanel}
    onkeydown={handleTriggerKeydown}
  >
    <Icon name={triggerIcon} size={13} />
    <span>{triggerText}</span>
    <Icon name="chevron-down" size={12} />
  </button>

  {#if open}
    <div
      id={`${uid}-panel`}
      class:positioned
      class="form-popover-panel"
      role="dialog"
      aria-modal="false"
      aria-label={label}
      style:left={`${panelLeft}px`}
      style:top={`${panelTop}px`}
      {@attach capturePanel}
    >
      {#if heading || meta}
        <div class="form-popover-context">
          {#if heading}<strong>{heading}</strong>{/if}
          {#if meta}<span>{meta}</span>{/if}
        </div>
      {/if}
      {@render children(closePanel)}
    </div>
  {/if}
</div>

<style>
  .form-popover {
    position: relative;
    display: grid;
    flex: 0 0 auto;
  }

  .form-popover.open {
    z-index: 45;
  }

  .form-popover-trigger {
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

  .form-popover-trigger:hover,
  .form-popover-trigger:focus-visible,
  .form-popover.open .form-popover-trigger {
    border-color: var(--accent);
  }

  .form-popover-panel {
    position: fixed;
    z-index: 45;
    display: grid;
    width: 17.5rem;
    max-width: calc(100vw - 12px);
    max-height: calc(100vh - 12px);
    padding: 10px;
    gap: 9px;
    overflow: auto;
    border: 1px solid var(--divider);
    border-radius: 7px;
    visibility: hidden;
    background: var(--surface-raised);
    box-shadow: var(--shadow);
  }

  .form-popover-panel.positioned {
    visibility: visible;
  }

  .form-popover-context {
    display: grid;
    padding: 1px 2px 8px;
    gap: 2px;
    border-bottom: 1px solid var(--divider);
  }

  .form-popover-context strong {
    font-size: 0.72rem;
  }

  .form-popover-context span {
    color: var(--muted);
    font-size: 0.62rem;
  }
</style>
