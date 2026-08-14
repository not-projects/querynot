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
  it('offers every keyboard-reachable first-run route without execution controls', async () => {
    await renderWorkbench();

    expect(button('Create connection').disabled).toBe(false);
    expect(button('Open SQLite file').disabled).toBe(false);
    expect(button('Open SQL file offline').disabled).toBe(false);
    expect(button('Settings').disabled).toBe(false);
    expect(document.body.textContent?.replace(/\s+/g, ' ')).toContain(
      'does not scan for databases, reconnect automatically, or execute restored drafts'
    );
    expect(
      [...document.querySelectorAll('button')].some((element) =>
        /^(run|execute)$/i.test(element.textContent?.trim() ?? '')
      )
    ).toBe(false);
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
    expect(dialog?.textContent).toContain('5 MiB');
    expect(dialog?.querySelector('option[value="system"]')?.textContent).toBe(
      'System'
    );
    expect(button('Save settings').disabled).toBe(false);
  });
});
