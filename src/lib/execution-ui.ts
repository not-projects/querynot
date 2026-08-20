import type {
  ExecutionEventView,
  ResultColumnView,
  ResultRowView
} from './generated/contracts';

export const activeExecutionStates = [
  'queued',
  'running',
  'paused',
  'cancelling'
] as const;

export interface ExecutionUi {
  id: string;
  tabId: string;
  state: string;
  startedAt: number;
  completedAt: number | null;
  statementsCompleted: number;
  receivedRows: number;
  error: string | null;
}

export interface ResultUi {
  id: string;
  executionId: string;
  statementIndex: number;
  columns: ResultColumnView[];
  rows: ResultRowView[];
  receivedRows: number;
  retainedBytes: number;
  paused: boolean;
  capped: boolean;
  terminalState: string | null;
  durationMs: number | null;
  nextSequence: number;
}

type FirstResultBatchEvent = Pick<
  ExecutionEventView,
  | 'execution_id'
  | 'result_set_id'
  | 'statement_index'
  | 'columns'
  | 'rows'
  | 'retained_bytes'
>;

export function resultFromFirstBatch(
  event: FirstResultBatchEvent
): ResultUi {
  if (!event.result_set_id || event.columns.length === 0) {
    throw new Error('A first result batch requires an identifier and columns.');
  }
  return {
    id: event.result_set_id,
    executionId: event.execution_id,
    statementIndex: event.statement_index ?? 0,
    columns: event.columns,
    rows: [...event.rows],
    receivedRows: event.rows.length,
    retainedBytes: event.retained_bytes,
    paused: false,
    capped: false,
    terminalState: null,
    durationMs: null,
    nextSequence: 1
  };
}

export function isExecutionActive(state: string): boolean {
  return activeExecutionStates.includes(
    state as (typeof activeExecutionStates)[number]
  );
}

export function setExecutionState(
  execution: ExecutionUi,
  state: string,
  changedAt = Date.now()
): void {
  execution.state = state;
  execution.completedAt = isExecutionActive(state)
    ? null
    : (execution.completedAt ?? changedAt);
}

export function executionElapsedMs(
  execution: Pick<ExecutionUi, 'startedAt' | 'completedAt'>,
  now = Date.now()
): number {
  return Math.max(0, (execution.completedAt ?? now) - execution.startedAt);
}
