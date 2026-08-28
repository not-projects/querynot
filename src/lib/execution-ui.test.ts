import { describe, expect, it } from 'vitest';

import {
  executionElapsedMs,
  executionErrorPresentation,
  executionStateLabel,
  finishExecutionCancellation,
  isExecutionActive,
  resultFromFirstBatch,
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

  it('finishes cancellation when the adapter emits its terminal event even without separate server confirmation', () => {
    const execution = runningExecution();
    setExecutionState(execution, 'cancelling', 1_250);

    finishExecutionCancellation(execution, 1_500);

    expect(isExecutionActive(execution.state)).toBe(false);
    expect(execution.state).toBe('cancelled');
    expect(execution.completedAt).toBe(1_500);
  });

  it('presents execution states as concise user-facing labels', () => {
    expect(executionStateLabel('queued')).toBe('Queued');
    expect(executionStateLabel('succeeded')).toBe('Succeeded');
    expect(executionStateLabel('retry_pending')).toBe('retry pending');
  });

  it('turns native execution errors into readable result guidance', () => {
    expect(
      executionErrorPresentation({
        message: 'The server rejected this statement.',
        category: 'syntax',
        detail: 'Vendor error code: 1064.',
        retryable: false,
        statementIndex: 1,
        statementStart: 24,
        statementEnd: 47
      })
    ).toEqual({
      categoryLabel: 'SQL syntax issue',
      heading: 'Query failed',
      message: 'The server rejected this statement.',
      detail: 'Vendor error code: 1064.',
      location: 'Statement 2 · SQL bytes 24–47',
      guidance:
        'Review the SQL near the reported statement, then run the corrected query.',
      retryHint: null
    });
  });

  it('provides a safe fallback and retry hint for uncategorized errors', () => {
    const presentation = executionErrorPresentation({
      message: 'The database could not complete this query.',
      category: null,
      detail: null,
      retryable: true,
      statementIndex: null,
      statementStart: null,
      statementEnd: null
    });

    expect(presentation.categoryLabel).toBe('Database error');
    expect(presentation.location).toBeNull();
    expect(presentation.retryHint).toBe(
      'Retry may succeed after the cause is resolved.'
    );
  });

  it('materializes the first native batch before the start response can initialize UI state', () => {
    const result = resultFromFirstBatch({
      execution_id: 'execution',
      result_set_id: 'result',
      statement_index: 0,
      columns: [{ name: 'answer', declared_type: 'INTEGER', nullable: false }],
      rows: [
        {
          values: [
            {
              value_type: 'signed_integer',
              text: '42',
              boolean: null,
              bytes_base64: null,
              timezone_or_offset: null
            }
          ]
        }
      ],
      retained_bytes: 2
    });

    expect(result.rows).toHaveLength(1);
    expect(result.receivedRows).toBe(1);
    expect(result.nextSequence).toBe(1);
    expect(result.columns[0].name).toBe('answer');
  });

  it('retains a zero-row result when the native batch includes its columns', () => {
    const result = resultFromFirstBatch({
      execution_id: 'execution',
      result_set_id: 'empty-result',
      statement_index: 0,
      columns: [{ name: 'answer', declared_type: 'INTEGER', nullable: true }],
      rows: [],
      retained_bytes: 0
    });

    expect(result.rows).toEqual([]);
    expect(result.receivedRows).toBe(0);
    expect(result.nextSequence).toBe(1);
  });
});
