import { describe, expect, it } from 'vitest';

import {
  executionElapsedMs,
  isExecutionActive,
  setExecutionState,
  type ExecutionUi
} from './execution-ui';

function runningExecution(): ExecutionUi {
  return {
    id: 'execution',
    tabId: 'tab',
    state: 'running',
    startedAt: 1_000,
    completedAt: null,
    statementsCompleted: 0,
    receivedRows: 0,
    error: null
  };
}

describe('execution UI lifecycle', () => {
  it('advances elapsed time only while execution remains active', () => {
    const execution = runningExecution();

    expect(executionElapsedMs(execution, 1_250)).toBe(250);
    setExecutionState(execution, 'succeeded', 1_400);
    expect(executionElapsedMs(execution, 90_000)).toBe(400);
  });

  it('keeps cancelling active until the adapter confirms a terminal state', () => {
    const execution = runningExecution();

    setExecutionState(execution, 'cancelling', 1_250);
    expect(isExecutionActive(execution.state)).toBe(true);
    expect(execution.completedAt).toBeNull();

    setExecutionState(execution, 'cancelled', 1_500);
    expect(isExecutionActive(execution.state)).toBe(false);
    expect(execution.completedAt).toBe(1_500);
  });
});
