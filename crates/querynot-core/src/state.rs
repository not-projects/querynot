use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Transition<S> {
    pub state: S,
    pub effects: Vec<StateEffect>,
}

impl<S> Transition<S> {
    fn new(state: S, effects: impl IntoIterator<Item = StateEffect>) -> Self {
        Self {
            state,
            effects: effects.into_iter().collect(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StateEffect {
    AllocateResource,
    ReleaseResource,
    PersistState,
    RequestDecision,
    BeginCancellation,
    InvalidateLateEvents,
    PreserveLastValidData,
    Noop,
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
#[error("invalid {machine} transition from {state} on {event}")]
pub struct InvalidTransition {
    pub machine: &'static str,
    pub state: String,
    pub event: String,
}

fn invalid(
    machine: &'static str,
    state: impl std::fmt::Debug,
    event: impl std::fmt::Debug,
) -> InvalidTransition {
    InvalidTransition {
        machine,
        state: format!("{state:?}"),
        event: format!("{event:?}"),
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProfileConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting,
    Failed,
    TimedOut,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProfileConnectionEvent {
    ConnectRequested,
    ConnectSucceeded,
    ConnectFailed,
    ConnectionTimedOut,
    CancelRequested,
    DisconnectRequested,
    ResourceClosed,
    RetryRequested,
}

impl ProfileConnectionState {
    pub fn transition(
        self,
        event: ProfileConnectionEvent,
    ) -> Result<Transition<Self>, InvalidTransition> {
        use ProfileConnectionEvent as E;
        use ProfileConnectionState as S;
        use StateEffect as F;
        let transition = match (self, event) {
            (S::Disconnected, E::ConnectRequested)
            | (S::Failed | S::TimedOut | S::Cancelled, E::RetryRequested) => {
                Transition::new(S::Connecting, [F::AllocateResource])
            }
            (S::Connecting, E::ConnectSucceeded) => {
                Transition::new(S::Connected, [F::PersistState])
            }
            (S::Connecting, E::ConnectFailed) => Transition::new(S::Failed, [F::ReleaseResource]),
            (S::Connecting, E::ConnectionTimedOut) => {
                Transition::new(S::TimedOut, [F::BeginCancellation, F::ReleaseResource])
            }
            (S::Connecting, E::CancelRequested) => {
                Transition::new(S::Cancelled, [F::BeginCancellation, F::ReleaseResource])
            }
            (S::Connected, E::DisconnectRequested) => {
                Transition::new(S::Disconnecting, [F::ReleaseResource])
            }
            (S::Disconnecting, E::ResourceClosed)
            | (S::Failed | S::TimedOut | S::Cancelled, E::ResourceClosed) => {
                Transition::new(S::Disconnected, [F::PersistState])
            }
            _ => return Err(invalid("profile_connection", self, event)),
        };
        Ok(transition)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TabState {
    OfflineClean,
    OfflineDirty,
    OnlineClean,
    OnlineDirty,
    Running,
    CloseDecision,
    Closed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TabEvent {
    Edit,
    SaveDraft,
    BindOnline,
    ConnectionLost,
    RunRequested,
    RunFinished,
    CloseRequested,
    KeepOpen,
    CloseConfirmed,
}

impl TabState {
    pub fn transition(self, event: TabEvent) -> Result<Transition<Self>, InvalidTransition> {
        use StateEffect as F;
        use TabEvent as E;
        use TabState as S;
        let transition = match (self, event) {
            (S::OfflineClean, E::Edit) => Transition::new(S::OfflineDirty, [F::PersistState]),
            (S::OnlineClean, E::Edit) => Transition::new(S::OnlineDirty, [F::PersistState]),
            (S::OfflineDirty, E::SaveDraft) => Transition::new(S::OfflineClean, [F::PersistState]),
            (S::OnlineDirty, E::SaveDraft) => Transition::new(S::OnlineClean, [F::PersistState]),
            (S::OfflineClean, E::BindOnline) => {
                Transition::new(S::OnlineClean, [F::AllocateResource])
            }
            (S::OfflineDirty, E::BindOnline) => {
                Transition::new(S::OnlineDirty, [F::AllocateResource])
            }
            (S::OnlineClean, E::ConnectionLost) => {
                Transition::new(S::OfflineClean, [F::ReleaseResource])
            }
            (S::OnlineDirty, E::ConnectionLost) => {
                Transition::new(S::OfflineDirty, [F::ReleaseResource])
            }
            (S::OnlineClean | S::OnlineDirty, E::RunRequested) => {
                Transition::new(S::Running, [F::AllocateResource])
            }
            (S::Running, E::RunFinished) => Transition::new(
                S::OnlineDirty,
                [F::ReleaseResource, F::InvalidateLateEvents],
            ),
            (S::OfflineClean | S::OnlineClean, E::CloseRequested) => {
                Transition::new(S::Closed, [F::ReleaseResource, F::InvalidateLateEvents])
            }
            (S::OfflineDirty | S::OnlineDirty | S::Running, E::CloseRequested) => {
                Transition::new(S::CloseDecision, [F::RequestDecision])
            }
            (S::CloseDecision, E::KeepOpen) => Transition::new(S::OfflineDirty, [F::Noop]),
            (S::CloseDecision, E::CloseConfirmed) => {
                Transition::new(S::Closed, [F::ReleaseResource, F::InvalidateLateEvents])
            }
            _ => return Err(invalid("tab", self, event)),
        };
        Ok(transition)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeSessionState {
    Offline,
    Ready,
    TransactionActive,
    TransactionUnknown,
    Closing,
    Closed,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NativeSessionEvent {
    Attach,
    Begin,
    Commit,
    Rollback,
    ProtocolLost,
    ReconciledClean,
    ReconciledActive,
    CloseRequested,
    ResourceClosed,
    Failed,
}

impl NativeSessionState {
    pub fn transition(
        self,
        event: NativeSessionEvent,
    ) -> Result<Transition<Self>, InvalidTransition> {
        use NativeSessionEvent as E;
        use NativeSessionState as S;
        use StateEffect as F;
        let transition = match (self, event) {
            (S::Offline, E::Attach) => Transition::new(S::Ready, [F::AllocateResource]),
            (S::Ready, E::Begin) => Transition::new(S::TransactionActive, [F::PersistState]),
            (S::TransactionActive, E::Commit | E::Rollback) => {
                Transition::new(S::Ready, [F::PersistState])
            }
            (S::Ready | S::TransactionActive, E::ProtocolLost) => Transition::new(
                S::TransactionUnknown,
                [F::PreserveLastValidData, F::ReleaseResource],
            ),
            (S::TransactionUnknown, E::ReconciledClean) => {
                Transition::new(S::Ready, [F::PersistState])
            }
            (S::TransactionUnknown, E::ReconciledActive) => {
                Transition::new(S::TransactionActive, [F::PersistState])
            }
            (S::Ready | S::TransactionActive | S::TransactionUnknown, E::CloseRequested) => {
                Transition::new(S::Closing, [F::ReleaseResource])
            }
            (S::Closing, E::ResourceClosed) => {
                Transition::new(S::Closed, [F::InvalidateLateEvents])
            }
            (S::Ready | S::TransactionActive | S::TransactionUnknown | S::Closing, E::Failed) => {
                Transition::new(S::Failed, [F::ReleaseResource, F::InvalidateLateEvents])
            }
            _ => return Err(invalid("native_session", self, event)),
        };
        Ok(transition)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionState {
    Created,
    Running,
    CancelRequested,
    Succeeded,
    Failed,
    Cancelled,
    ResourceLost,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExecutionEvent {
    Start,
    RequestCancel,
    Complete,
    Fail,
    CancelConfirmed,
    LoseResource,
}

impl ExecutionState {
    pub fn transition(self, event: ExecutionEvent) -> Result<Transition<Self>, InvalidTransition> {
        use ExecutionEvent as E;
        use ExecutionState as S;
        use StateEffect as F;
        let transition = match (self, event) {
            (S::Created, E::Start) => Transition::new(S::Running, [F::AllocateResource]),
            (S::Running, E::RequestCancel) => {
                Transition::new(S::CancelRequested, [F::BeginCancellation])
            }
            (S::Running, E::Complete) => {
                Transition::new(S::Succeeded, [F::ReleaseResource, F::InvalidateLateEvents])
            }
            (S::Running | S::CancelRequested, E::Fail) => {
                Transition::new(S::Failed, [F::ReleaseResource, F::InvalidateLateEvents])
            }
            (S::CancelRequested, E::CancelConfirmed) => {
                Transition::new(S::Cancelled, [F::ReleaseResource, F::InvalidateLateEvents])
            }
            (S::Running | S::CancelRequested, E::LoseResource) => Transition::new(
                S::ResourceLost,
                [F::ReleaseResource, F::InvalidateLateEvents],
            ),
            _ => return Err(invalid("execution", self, event)),
        };
        Ok(transition)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ResultStreamState {
    Created,
    Streaming,
    Paused,
    Completed,
    Expired,
    Disposed,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ResultStreamEvent {
    Start,
    TrancheLimitReached,
    Continue,
    Complete,
    Expire,
    Dispose,
    Fail,
}

impl ResultStreamState {
    pub fn transition(
        self,
        event: ResultStreamEvent,
    ) -> Result<Transition<Self>, InvalidTransition> {
        use ResultStreamEvent as E;
        use ResultStreamState as S;
        use StateEffect as F;
        let transition = match (self, event) {
            (S::Created, E::Start) => Transition::new(S::Streaming, [F::AllocateResource]),
            (S::Streaming, E::TrancheLimitReached) => Transition::new(S::Paused, [F::PersistState]),
            (S::Paused, E::Continue) => Transition::new(S::Streaming, [F::Noop]),
            (S::Streaming | S::Paused, E::Complete) => {
                Transition::new(S::Completed, [F::ReleaseResource])
            }
            (S::Streaming | S::Paused | S::Completed, E::Expire) => {
                Transition::new(S::Expired, [F::ReleaseResource, F::InvalidateLateEvents])
            }
            (
                S::Created | S::Streaming | S::Paused | S::Completed | S::Expired | S::Failed,
                E::Dispose,
            ) => Transition::new(S::Disposed, [F::ReleaseResource, F::InvalidateLateEvents]),
            (S::Streaming | S::Paused, E::Fail) => Transition::new(S::Failed, [F::ReleaseResource]),
            _ => return Err(invalid("result_stream", self, event)),
        };
        Ok(transition)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TableDataState {
    Clean,
    Staged,
    Previewing,
    Applying,
    Conflicted,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TableDataEvent {
    Stage,
    Discard,
    Preview,
    ReturnToStage,
    Apply,
    Applied,
    Conflict,
    Resolve,
}

impl TableDataState {
    pub fn transition(self, event: TableDataEvent) -> Result<Transition<Self>, InvalidTransition> {
        use StateEffect as F;
        use TableDataEvent as E;
        use TableDataState as S;
        let transition = match (self, event) {
            (S::Clean, E::Stage) => Transition::new(S::Staged, [F::PersistState]),
            (S::Staged, E::Discard) => Transition::new(S::Clean, [F::ReleaseResource]),
            (S::Staged, E::Preview) => Transition::new(S::Previewing, [F::PersistState]),
            (S::Previewing, E::ReturnToStage) => Transition::new(S::Staged, [F::Noop]),
            (S::Previewing, E::Apply) => Transition::new(S::Applying, [F::AllocateResource]),
            (S::Applying, E::Applied) => Transition::new(S::Clean, [F::ReleaseResource]),
            (S::Applying, E::Conflict) => {
                Transition::new(S::Conflicted, [F::PreserveLastValidData])
            }
            (S::Conflicted, E::Resolve) => Transition::new(S::Staged, [F::PersistState]),
            _ => return Err(invalid("table_data", self, event)),
        };
        Ok(transition)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalStoreState {
    Healthy,
    Degraded,
    MigrationFailed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LocalStoreEvent {
    StorageFailure,
    MigrationFailure,
    RecoverySucceeded,
    RecoveryFailed,
}

impl LocalStoreState {
    pub fn transition(self, event: LocalStoreEvent) -> Result<Transition<Self>, InvalidTransition> {
        use LocalStoreEvent as E;
        use LocalStoreState as S;
        use StateEffect as F;
        let transition = match (self, event) {
            (S::Healthy, E::StorageFailure) => {
                Transition::new(S::Degraded, [F::PreserveLastValidData])
            }
            (S::Healthy | S::Degraded, E::MigrationFailure) => {
                Transition::new(S::MigrationFailed, [F::PreserveLastValidData])
            }
            (S::Degraded | S::MigrationFailed, E::RecoverySucceeded) => {
                Transition::new(S::Healthy, [F::PersistState])
            }
            (S::Degraded, E::RecoveryFailed) => {
                Transition::new(S::Degraded, [F::PreserveLastValidData])
            }
            (S::MigrationFailed, E::RecoveryFailed) => {
                Transition::new(S::MigrationFailed, [F::PreserveLastValidData])
            }
            _ => return Err(invalid("local_store", self, event)),
        };
        Ok(transition)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportState {
    Planned,
    Writing,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExportEvent {
    Start,
    Complete,
    Fail,
    Cancel,
}

impl ExportState {
    pub fn transition(self, event: ExportEvent) -> Result<Transition<Self>, InvalidTransition> {
        use ExportEvent as E;
        use ExportState as S;
        use StateEffect as F;
        let transition = match (self, event) {
            (S::Planned, E::Start) => Transition::new(S::Writing, [F::AllocateResource]),
            (S::Planned | S::Writing, E::Cancel) => {
                Transition::new(S::Cancelled, [F::BeginCancellation, F::ReleaseResource])
            }
            (S::Writing, E::Complete) => Transition::new(S::Completed, [F::ReleaseResource]),
            (S::Writing, E::Fail) => {
                Transition::new(S::Failed, [F::PreserveLastValidData, F::ReleaseResource])
            }
            _ => return Err(invalid("export", self, event)),
        };
        Ok(transition)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_required_machine_has_valid_and_safe_invalid_transitions() {
        assert_eq!(
            ProfileConnectionState::Disconnected
                .transition(ProfileConnectionEvent::ConnectRequested)
                .unwrap()
                .state,
            ProfileConnectionState::Connecting
        );
        assert!(
            ProfileConnectionState::Connected
                .transition(ProfileConnectionEvent::ConnectSucceeded)
                .is_err()
        );

        assert_eq!(
            TabState::OfflineDirty
                .transition(TabEvent::CloseRequested)
                .unwrap()
                .state,
            TabState::CloseDecision
        );
        assert!(TabState::Closed.transition(TabEvent::Edit).is_err());

        assert_eq!(
            NativeSessionState::TransactionActive
                .transition(NativeSessionEvent::ProtocolLost)
                .unwrap()
                .state,
            NativeSessionState::TransactionUnknown
        );
        assert!(
            NativeSessionState::TransactionUnknown
                .transition(NativeSessionEvent::Begin)
                .is_err()
        );

        assert_eq!(
            ExecutionState::Running
                .transition(ExecutionEvent::RequestCancel)
                .unwrap()
                .state,
            ExecutionState::CancelRequested
        );
        assert!(
            ExecutionState::Succeeded
                .transition(ExecutionEvent::Start)
                .is_err()
        );

        assert_eq!(
            ResultStreamState::Streaming
                .transition(ResultStreamEvent::TrancheLimitReached)
                .unwrap()
                .state,
            ResultStreamState::Paused
        );
        assert!(
            ResultStreamState::Disposed
                .transition(ResultStreamEvent::Continue)
                .is_err()
        );

        assert_eq!(
            TableDataState::Applying
                .transition(TableDataEvent::Conflict)
                .unwrap()
                .state,
            TableDataState::Conflicted
        );
        assert!(
            TableDataState::Clean
                .transition(TableDataEvent::Apply)
                .is_err()
        );

        assert_eq!(
            LocalStoreState::Healthy
                .transition(LocalStoreEvent::MigrationFailure)
                .unwrap()
                .state,
            LocalStoreState::MigrationFailed
        );
        assert!(
            LocalStoreState::Healthy
                .transition(LocalStoreEvent::RecoverySucceeded)
                .is_err()
        );

        assert_eq!(
            ExportState::Writing
                .transition(ExportEvent::Fail)
                .unwrap()
                .state,
            ExportState::Failed
        );
        assert!(
            ExportState::Completed
                .transition(ExportEvent::Start)
                .is_err()
        );
    }

    #[test]
    fn terminal_execution_invalidates_late_events_exactly_once() {
        let transition = ExecutionState::Running
            .transition(ExecutionEvent::Complete)
            .unwrap();
        assert_eq!(transition.state, ExecutionState::Succeeded);
        assert_eq!(
            transition
                .effects
                .iter()
                .filter(|effect| **effect == StateEffect::InvalidateLateEvents)
                .count(),
            1
        );
        assert!(
            transition
                .state
                .transition(ExecutionEvent::Complete)
                .is_err()
        );
    }
}
