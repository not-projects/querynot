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
