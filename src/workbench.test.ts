// @vitest-environment jsdom

import { readFileSync } from 'node:fs';

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
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
    const fileItems = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    ];
    expect(
      fileItems.map((item) => item.querySelector('strong')?.textContent)
    ).toEqual(['New query', 'Open SQL file…', 'Save', 'Save as…']);
    expect(fileItems[0]?.textContent).toContain('Create an offline draft');
    expect(fileItems[2]?.textContent).toContain(
      'Available when a query tab is active'
    );
    expect(fileItems[2]?.disabled).toBe(true);
    expect(fileItems[3]?.disabled).toBe(true);
    expect(fileItems[0]?.getAttribute('aria-keyshortcuts')).toMatch(/N$/);
    expect(document.activeElement).toBe(fileItems[0]);

    const appSource = readFileSync('src/App.svelte', 'utf8');
    expect(appSource).not.toContain('class="file-menu-popover"');
    expect(appSource).toContain('aria-label="Editor controls"');
  });

  it('chooses Server or File inside one create-connection dialog', async () => {
    await renderWorkbench();
    button('Create connection').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Add connection');
    expect(dialog?.textContent).toContain('Connect to');
    expect(dialog?.textContent).toContain('Server');
    expect(dialog?.textContent).toContain('Database file');
    expect(dialog?.textContent).toContain('Connection details');
    expect(dialog?.textContent).toContain('Transport security');
    expect(dialog?.textContent).toContain('Credentials');
    expect(dialog?.textContent).toContain('Connection behavior');
    expect(dialog?.textContent).not.toContain('Create SQLite file');
    expect(dialog?.querySelector('input[type="password"]')).toBeNull();
    expect(
      dialog?.querySelector<HTMLDetailsElement>('.client-identity-details')
        ?.open
    ).toBe(false);
    expect(button('Save connection').disabled).toBe(false);

    const vaultChoice = dialog?.querySelector<HTMLInputElement>(
      'input[value="vault"]'
    );
    vaultChoice?.click();
    flushSync();
    expect(dialog?.querySelector('input[type="password"]')).not.toBeNull();

    const fileChoice = dialog?.querySelectorAll<HTMLInputElement>(
      'input[name="connection-source"]'
    )[1];
    fileChoice?.click();
    flushSync();
    expect(dialog?.textContent).toContain('Choose database file…');
    expect(dialog?.textContent).toContain('Open read-only');
    expect(dialog?.textContent).not.toContain('Automatic reconnect');
    const fileDialogText = dialog?.textContent ?? '';
    expect(fileDialogText.indexOf('Database file')).toBeLessThan(
      fileDialogText.indexOf('Profile details')
    );
    expect(button('Save connection').disabled).toBe(true);
  });

  it('renders an accessible settings dialog with all documented local defaults', async () => {
    await renderWorkbench();
    button('Settings').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.closest('.theme-context')).not.toBeNull();
    expect(dialog?.textContent).toContain('Appearance');
    expect(dialog?.textContent).toContain('Editor & formatting');
    expect(dialog?.textContent).toContain('Results & tables');
    expect(dialog?.textContent).toContain('Connections & recovery');
    expect(dialog?.textContent).toContain('History & diagnostics');
    expect(dialog?.textContent).toContain('Connection timeout');
    expect(dialog?.textContent).toContain('Result tranche rows');
    expect(dialog?.textContent).toContain('Table page rows');
    expect(dialog?.textContent).toContain('Table font');
    expect(dialog?.textContent).toContain('Table text size: 13px');
    expect(dialog?.textContent).toContain('History retention');
    expect(dialog?.textContent).toContain('Restore drafts and tabs offline');
    expect(dialog?.textContent).toContain('Signed application updates');
    expect(dialog?.textContent).toContain('Installed version 0.1.8');
    expect(dialog?.textContent).toContain(
      'Update checks are available in installed desktop builds.'
    );
    expect(dialog?.textContent).toContain('5 MiB');
    expect(dialog?.querySelector('option[value="system"]')?.textContent).toBe(
      'System'
    );
    expect(dialog?.querySelector('.settings-scroll')).not.toBeNull();
    expect(dialog?.querySelector('.settings-footer')).not.toBeNull();
    expect(button('Save settings').disabled).toBe(false);
  });

  it('previews the selected table font and text size in the workspace', async () => {
    await renderWorkbench();
    button('Settings').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();

    const font = document.querySelector<HTMLSelectElement>(
      'select option[value="monospace"]'
    )?.parentElement;
    const ranges = document.querySelectorAll<HTMLInputElement>(
      '.modal-card input[type="range"]'
    );
    const size = ranges[1];
    if (!(font instanceof HTMLSelectElement) || !size) {
      throw new Error('table typography controls were not rendered');
    }

    font.value = 'system';
    font.dispatchEvent(new Event('change', { bubbles: true }));
    size.value = '18';
    size.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    const shell = document.querySelector<HTMLElement>('.app-shell');
    expect(shell?.dataset.tableFontFamily).toBe('system');
    expect(shell?.style.getPropertyValue('--table-font-size')).toBe('18px');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      'Table text size: 18px'
    );
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
