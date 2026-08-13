import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const readJson = (path: string) =>
  JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

describe('desktop security foundation', () => {
  it('keeps executable script and network sources inside the Tauri boundary', () => {
    const config = readJson('src-tauri/tauri.conf.json');
    const app = config.app as { security: { csp: string } };

    expect(app.security.csp).toContain("script-src 'self'");
    expect(app.security.csp).toContain("object-src 'none'");
    expect(app.security.csp.match(/https?:\/\/[^\s;]+/g)).toEqual([
      'http://ipc.localhost',
      'http://asset.localhost'
    ]);
  });

  it('does not grant shell, process, environment, HTTP, or unrestricted filesystem access', () => {
    const capability = readJson('src-tauri/capabilities/main.json');
    const permissions = capability.permissions as string[];

    expect(
      permissions.some((permission) =>
        /shell|process|http|env|fs:allow/.test(permission)
      )
    ).toBe(false);
    expect(permissions).toEqual([
      'core:default',
      'dialog:allow-open',
      'dialog:allow-save',
      'dialog:allow-message'
    ]);
  });
});
