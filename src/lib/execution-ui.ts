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

export interface ExecutionErrorUi {
  message: string;
  category: string | null;
  detail: string | null;
  retryable: boolean;
  statementIndex: number | null;
  statementStart: number | null;
  statementEnd: number | null;
}

export interface ExecutionUi {
  id: string;
  tabId: string;
  state: string;
  startedAt: number;
  completedAt: number | null;
  statementsCompleted: number;
  receivedRows: number;
  error: ExecutionErrorUi | null;
  operationKind?: 'query' | 'explain';
  eventSequence?: number;
}

export interface ExecutionErrorPresentation {
  categoryLabel: string;
  heading: string;
  message: string;
  detail: string | null;
  location: string | null;
  guidance: string;
  retryHint: string | null;
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

export function resultFromFirstBatch(event: FirstResultBatchEvent): ResultUi {
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

export function finishExecutionCancellation(
  execution: ExecutionUi,
  changedAt = Date.now()
): void {
  setExecutionState(execution, 'cancelled', changedAt);
}

export function executionElapsedMs(
  execution: Pick<ExecutionUi, 'startedAt' | 'completedAt'>,
  now = Date.now()
): number {
  return Math.max(0, (execution.completedAt ?? now) - execution.startedAt);
}

export function executionStateLabel(state: string): string {
  const labels: Record<string, string> = {
    queued: 'Queued',
    started: 'Starting',
    running: 'Running',
    paused: 'Paused',
    cancelling: 'Cancelling',
    cancelled: 'Cancelled',
    succeeded: 'Succeeded',
    failed: 'Failed'
  };
  return labels[state] ?? state.replaceAll('_', ' ');
}

export function executionErrorPresentation(
  error: ExecutionErrorUi,
  operationKind: 'query' | 'explain' = 'query'
): ExecutionErrorPresentation {
  const categories: Record<
    string,
    Pick<ExecutionErrorPresentation, 'categoryLabel' | 'guidance'>
  > = {
    authentication: {
      categoryLabel: 'Authentication issue',
      guidance:
        'Review the saved credential for this connection before trying again.'
    },
    authorization: {
      categoryLabel: 'Permission issue',
      guidance:
        'Check that this connection can access the referenced objects and operation.'
    },
    connectivity: {
      categoryLabel: 'Connection issue',
      guidance:
        'Check the database connection and reconnect this tab before trying again.'
    },
    tls: {
      categoryLabel: 'Secure connection issue',
      guidance:
        'Review the connection TLS settings and certificate files before trying again.'
    },
    timeout: {
      categoryLabel: 'Timeout',
      guidance:
        'Check server availability and workload before deciding whether to run the query again.'
    },
    cancelled: {
      categoryLabel: 'Cancelled',
      guidance: 'The query stopped before it completed.'
    },
    syntax: {
      categoryLabel: 'SQL syntax issue',
      guidance:
        'Review the SQL near the reported statement, then run the corrected query.'
    },
    constraint: {
      categoryLabel: 'Database constraint',
      guidance:
        'Review the submitted values and database constraints before trying again.'
    },
    transaction: {
      categoryLabel: 'Transaction issue',
      guidance:
        'Resolve the tab transaction state before running another possible write.'
    },
    unsupported_capability: {
      categoryLabel: 'Unsupported operation',
      guidance:
        'This connection or server version does not support the requested operation.'
    },
    local_storage: {
      categoryLabel: 'Local storage issue',
      guidance:
        'Review local storage availability before trying the operation again.'
    },
    internal: {
      categoryLabel: 'Internal safety check',
      guidance:
        'No further query work was accepted. Review the query and connection state before trying again.'
    }
  };
  const category = error.category ? categories[error.category] : null;
  const location = [
    error.statementIndex === null
      ? null
      : `Statement ${error.statementIndex + 1}`,
    error.statementStart !== null && error.statementEnd !== null
      ? `SQL bytes ${error.statementStart}–${error.statementEnd}`
      : null
  ]
    .filter((value): value is string => Boolean(value))
    .join(' · ');

  return {
    categoryLabel: category?.categoryLabel ?? 'Database error',
    heading: operationKind === 'explain' ? 'Explain failed' : 'Query failed',
    message: error.message,
    detail: error.detail,
    location: location || null,
    guidance:
      category?.guidance ??
      'Review the database message and query before trying again.',
    retryHint: error.retryable
      ? 'Retry may succeed after the cause is resolved.'
      : null
  };
}
