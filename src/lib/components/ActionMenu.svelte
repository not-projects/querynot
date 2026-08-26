<script lang="ts">
  import { tick } from 'svelte';
  import type { Attachment } from 'svelte/attachments';

  import {
    floatingPanelPosition,
    type FloatingPanelAlign
  } from '../floating-panel';
  import Icon, { type IconName } from './Icon.svelte';

  export interface ActionMenuItem {
    id: string;
    label: string;
    description?: string;
    icon: IconName;
    danger?: boolean;
    disabled?: boolean;
    separatorBefore?: boolean;
    shortcut?: string;
    ariaShortcut?: string;
  }

  interface Props {
    label: string;
    menuLabel: string;
    items: ActionMenuItem[];
    onselect: (itemId: string) => void;
    heading?: string;
    meta?: string;
    align?: FloatingPanelAlign;
    triggerText?: string;
    triggerIcon?: IconName | null;
    class?: string;
  }

  let {
    label,
    menuLabel,
    items,
    onselect,
    heading,
    meta,
    align = 'end',
    triggerText,
    triggerIcon = 'more',
    class: className = ''
  }: Props = $props();

  const uid = $props.id();
  let open = $state(false);
  let positioned = $state(false);
  let menuLeft = $state(0);
  let menuTop = $state(0);
  let root: HTMLElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  let menu: HTMLElement | undefined;

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

  const captureMenu: Attachment<HTMLElement> = (element) => {
    menu = element;
    return () => {
      if (menu === element) menu = undefined;
    };
  };

  function menuItems(): HTMLButtonElement[] {
    return menu
      ? Array.from(
          menu.querySelectorAll<HTMLButtonElement>(
            'button[role="menuitem"]:not(:disabled)'
          )
        )
      : [];
  }

  function placeMenu() {
    if (!root || !trigger || !menu) return;
    const position = floatingPanelPosition(root, trigger, menu, align);
    menuLeft = position.left;
    menuTop = position.top;
  }

  async function openMenu(focus: 'first' | 'last' = 'first') {
    open = true;
    positioned = false;
    await tick();
    placeMenu();
    positioned = true;
    await tick();
    const availableItems = menuItems();
    const target =
      focus === 'last' ? availableItems.at(-1) : availableItems.at(0);
    target?.focus();
  }

  function closeMenu(restoreFocus: boolean) {
    if (!open) return;
    open = false;
    positioned = false;
    if (restoreFocus) void tick().then(() => trigger?.focus());
  }

  function toggleMenu() {
    if (open) closeMenu(true);
    else void openMenu();
  }

  function handleTriggerKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    void openMenu(event.key === 'ArrowUp' ? 'last' : 'first');
  }

  function handleMenuKeydown(event: KeyboardEvent) {
    const availableItems = menuItems();
    if (availableItems.length === 0) return;
    const current = availableItems.indexOf(
      document.activeElement as HTMLButtonElement
    );
    let next = current;
    if (event.key === 'ArrowDown') {
      next = current < 0 ? 0 : (current + 1) % availableItems.length;
    } else if (event.key === 'ArrowUp') {
      next =
        current < 0
          ? availableItems.length - 1
          : (current - 1 + availableItems.length) % availableItems.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = availableItems.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    availableItems[next]?.focus();
  }

  function handleWindowClick(event: MouseEvent) {
    if (!open || root?.contains(event.target as Node)) return;
    closeMenu(false);
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (!open || event.key !== 'Escape') return;
    event.preventDefault();
    closeMenu(true);
  }

  function handleFocusOut(event: FocusEvent) {
    const next = event.relatedTarget;
    if (next instanceof Node && root?.contains(next)) return;
    window.setTimeout(() => {
      if (open && !root?.contains(document.activeElement)) closeMenu(false);
    }, 0);
  }

  function selectItem(item: ActionMenuItem) {
    if (item.disabled) return;
    closeMenu(true);
    onselect(item.id);
  }

  $effect(() => {
    if (!open) return;
    const boundary = root?.closest<HTMLElement>('[data-action-menu-boundary]');
    const closeWithoutFocus = () => closeMenu(false);
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
  class={['action-menu', className, { open }]}
  {@attach captureRoot}
  onfocusout={handleFocusOut}
>
  <button
    id={`${uid}-trigger`}
    type="button"
    class="action-menu-trigger"
    class:labeled={Boolean(triggerText)}
    aria-label={label}
    title={label}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls={open ? `${uid}-menu` : undefined}
    {@attach captureTrigger}
    onclick={toggleMenu}
    onkeydown={handleTriggerKeydown}
  >
    {#if triggerIcon}
      <Icon name={triggerIcon} size={triggerText ? 13 : 15} />
    {/if}
    {#if triggerText}
      <span>{triggerText}</span>
      <Icon name="chevron-down" size={12} />
    {/if}
  </button>

  {#if open}
    <div
      class:positioned
      class="action-menu-popover"
      style:left={`${menuLeft}px`}
      style:top={`${menuTop}px`}
      {@attach captureMenu}
    >
      {#if heading || meta}
        <div class="action-menu-context">
          {#if heading}<strong title={heading}>{heading}</strong>{/if}
          {#if meta}<span>{meta}</span>{/if}
        </div>
      {/if}
      <div
        id={`${uid}-menu`}
        class="action-menu-items"
        role="menu"
        tabindex="-1"
        aria-label={menuLabel}
        onkeydown={handleMenuKeydown}
      >
        {#each items as item (item.id)}
          {#if item.separatorBefore}
            <span class="action-menu-separator" role="separator"></span>
          {/if}
          <button
            type="button"
            role="menuitem"
            class:danger={item.danger}
            disabled={item.disabled}
            aria-keyshortcuts={item.ariaShortcut}
            onclick={() => selectItem(item)}
          >
            <span class="action-menu-icon" aria-hidden="true">
              <Icon name={item.icon} size={14} />
            </span>
            <span class="action-menu-copy">
              <strong>{item.label}</strong>
              {#if item.description}<small>{item.description}</small>{/if}
            </span>
            {#if item.shortcut}<kbd>{item.shortcut}</kbd>{/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .action-menu {
    position: relative;
    display: grid;
    flex: 0 0 auto;
    place-items: center;
  }

  .action-menu.open {
    z-index: 45;
  }

  .action-menu-trigger {
    display: grid;
    width: 1.75rem;
    min-width: 1.75rem;
    min-height: 1.75rem;
    padding: 0;
    place-items: center;
    border-color: transparent;
    border-radius: 5px;
    color: var(--muted);
    background: transparent;
  }

  .action-menu-trigger:hover,
  .action-menu-trigger:focus-visible,
  .action-menu.open .action-menu-trigger {
    border-color: transparent;
    color: var(--text);
    background: var(--surface-raised);
  }

  .action-menu-trigger.labeled {
    display: inline-flex;
    width: auto;
    min-width: 0;
    min-height: 28px;
    align-items: center;
    padding: 4px 8px;
    gap: 0.3rem;
    border-color: var(--divider);
    border-radius: 4px;
    color: var(--text);
    font-size: 0.7rem;
  }

  .action-menu-trigger.labeled:hover,
  .action-menu-trigger.labeled:focus-visible,
  .action-menu.open .action-menu-trigger.labeled {
    border-color: var(--accent);
  }

  .action-menu-popover {
    position: fixed;
    z-index: 45;
    display: grid;
    width: 14rem;
    max-width: calc(100vw - 12px);
    max-height: calc(100vh - 12px);
    padding: 5px;
    gap: 4px;
    overflow: auto;
    border: 1px solid var(--divider);
    border-radius: 7px;
    visibility: hidden;
    background: var(--surface-raised);
    box-shadow: var(--shadow);
  }

  .action-menu-popover.positioned {
    visibility: visible;
  }

  .action-menu-context {
    display: grid;
    min-width: 0;
    padding: 6px 8px 7px;
    gap: 2px;
    border-bottom: 1px solid var(--divider);
  }

  .action-menu-context strong,
  .action-menu-context span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .action-menu-context strong {
    font-size: 0.69rem;
  }

  .action-menu-context span {
    color: var(--muted);
    font-size: 0.59rem;
  }

  .action-menu-items {
    display: grid;
    gap: 1px;
  }

  .action-menu-items button {
    display: grid;
    width: 100%;
    min-height: 2.65rem;
    grid-template-columns: 1.35rem minmax(0, 1fr) auto;
    align-items: center;
    padding: 6px 7px;
    gap: 5px;
    border: 0;
    border-radius: 4px;
    color: var(--text);
    text-align: left;
    background: transparent;
  }

  .action-menu-items button:hover:not(:disabled),
  .action-menu-items button:focus-visible {
    background: var(--surface-subtle);
  }

  .action-menu-items button:focus-visible {
    outline-offset: -2px;
  }

  .action-menu-items button.danger {
    color: var(--danger);
  }

  .action-menu-icon {
    display: grid;
    width: 1.35rem;
    place-items: center;
    color: var(--muted);
  }

  .action-menu-items button.danger .action-menu-icon {
    color: var(--danger);
  }

  .action-menu-copy {
    display: grid;
    min-width: 0;
    gap: 1px;
  }

  .action-menu-copy strong {
    font-size: 0.68rem;
    font-weight: 650;
  }

  .action-menu-copy small {
    overflow: hidden;
    color: var(--muted);
    font-size: 0.61rem;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .action-menu-items kbd {
    color: var(--muted);
    font-family: inherit;
    font-size: 0.57rem;
    white-space: nowrap;
  }

  .action-menu.topbar-file-menu {
    place-items: stretch;
  }

  .action-menu.topbar-file-menu .action-menu-trigger.labeled {
    min-height: 30px;
    padding: 4px 7px;
    border-color: transparent;
    color: var(--text);
    background: transparent;
    font-size: 0.72rem;
  }

  .action-menu.topbar-file-menu .action-menu-trigger.labeled:hover,
  .action-menu.topbar-file-menu .action-menu-trigger.labeled:focus-visible,
  .action-menu.topbar-file-menu.open .action-menu-trigger.labeled {
    border-color: transparent;
    background: var(--surface-subtle);
  }

  .action-menu.topbar-file-menu .action-menu-popover {
    width: 18rem;
  }

  .action-menu-separator {
    height: 1px;
    margin: 3px 5px;
    background: var(--divider);
  }
</style>
