import { describe, expect, it } from 'vitest';

import {
  classifyCiScope,
  documentationOnlyPath,
  frontendOnlyPath
} from '../scripts/ci-change-scope.mjs';

describe('CI change scope', () => {
  it('keeps documentation, evidence, and traceability updates on the light path', () => {
    const paths = [
      'README.md',
      'docs/release/signed-updates.md',
      'docs/architecture/0017-streamlined-signed-release-automation.md',
      'evidence/release-updates/0.1.8/publication.json',
      'traceability/requirements.json',
      '.github/pull_request_template.md',
      '.github/ISSUE_TEMPLATE/bug.yml'
    ];

    expect(paths.every(documentationOnlyPath)).toBe(true);
    expect(classifyCiScope(paths)).toBe('documentation');
  });

  it('runs frontend validation without native matrices for UI-only changes', () => {
    const paths = [
      'src/App.svelte',
      'src/styles/app.css',
      'scripts/check-ui-layout.mjs',
      'vite.config.ts',
      'README.md'
    ];

    expect(paths.slice(0, -1).every(frontendOnlyPath)).toBe(true);
    expect(classifyCiScope(paths)).toBe('frontend');
  });

  it('uses native CI for automation, dependencies, and release inputs', () => {
    for (const path of [
      'src-tauri/src/lib.rs',
      'crates/querynot-core/src/store.rs',
      'scripts/package-platform.mjs',
      '.github/workflows/ci.yml',
      'package.json',
      'docs/release/0.1.8-notes.md'
    ]) {
      expect(documentationOnlyPath(path)).toBe(false);
      expect(frontendOnlyPath(path)).toBe(false);
      expect(classifyCiScope([path])).toBe('native');
    }
  });

  it('fails closed for empty or unsafe path sets', () => {
    expect(classifyCiScope([])).toBe('native');
    expect(classifyCiScope(['bad\npath.md'])).toBe('native');
    expect(classifyCiScope(['/absolute.md'])).toBe('native');
    expect(classifyCiScope(['src\\App.svelte'])).toBe('native');
  });

  it('fails closed when a frontend change is mixed with an unknown path', () => {
    expect(classifyCiScope(['src/App.svelte', 'tools/custom-task.js'])).toBe(
      'native'
    );
  });
});
