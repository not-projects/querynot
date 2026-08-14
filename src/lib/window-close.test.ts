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
});
