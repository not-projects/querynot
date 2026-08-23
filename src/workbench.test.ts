// @vitest-environment jsdom

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';

import App from './App.svelte';

let mounted: ReturnType<typeof mount> | null = null;

afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = null;
  document.body.innerHTML = '';
});

async function renderWorkbench() {
  mounted = mount(App, { target: document.body });
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

function button(name: string): HTMLButtonElement {
  const candidate = [...document.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === name
  );
  if (!(candidate instanceof HTMLButtonElement)) {
    throw new Error(`button ${name} was not rendered`);
  }
  return candidate;
}

describe('Phase 1 workbench', () => {
  it('offers a unified connection route and compact File menu without execution controls', async () => {
    await renderWorkbench();

    expect(button('Create connection').disabled).toBe(false);
    expect(button('File').disabled).toBe(false);
    expect(button('Settings').disabled).toBe(false);
    expect(document.body.textContent?.replace(/\s+/g, ' ')).toContain(
      'does not scan for databases, reconnect automatically, or execute restored drafts'
    );
    expect(
      [...document.querySelectorAll('button')].some((element) =>
        /^(run|execute)$/i.test(element.textContent?.trim() ?? '')
      )
    ).toBe(false);

    button('File').click();
    flushSync();
    expect(document.querySelector('[role="menu"]')?.textContent).toContain(
      'Open SQL file…'
    );
  });

  it('chooses Server or File inside one create-connection dialog', async () => {
    await renderWorkbench();
    button('Create connection').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Connection type');
    expect(dialog?.textContent).toContain('Server');
    expect(dialog?.textContent).toContain('File');
    expect(dialog?.textContent).not.toContain('Create SQLite file');

    const fileChoice = dialog?.querySelectorAll<HTMLInputElement>(
      'input[name="connection-source"]'
    )[1];
    fileChoice?.click();
    flushSync();
    expect(dialog?.textContent).toContain('Choose database file…');
    expect(button('Create profile').disabled).toBe(true);
  });

  it('renders an accessible settings dialog with all documented local defaults', async () => {
    await renderWorkbench();
    button('Settings').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.closest('.theme-context')).not.toBeNull();
    expect(dialog?.textContent).toContain('Appearance and editor');
    expect(dialog?.textContent).toContain('Connection timeout');
    expect(dialog?.textContent).toContain('Result tranche rows');
    expect(dialog?.textContent).toContain('Table page rows');
    expect(dialog?.textContent).toContain('History retention');
    expect(dialog?.textContent).toContain('Restore drafts and tabs offline');
    expect(dialog?.textContent).toContain('Signed application updates');
    expect(dialog?.textContent).toContain('Installed version 0.1.5');
    expect(dialog?.textContent).toContain(
      'Update checks are available in installed desktop builds.'
    );
    expect(dialog?.textContent).toContain('5 MiB');
    expect(dialog?.querySelector('option[value="system"]')?.textContent).toBe(
      'System'
    );
    expect(button('Save settings').disabled).toBe(false);
  });

  it('previews application scale without resizing the open Settings dialog', async () => {
    await renderWorkbench();
    button('Settings').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();

    const appShell = document.querySelector<HTMLElement>('.app-shell');
    const backdrop = document.querySelector<HTMLElement>('.modal-backdrop');
    const range = document.querySelector<HTMLInputElement>(
      '.modal-card input[type="range"]'
    );
    expect(appShell?.style.getPropertyValue('--ui-scale')).toBe('1');
    expect(backdrop?.style.getPropertyValue('--ui-scale')).toBe('1');

    if (!range) throw new Error('UI scale control was not rendered');
    range.value = '150';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'UI scale: 150%'
    );
    expect(appShell?.style.getPropertyValue('--ui-scale')).toBe('1.5');
    expect(backdrop?.style.getPropertyValue('--ui-scale')).toBe('1');
    expect(backdrop?.dataset.settingsScaleLocked).toBe('true');
  });

  it('dismisses a dialog after its successful submit action', async () => {
    await renderWorkbench();
    button('Settings').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();

    button('Save settings').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
