use serde::{Deserialize, Serialize};

use crate::profile::{ConnectionProfile, ConnectionTarget};
use crate::sqlite::{
    ExecutionControl, SchemaNamespace, SchemaObject, SchemaObjectDetail, SqliteExecutionEvent,
    SqliteSession, SqliteTransactionState,
};
use crate::table::{BrowseInput, MutationApplyResult, MutationPlan, TablePage};
use crate::vault::ConnectionSecrets;
use crate::{ExecutionId, QueryNotError};
use std::path::Path;
use tokio::sync::mpsc;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseFamily {
    Sqlite,
    MySqlFamily,
    Postgres,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ServerIdentity {
    pub family: DatabaseFamily,
    pub product: String,
    pub exact_version: String,
    pub legacy: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CompatibilityStatus {
    Supported,
    QueryOnly,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct AdapterConnectionInfo {
    pub identity: ServerIdentity,
    pub capabilities: AdapterCapabilities,
    pub read_only: bool,
    pub context: String,
    pub dialect: String,
    pub compatibility_status: CompatibilityStatus,
    pub compatibility_warning: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct AdapterCapabilities {
    pub metadata: bool,
    pub streaming: bool,
    pub cancellation: bool,
    pub explain: bool,
    pub transactions: bool,
    pub multiple_results: bool,
    pub safe_table_mutations: bool,
}

#[derive(Clone)]
pub enum AdapterSession {
    Sqlite(SqliteSession),
    MySql(Box<crate::mysql::MySqlSession>),
    Postgres(Box<crate::postgres::PostgresSession>),
}

impl AdapterSession {
    pub async fn open(
        profile: &ConnectionProfile,
        secrets: &ConnectionSecrets,
    ) -> Result<Self, QueryNotError> {
        match &profile.target {
            ConnectionTarget::Sqlite {
                file_path,
                read_only,
            } => SqliteSession::open(Path::new(file_path), *read_only)
                .await
                .map(Self::Sqlite),
            ConnectionTarget::MysqlFamily { .. } => {
                crate::mysql::MySqlSession::open(profile, secrets)
                    .await
                    .map(Box::new)
                    .map(Self::MySql)
            }
            ConnectionTarget::Postgres { .. } => {
                crate::postgres::PostgresSession::open(profile, secrets)
                    .await
                    .map(Box::new)
                    .map(Self::Postgres)
            }
        }
    }

    pub async fn test_connection(
        profile: &ConnectionProfile,
        secrets: &ConnectionSecrets,
    ) -> Result<AdapterConnectionInfo, QueryNotError> {
        match &profile.target {
            ConnectionTarget::Sqlite {
                file_path,
                read_only,
            } => crate::sqlite::test_sqlite_connection(Path::new(file_path), *read_only).await,
            ConnectionTarget::MysqlFamily { .. } => {
                crate::mysql::MySqlSession::test(profile, secrets).await
            }
            ConnectionTarget::Postgres { .. } => {
                crate::postgres::PostgresSession::test(profile, secrets).await
            }
        }
    }

    #[must_use]
    pub fn read_only(&self) -> bool {
        match self {
            Self::Sqlite(session) => session.read_only(),
            Self::MySql(session) => session.read_only(),
            Self::Postgres(session) => session.read_only(),
        }
    }

    pub fn request_cancel(&self) -> bool {
        match self {
            Self::Sqlite(session) => session.request_cancel(),
            Self::MySql(session) => session.request_cancel(),
            Self::Postgres(session) => session.request_cancel(),
        }
    }

    pub async fn connection_info(
        &self,
        profile: &ConnectionProfile,
    ) -> Result<AdapterConnectionInfo, QueryNotError> {
        match self {
            Self::Sqlite(session) => session.connection_info().await,
            Self::MySql(session) => session.connection_info(profile).await,
            Self::Postgres(session) => session.connection_info(profile).await,
        }
    }

    pub async fn namespaces(&self) -> Result<Vec<SchemaNamespace>, QueryNotError> {
        match self {
            Self::Sqlite(session) => session.namespaces().await,
            Self::MySql(session) => session.namespaces().await,
            Self::Postgres(session) => session.namespaces().await,
        }
    }

    pub async fn objects(&self, namespace: &str) -> Result<Vec<SchemaObject>, QueryNotError> {
        match self {
            Self::Sqlite(session) => session.objects(namespace).await,
            Self::MySql(session) => session.objects(namespace).await,
            Self::Postgres(session) => session.objects(namespace).await,
        }
    }

    pub async fn object_detail(
        &self,
        namespace: &str,
        object_name: &str,
    ) -> Result<SchemaObjectDetail, QueryNotError> {
        match self {
            Self::Sqlite(session) => session.object_detail(namespace, object_name).await,
            Self::MySql(session) => session.object_detail(namespace, object_name).await,
            Self::Postgres(session) => session.object_detail(namespace, object_name).await,
        }
    }

    pub async fn change_context(&self, context: &str) -> Result<String, QueryNotError> {
        match self {
            Self::Sqlite(session) => session.change_context(context).await,
            Self::MySql(session) => session.change_context(context).await,
            Self::Postgres(session) => session.change_context(context).await,
        }
    }

    pub async fn browse_table(
        &self,
        namespace: &str,
        table: &str,
        input: &BrowseInput,
    ) -> Result<TablePage, QueryNotError> {
        match self {
            Self::Sqlite(session) => session.browse_table(namespace, table, input).await,
            Self::MySql(session) => session.browse_table(namespace, table, input).await,
            Self::Postgres(session) => session.browse_table(namespace, table, input).await,
        }
    }

    pub async fn apply_table_mutations(
        &self,
        plan: &MutationPlan,
    ) -> Result<MutationApplyResult, QueryNotError> {
        match self {
            Self::Sqlite(session) => session.apply_table_mutations(plan).await,
            Self::MySql(session) => session.apply_table_mutations(plan).await,
            Self::Postgres(session) => session.apply_table_mutations(plan).await,
        }
    }

    pub async fn transaction_state(&self) -> SqliteTransactionState {
        match self {
            Self::Sqlite(session) => session.transaction_state().await,
            Self::MySql(session) => session.transaction_state().await,
            Self::Postgres(session) => session.transaction_state().await,
        }
    }

    pub async fn set_automatic(
        &self,
        automatic: bool,
    ) -> Result<SqliteTransactionState, QueryNotError> {
        match self {
            Self::Sqlite(session) => session.set_automatic(automatic).await,
            Self::MySql(session) => session.set_automatic(automatic).await,
            Self::Postgres(session) => session.set_automatic(automatic).await,
        }
    }

    pub async fn commit(&self) -> Result<SqliteTransactionState, QueryNotError> {
        match self {
            Self::Sqlite(session) => session.commit().await,
            Self::MySql(session) => session.commit().await,
            Self::Postgres(session) => session.commit().await,
        }
    }

    pub async fn rollback(&self) -> Result<SqliteTransactionState, QueryNotError> {
        match self {
            Self::Sqlite(session) => session.rollback().await,
            Self::MySql(session) => session.rollback().await,
            Self::Postgres(session) => session.rollback().await,
        }
    }

    pub async fn execute(
        &self,
        execution_id: ExecutionId,
        plan: crate::sql::ExecutionPlan,
        tranche_rows: usize,
        controls: mpsc::Receiver<ExecutionControl>,
        events: mpsc::Sender<SqliteExecutionEvent>,
    ) {
        match self {
            Self::Sqlite(session) => {
                session
                    .execute(execution_id, plan, tranche_rows, controls, events)
                    .await;
            }
            Self::MySql(session) => {
                session
                    .execute(execution_id, plan, tranche_rows, controls, events)
                    .await;
            }
            Self::Postgres(session) => {
                session
                    .execute(execution_id, plan, tranche_rows, controls, events)
                    .await;
            }
        }
    }

    pub async fn explain(&self, sql: &str, product: &str) -> crate::explain::ExplainRunOutcome {
        match self {
            Self::Sqlite(session) => session.explain(sql).await,
            Self::MySql(session) => session.explain(sql, product).await,
            Self::Postgres(session) => session.explain(sql).await,
        }
    }
}
