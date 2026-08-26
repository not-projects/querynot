import { describe, expect, it } from 'vitest';

import {
  documentationOnlyPath,
  requiresFullCi
} from '../scripts/ci-change-scope.mjs';

describe('CI change scope', () => {
  it('keeps documentation, evidence, and traceability updates on the light path', () => {
    const paths = [
      'README.md',
      'docs/release/signed-updates.md',
      'docs/architecture/0017-streamlined-signed-release-automation.md',
      'evidence/release-updates/0.1.8/publication.json',
      'traceability/requirements.json',
      '.github/ISSUE_TEMPLATE/bug.yml'
    ];

    expect(paths.every(documentationOnlyPath)).toBe(true);
    expect(requiresFullCi(paths)).toBe(false);
  });

  it('uses full CI for application, automation, and versioned release-note inputs', () => {
    for (const path of [
      'src/routes/+page.svelte',
      'scripts/package-platform.mjs',
      '.github/workflows/ci.yml',
      'package.json',
      'docs/release/0.1.8-notes.md'
    ]) {
      expect(documentationOnlyPath(path)).toBe(false);
      expect(requiresFullCi([path])).toBe(true);
    }
  });

  it('fails closed for empty or unsafe path sets', () => {
    expect(requiresFullCi([])).toBe(true);
    expect(requiresFullCi(['bad\npath.md'])).toBe(true);
    expect(requiresFullCi(['/absolute.md'])).toBe(true);
  });
});
