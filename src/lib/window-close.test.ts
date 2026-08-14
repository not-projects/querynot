import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  requiresWindowCloseDecision,
  type WindowCloseDecisionState
} from './window-close';

const cleanWindow: WindowCloseDecisionState = {
  busy: false,
  connectionOperationCount: 0,
  dirtyTabCount: 0,
  stagedTableChangeCount: 0,
  sessionCount: 0,
  activeExecutionCount: 0,
  workspaceSavePending: false
};

describe('native window close decision', () => {
  it('leaves a clean close request to the standard native window path', () => {
    expect(requiresWindowCloseDecision(cleanWindow)).toBe(false);
  });

  it.each<keyof WindowCloseDecisionState>([
    'busy',
    'connectionOperationCount',
    'dirtyTabCount',
    'stagedTableChangeCount',
    'sessionCount',
    'activeExecutionCount',
    'workspaceSavePending'
  ])('pauses close when %s requires a safety decision', (field) => {
    expect(
      requiresWindowCloseDecision({
        ...cleanWindow,
        [field]: typeof cleanWindow[field] === 'boolean' ? true : 1
      })
    ).toBe(true);
  });

  it('grants only the explicit destroy command used after safety checks', () => {
    const capability = JSON.parse(
      readFileSync('src-tauri/capabilities/main.json', 'utf8')
    ) as { permissions: string[] };

    expect(capability.permissions).toContain('core:window:allow-destroy');
    expect(capability.permissions).not.toContain('core:window:default');
  });
});
