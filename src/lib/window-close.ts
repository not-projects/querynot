export interface WindowCloseDecisionState {
  busy: boolean;
  connectionOperationCount: number;
  dirtyTabCount: number;
  stagedTableChangeCount: number;
  sessionCount: number;
  activeExecutionCount: number;
  workspaceSavePending: boolean;
}

export function requiresWindowCloseDecision(
  state: WindowCloseDecisionState
): boolean {
  return (
    state.busy ||
    state.connectionOperationCount > 0 ||
    state.dirtyTabCount > 0 ||
    state.stagedTableChangeCount > 0 ||
    state.sessionCount > 0 ||
    state.activeExecutionCount > 0 ||
    state.workspaceSavePending
  );
}
