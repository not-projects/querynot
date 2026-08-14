import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('Phase 1 native boundaries', () => {
  it('allocates tab IDs and file grants natively and never exposes a native SQLite path', () => {
    const contract = read('contracts/querynot.v1.json');
    const runtime = read('src-tauri/src/phase1.rs');

    expect(contract).toContain('"create_offline_tab"');
    expect(contract).toContain('"file_grant_id"');
    expect(runtime).toContain('let tab_id = TabId::new()');
    expect(runtime).toContain('let grant_id = FileGrantId::new()');
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
