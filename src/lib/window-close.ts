export type WindowCloseBlockerKind =
  | 'execution'
  | 'transaction'
  | 'staged-changes'
  | 'connection'
  | 'busy'
  | 'recovery-disabled';

export interface WindowCloseBlocker {
  kind: WindowCloseBlockerKind;
  tabId: string | null;
  message: string;
}

export interface WindowCloseState {
  activeExecutionTabId: string | null;
  unresolvedTransactionTabId: string | null;
  stagedTableTabId: string | null;
  connectionOperationTabId: string | null;
  connectionOperationCount: number;
  busy: boolean;
  unrecoverableDirtyTabId: string | null;
}

export function firstWindowCloseBlocker(
  state: WindowCloseState
): WindowCloseBlocker | null {
  if (state.activeExecutionTabId) {
    return {
      kind: 'execution',
      tabId: state.activeExecutionTabId,
      message:
        'Cancel the running query and wait for its terminal state before closing the window.'
    };
  }
  if (state.unresolvedTransactionTabId) {
    return {
      kind: 'transaction',
      tabId: state.unresolvedTransactionTabId,
      message:
        'Commit or roll back the active or unknown transaction before closing the window.'
    };
  }
  if (state.stagedTableTabId) {
    return {
      kind: 'staged-changes',
      tabId: state.stagedTableTabId,
      message:
        'Apply or discard the staged table changes before closing the window.'
    };
  }
  if (state.connectionOperationCount > 0) {
    return {
      kind: 'connection',
      tabId: state.connectionOperationTabId,
      message: 'Wait for or cancel connection setup before closing the window.'
    };
  }
  if (state.busy) {
    return {
      kind: 'busy',
      tabId: null,
      message:
        'Wait for the current action to finish before closing the window.'
    };
  }
  if (state.unrecoverableDirtyTabId) {
    return {
      kind: 'recovery-disabled',
      tabId: state.unrecoverableDirtyTabId,
      message:
        'Save or discard this changed query before closing, or enable offline draft restoration in Settings.'
    };
  }
  return null;
}
