import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('Phase 1 native boundaries', () => {
  it('allocates tab IDs and file grants natively and never exposes a native SQLite path', () => {
    const contract = read('contracts/querynot.v1.json');
    const runtime = read('src-tauri/src/phase1.rs');

    expect(contract).toContain('"create_offline_tab"');
    expect(contract).toContain('"pick_connection_file"');
    expect(contract).not.toContain('"pick_new_sqlite_file"');
    expect(contract).toContain('"file_grant_id"');
    expect(runtime).toContain('let tab_id = TabId::new()');
    expect(runtime).toContain('let grant_id = FileGrantId::new()');
    expect(runtime).toContain('test_sqlite_connection(&path, true)');
    expect(runtime).toContain(
      'file_name: Some(display_name(Path::new(file_path)))'
    );
    expect(runtime).not.toMatch(/ProfileView\s*\{[^}]*file_path:/s);
  });

  it('keeps normal text and semantic accents above WCAG AA contrast in every theme', () => {
    const css = read('src/styles/app.css');
    const pairs = [
      ['#173a33', '#f3efe5'],
      ['#56635f', '#eae4d7'],
      ['#146657', '#f3efe5'],
      ['#ece8dc', '#151a18'],
      ['#aab3ae', '#1d2421'],
      ['#70bea9', '#151a18'],
      ['#f1eadb', '#102b25'],
      ['#adc4bb', '#15372f'],
      ['#f1a06b', '#102b25']
    ] as const;

    for (const [foreground, background] of pairs) {
      expect(css).toContain(foreground);
      expect(css).toContain(background);
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the optional recovery row from stretching the status bar', () => {
    const css = read('src/styles/app.css');

    expect(css).toMatch(/\.workbench\s*\{[^}]*grid-row:\s*3;/s);
    expect(css).toMatch(/footer\s*\{[^}]*grid-row:\s*4;/s);
    expect(css).toContain('grid-template-rows: auto auto minmax(0, 1fr) auto;');
  });

  it('debounces healthy draft recovery without inserting a warning while typing', () => {
    const app = read('src/App.svelte');
    const queueWorkspaceSave = app
      .split('function queueWorkspaceSave() {')[1]
      .split('async function saveWorkspaceNow')[0];

    expect(queueWorkspaceSave).toContain('setTimeout');
    expect(queueWorkspaceSave).not.toContain('workspaceRecoveryWarning');
    expect(app).toContain('Draft recovery could not be saved.');
  });

  it('scales the complete viewport and keeps native selects themed and sidebar content bounded', () => {
    const app = read('src/App.svelte');
    const css = read('src/styles/app.css');

    expect(app).toContain(
      'style:--ui-scale={displayedSettings.ui_scale_percent / 100}'
    );
    expect(css).toMatch(
      /\.app-shell\s*\{[^}]*width:\s*calc\(100% \/ var\(--ui-scale\)\);[^}]*transform:\s*scale\(var\(--ui-scale\)\);/s
    );
    expect(css).toMatch(/select option\s*\{[^}]*background-color:/s);
    expect(css).toMatch(
      /aside\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s
    );
    const connectionList = read('src/lib/components/ConnectionList.svelte');
    expect(connectionList).toContain(
      'grid-template-columns: minmax(0, 1fr) auto auto;'
    );
    expect(connectionList).toContain('text-overflow: ellipsis;');
    expect(connectionList).toContain('class="connection-action"');
    expect(css).toMatch(
      /\.modal-backdrop\s*\{[^}]*height:\s*calc\(100vh \/ var\(--ui-scale\)\);[^}]*overflow:\s*auto;/s
    );
    expect(css).toMatch(
      /\.modal-card\s*\{[^}]*max-height:\s*min\(820px, 100%\);[^}]*overflow:\s*auto;/s
    );
  });

  it('uses shared SVG icons instead of font symbols for icon-only controls', () => {
    const icon = read('src/lib/components/Icon.svelte');
    const controls = [
      read('src/App.svelte'),
      read('src/lib/components/ConnectionList.svelte'),
      read('src/lib/components/HistoryDrawer.svelte'),
      read('src/lib/components/ResultGrid.svelte'),
      read('src/lib/components/WorkspaceTabs.svelte')
    ].join('\n');

    expect(icon).toContain('<svg');
    expect(icon).toContain('aria-hidden="true"');
    expect(icon).toContain('stroke="currentColor"');
    expect(controls).not.toMatch(/>\s*(?:\+|×|⋯|—|◆|▦|◇|ƒ|↑|↓|▾|▸)\s*</u);
  });

  it('keeps scoped tabs compact and aligns offline document actions with the editor', () => {
    const tabs = read('src/lib/components/WorkspaceTabs.svelte');
    const css = read('src/styles/app.css');

    expect(tabs).toContain('width: 9.25rem;');
    expect(tabs).toContain('flex: 0 1 auto;');
    expect(tabs).toContain('name="edited"');
    expect(tabs).not.toMatch(/>\s*Unsaved\s*</u);
    expect(css).toMatch(
      /\.query-toolbar\s*\{[^}]*justify-content:\s*flex-start;/s
    );
    expect(css).toMatch(
      /\.toolbar-execution:empty \+ \.toolbar-document\s*\{[^}]*padding-left:\s*0;[^}]*border-left:\s*0;/s
    );
    expect(css).toMatch(
      /\.schema-tree\s*\{[^}]*align-content:\s*start;[^}]*grid-auto-rows:\s*max-content;/s
    );
  });

  it('keeps query execution behind explicit native commands and grants no frontend filesystem or network capability', () => {
    const contract = JSON.parse(read('contracts/querynot.v1.json')) as {
      commands: Record<string, unknown>;
    };
    const capability = JSON.parse(read('src-tauri/capabilities/main.json')) as {
      permissions: string[];
    };

    expect(Object.keys(contract.commands)).not.toContain('execute_sql');
    expect(Object.keys(contract.commands)).toContain('start_execution');
    expect(Object.keys(contract.commands)).toContain('connect_profile');
    expect(
      capability.permissions.some((permission) =>
        /shell|process|http|env|fs:allow/.test(permission)
      )
    ).toBe(false);
  });
});

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16)
  );
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
