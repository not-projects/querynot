use crate::{ExecutionId, NativeSessionId, ProfileId, TabId, WindowId};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct TabOwner {
    window_id: WindowId,
    profile_id: Option<ProfileId>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct SessionOwner {
    window_id: WindowId,
    profile_id: ProfileId,
    tab_id: TabId,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ExecutionOwner {
    window_id: WindowId,
    profile_id: ProfileId,
    tab_id: TabId,
    session_id: NativeSessionId,
}

#[derive(Clone, Debug, Default)]
pub struct OwnershipRegistry {
    profiles: HashMap<ProfileId, WindowId>,
    tabs: HashMap<TabId, TabOwner>,
    sessions: HashMap<NativeSessionId, SessionOwner>,
    executions: HashMap<ExecutionId, ExecutionOwner>,
    terminal_executions: HashSet<ExecutionId>,
}

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum OwnershipError {
    #[error("resource does not exist or is not owned by this request")]
    NotOwned,
    #[error("resource identifier is already registered")]
    AlreadyRegistered,
    #[error("terminal execution cannot accept another event")]
    TerminalExecution,
}

impl From<OwnershipError> for crate::QueryNotError {
    fn from(_error: OwnershipError) -> Self {
        crate::QueryNotError::authorization(
            "Resource does not exist or is not owned by this window.",
        )
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct CleanupPlan {
    pub executions: Vec<ExecutionId>,
    pub sessions: Vec<NativeSessionId>,
    pub tabs: Vec<TabId>,
}

impl OwnershipRegistry {
    pub fn register_profile(
        &mut self,
        window_id: WindowId,
        profile_id: ProfileId,
    ) -> Result<(), OwnershipError> {
        if self.profiles.insert(profile_id, window_id).is_some() {
            return Err(OwnershipError::AlreadyRegistered);
        }
        Ok(())
    }

    pub fn register_tab(
        &mut self,
        window_id: WindowId,
        profile_id: Option<ProfileId>,
        tab_id: TabId,
    ) -> Result<(), OwnershipError> {
        if profile_id.is_some_and(|id| self.profiles.get(&id) != Some(&window_id)) {
            return Err(OwnershipError::NotOwned);
        }
        if self
            .tabs
            .insert(
                tab_id,
                TabOwner {
                    window_id,
                    profile_id,
                },
            )
            .is_some()
        {
            return Err(OwnershipError::AlreadyRegistered);
        }
        Ok(())
    }

    pub fn authorize_profile(
        &self,
        window_id: WindowId,
        profile_id: ProfileId,
    ) -> Result<(), OwnershipError> {
        (self.profiles.get(&profile_id) == Some(&window_id))
            .then_some(())
            .ok_or(OwnershipError::NotOwned)
    }

    pub fn authorize_tab(
        &self,
        window_id: WindowId,
        profile_id: Option<ProfileId>,
        tab_id: TabId,
    ) -> Result<(), OwnershipError> {
        let expected = TabOwner {
            window_id,
            profile_id,
        };
        (self.tabs.get(&tab_id) == Some(&expected))
            .then_some(())
            .ok_or(OwnershipError::NotOwned)
    }

    pub fn unregister_tab(
        &mut self,
        window_id: WindowId,
        tab_id: TabId,
    ) -> Result<(), OwnershipError> {
        if self
            .sessions
            .values()
            .any(|owner| owner.window_id == window_id && owner.tab_id == tab_id)
        {
            return Err(OwnershipError::NotOwned);
        }
        match self.tabs.get(&tab_id) {
            Some(owner) if owner.window_id == window_id => {
                self.tabs.remove(&tab_id);
                Ok(())
            }
            _ => Err(OwnershipError::NotOwned),
        }
    }

    pub fn unregister_profile(&mut self, profile_id: ProfileId) -> Result<(), OwnershipError> {
        if self.has_active_profile_resources(profile_id) {
            return Err(OwnershipError::NotOwned);
        }
        self.tabs
            .retain(|_, owner| owner.profile_id != Some(profile_id));
        if self.profiles.remove(&profile_id).is_none() {
            return Err(OwnershipError::NotOwned);
        }
        Ok(())
    }

    pub fn register_session(
        &mut self,
        window_id: WindowId,
        profile_id: ProfileId,
        tab_id: TabId,
        session_id: NativeSessionId,
    ) -> Result<(), OwnershipError> {
        let expected = TabOwner {
            window_id,
            profile_id: Some(profile_id),
        };
        if self.tabs.get(&tab_id) != Some(&expected) {
            return Err(OwnershipError::NotOwned);
        }
        if self
            .sessions
            .insert(
                session_id,
                SessionOwner {
                    window_id,
                    profile_id,
                    tab_id,
                },
            )
            .is_some()
        {
            return Err(OwnershipError::AlreadyRegistered);
        }
        Ok(())
    }

    pub fn register_execution(
        &mut self,
        window_id: WindowId,
        profile_id: ProfileId,
        tab_id: TabId,
        session_id: NativeSessionId,
        execution_id: ExecutionId,
    ) -> Result<(), OwnershipError> {
        let expected = SessionOwner {
            window_id,
            profile_id,
            tab_id,
        };
        if self.sessions.get(&session_id) != Some(&expected) {
            return Err(OwnershipError::NotOwned);
        }
        if self
            .executions
            .insert(
                execution_id,
                ExecutionOwner {
                    window_id,
                    profile_id,
                    tab_id,
                    session_id,
                },
            )
            .is_some()
        {
            return Err(OwnershipError::AlreadyRegistered);
        }
        Ok(())
    }

    pub fn authorize_execution(
        &self,
        window_id: WindowId,
        profile_id: ProfileId,
        tab_id: TabId,
        session_id: NativeSessionId,
        execution_id: ExecutionId,
    ) -> Result<(), OwnershipError> {
        if self.terminal_executions.contains(&execution_id) {
            return Err(OwnershipError::TerminalExecution);
        }
        let expected = ExecutionOwner {
            window_id,
            profile_id,
            tab_id,
            session_id,
        };
        (self.executions.get(&execution_id) == Some(&expected))
            .then_some(())
            .ok_or(OwnershipError::NotOwned)
    }

    pub fn mark_execution_terminal(
        &mut self,
        window_id: WindowId,
        profile_id: ProfileId,
        tab_id: TabId,
        session_id: NativeSessionId,
        execution_id: ExecutionId,
    ) -> Result<(), OwnershipError> {
        self.authorize_execution(window_id, profile_id, tab_id, session_id, execution_id)?;
        self.executions.remove(&execution_id);
        self.terminal_executions.insert(execution_id);
        Ok(())
    }

    #[must_use]
    pub fn has_active_profile_resources(&self, profile_id: ProfileId) -> bool {
        self.sessions
            .values()
            .any(|owner| owner.profile_id == profile_id)
            || self
                .executions
                .values()
                .any(|owner| owner.profile_id == profile_id)
    }

    pub fn cleanup_window(&mut self, window_id: WindowId) -> CleanupPlan {
        let executions = self
            .executions
            .iter()
            .filter_map(|(id, owner)| (owner.window_id == window_id).then_some(*id))
            .collect::<Vec<_>>();
        for id in &executions {
            self.executions.remove(id);
            self.terminal_executions.insert(*id);
        }

        let sessions = self
            .sessions
            .iter()
            .filter_map(|(id, owner)| (owner.window_id == window_id).then_some(*id))
            .collect::<Vec<_>>();
        for id in &sessions {
            self.sessions.remove(id);
        }

        let tabs = self
            .tabs
            .iter()
            .filter_map(|(id, owner)| (owner.window_id == window_id).then_some(*id))
            .collect::<Vec<_>>();
        for id in &tabs {
            self.tabs.remove(id);
        }
        self.profiles.retain(|_, owner| *owner != window_id);

        CleanupPlan {
            executions,
            sessions,
            tabs,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cross_profile_and_cross_window_access_fails_closed() {
        let window_a = WindowId::new();
        let window_b = WindowId::new();
        let profile_a = ProfileId::new();
        let profile_b = ProfileId::new();
        let tab = TabId::new();
        let session = NativeSessionId::new();
        let execution = ExecutionId::new();
        let mut owners = OwnershipRegistry::default();

        owners.register_profile(window_a, profile_a).unwrap();
        owners.register_profile(window_b, profile_b).unwrap();
        owners.register_tab(window_a, Some(profile_a), tab).unwrap();
        owners
            .register_session(window_a, profile_a, tab, session)
            .unwrap();
        owners
            .register_execution(window_a, profile_a, tab, session, execution)
            .unwrap();

        assert_eq!(
            owners.authorize_execution(window_b, profile_b, tab, session, execution),
            Err(OwnershipError::NotOwned)
        );
        assert_eq!(
            owners.authorize_tab(window_b, Some(profile_a), tab),
            Err(OwnershipError::NotOwned)
        );
        assert_eq!(
            owners.authorize_tab(window_a, Some(profile_b), tab),
            Err(OwnershipError::NotOwned)
        );
        assert_eq!(
            owners.authorize_execution(window_a, profile_b, tab, session, execution),
            Err(OwnershipError::NotOwned)
        );
        owners
            .mark_execution_terminal(window_a, profile_a, tab, session, execution)
            .unwrap();
        assert_eq!(
            owners.authorize_execution(window_a, profile_a, tab, session, execution),
            Err(OwnershipError::TerminalExecution)
        );
    }

    #[test]
    fn frontend_reload_produces_native_cleanup_plan() {
        let window = WindowId::new();
        let profile = ProfileId::new();
        let tab = TabId::new();
        let session = NativeSessionId::new();
        let execution = ExecutionId::new();
        let mut owners = OwnershipRegistry::default();
        owners.register_profile(window, profile).unwrap();
        owners.register_tab(window, Some(profile), tab).unwrap();
        owners
            .register_session(window, profile, tab, session)
            .unwrap();
        owners
            .register_execution(window, profile, tab, session, execution)
            .unwrap();

        let cleanup = owners.cleanup_window(window);
        assert_eq!(cleanup.executions, vec![execution]);
        assert_eq!(cleanup.sessions, vec![session]);
        assert_eq!(cleanup.tabs, vec![tab]);
        assert!(!owners.has_active_profile_resources(profile));
    }
}
