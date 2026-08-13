use crate::adapter::{AdapterCapabilities, DatabaseFamily, ServerIdentity};
use crate::result::{
    MAX_BATCH_BYTES, MAX_BATCH_ROWS, MAX_RETAINED_BYTES, MAX_RETAINED_ROWS, PAUSED_CURSOR_LIFETIME,
    ResultBatch, ResultColumn, ResultTerminal, ResultTerminalState, tagged_value_size,
};
use crate::sql::{ExecutionPlan, leading_statement_keyword};
use crate::{ExecutionId, QueryNotError, ResultSetId, TaggedValue};
use futures_util::TryStreamExt;
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqliteRow};
use sqlx::{
    AssertSqlSafe, Column, ConnectOptions, Connection, Either, Executor, Row, SqlSafeStr,
    SqliteConnection, Statement, TypeInfo, ValueRef,
};
use std::path::Path;
#[cfg(test)]
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::{
    Arc, Mutex as StdMutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, mpsc};

const MAX_METADATA_NAME_BYTES: usize = 64 * 1024;
const MAX_SCHEMA_OBJECTS: usize = 10_000;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SqliteConnectionInfo {
    pub identity: ServerIdentity,
    pub capabilities: AdapterCapabilities,
    pub read_only: bool,
    pub context: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SchemaObjectKind {
    Table,
    View,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SchemaNamespace {
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SchemaObject {
    pub namespace: String,
    pub name: String,
    pub kind: SchemaObjectKind,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SchemaColumn {
    pub name: String,
    pub declared_type: String,
    pub nullable: bool,
    pub primary_key_position: u32,
    pub default_expression: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SchemaForeignKey {
    pub id: i64,
    pub sequence: i64,
    pub referenced_table: String,
    pub from_column: String,
    pub to_column: Option<String>,
    pub on_update: String,
    pub on_delete: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SchemaIndex {
    pub name: String,
    pub unique: bool,
    pub origin: String,
    pub columns: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SchemaObjectDetail {
    pub object: SchemaObject,
    pub columns: Vec<SchemaColumn>,
    pub foreign_keys: Vec<SchemaForeignKey>,
    pub indexes: Vec<SchemaIndex>,
    pub definition: Option<String>,
    pub routines_supported: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TransactionCertainty {
    Clean,
    Active,
    Unknown,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SqliteTransactionState {
    pub automatic: bool,
    pub certainty: TransactionCertainty,
}

#[derive(Clone, Debug)]
pub enum ExecutionControl {
    Acknowledge {
        result_set_id: ResultSetId,
        sequence: u64,
    },
    LoadMore {
        result_set_id: ResultSetId,
    },
    Discard {
        result_set_id: ResultSetId,
    },
    Cancel,
}

#[derive(Clone, Debug)]
pub enum SqliteExecutionEvent {
    Started {
        execution_id: ExecutionId,
        started_at: Instant,
        statement_count: usize,
    },
    Batch(ResultBatch),
    Paused {
        execution_id: ExecutionId,
        result_set_id: ResultSetId,
        sequence: u64,
        received_rows: usize,
        retained_bytes: usize,
    },
    StatementMessage {
        execution_id: ExecutionId,
        statement_index: u32,
        rows_affected: u64,
        duration: Duration,
        transaction: SqliteTransactionState,
    },
    ResultTerminal(ResultTerminal),
    Finished {
        execution_id: ExecutionId,
        statements_completed: usize,
        received_rows: usize,
        transaction: SqliteTransactionState,
    },
    Failed {
        execution_id: ExecutionId,
        statement_index: Option<u32>,
        statement_start: Option<usize>,
        statement_end: Option<usize>,
        error: QueryNotError,
        transaction: SqliteTransactionState,
    },
    Cancelled {
        execution_id: ExecutionId,
        confirmed: bool,
        transaction: SqliteTransactionState,
    },
}

#[derive(Clone)]
pub struct SqliteSession {
    connection: Arc<Mutex<SqliteConnection>>,
    read_only: bool,
    automatic: Arc<AtomicBool>,
    transaction: Arc<StdMutex<TransactionCertainty>>,
    active_cancel: Arc<StdMutex<Option<Arc<AtomicBool>>>>,
}

impl SqliteSession {
    pub async fn open(path: &Path, read_only: bool) -> Result<Self, QueryNotError> {
        let connection = SqliteConnection::connect_with(&connect_options(path, read_only, false)?)
            .await
            .map_err(map_sqlite_connect_error)?;
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
            read_only,
            automatic: Arc::new(AtomicBool::new(true)),
            transaction: Arc::new(StdMutex::new(TransactionCertainty::Clean)),
            active_cancel: Arc::new(StdMutex::new(None)),
        })
    }

    #[must_use]
    pub const fn read_only(&self) -> bool {
        self.read_only
    }

    pub fn request_cancel(&self) -> bool {
        self.active_cancel
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().cloned())
            .is_some_and(|flag| {
                flag.store(false, Ordering::Release);
                true
            })
    }

    pub async fn connection_info(&self) -> Result<SqliteConnectionInfo, QueryNotError> {
        let mut connection = self.connection.lock().await;
        connection_info(&mut connection, self.read_only).await
    }

    pub async fn namespaces(&self) -> Result<Vec<SchemaNamespace>, QueryNotError> {
        let mut connection = self.connection.lock().await;
        load_namespaces_connection(&mut connection).await
    }

    pub async fn objects(&self, namespace: &str) -> Result<Vec<SchemaObject>, QueryNotError> {
        let mut connection = self.connection.lock().await;
        load_objects_connection(&mut connection, namespace).await
    }

    pub async fn object_detail(
        &self,
        namespace: &str,
        object_name: &str,
    ) -> Result<SchemaObjectDetail, QueryNotError> {
        let mut connection = self.connection.lock().await;
        load_object_detail_connection(&mut connection, namespace, object_name).await
    }

    pub async fn transaction_state(&self) -> SqliteTransactionState {
        session_transaction_state(self)
    }

    pub async fn set_automatic(
        &self,
        automatic: bool,
    ) -> Result<SqliteTransactionState, QueryNotError> {
        if automatic && transaction_certainty(&self.transaction) != TransactionCertainty::Clean {
            return Err(QueryNotError::database(
                crate::ErrorCategory::Transaction,
                "Commit or roll back the open transaction before returning to auto-commit.",
                false,
            ));
        }
        self.automatic.store(automatic, Ordering::Release);
        Ok(session_transaction_state(self))
    }

    pub async fn commit(&self) -> Result<SqliteTransactionState, QueryNotError> {
        let mut connection = self.connection.lock().await;
        if transaction_certainty(&self.transaction) == TransactionCertainty::Clean {
            return Err(QueryNotError::database(
                crate::ErrorCategory::Transaction,
                "There is no open transaction to commit.",
                false,
            ));
        }
        connection
            .execute("COMMIT")
            .await
            .map_err(map_sqlite_execution_error)?;
        set_transaction_certainty(&self.transaction, TransactionCertainty::Clean);
        Ok(session_transaction_state(self))
    }

    pub async fn rollback(&self) -> Result<SqliteTransactionState, QueryNotError> {
        let mut connection = self.connection.lock().await;
        if transaction_certainty(&self.transaction) == TransactionCertainty::Clean {
            return Err(QueryNotError::database(
                crate::ErrorCategory::Transaction,
                "There is no open transaction to roll back.",
                false,
            ));
        }
        connection
            .execute("ROLLBACK")
            .await
            .map_err(map_sqlite_execution_error)?;
        set_transaction_certainty(&self.transaction, TransactionCertainty::Clean);
        Ok(session_transaction_state(self))
    }

    pub async fn execute(
        &self,
        execution_id: ExecutionId,
        plan: ExecutionPlan,
        tranche_rows: usize,
        mut controls: mpsc::Receiver<ExecutionControl>,
        events: mpsc::Sender<SqliteExecutionEvent>,
    ) {
        let cancel = Arc::new(AtomicBool::new(true));
        if let Ok(mut active) = self.active_cancel.lock() {
            *active = Some(Arc::clone(&cancel));
        }
        let started_at = Instant::now();
        let _ = events
            .send(SqliteExecutionEvent::Started {
                execution_id,
                started_at,
                statement_count: plan.statements.len(),
            })
            .await;
        let mut connection = self.connection.lock().await;
        let progress = Arc::clone(&cancel);
        if let Ok(mut handle) = connection.lock_handle().await {
            handle.set_progress_handler(1_000, move || progress.load(Ordering::Acquire));
        }

        let mut statements_completed = 0;
        let mut total_received: usize = 0;
        let mut failed = false;
        for statement in plan.statements {
            if !cancel.load(Ordering::Acquire) {
                break;
            }
            let keyword = leading_statement_keyword(&statement.sql).unwrap_or_default();
            let transaction_control = matches!(
                keyword.as_str(),
                "BEGIN" | "SAVEPOINT" | "COMMIT" | "END" | "ROLLBACK" | "RELEASE"
            );
            if !self.automatic.load(Ordering::Acquire)
                && transaction_certainty(&self.transaction) == TransactionCertainty::Clean
                && !transaction_control
            {
                if connection.execute("BEGIN DEFERRED").await.is_err() {
                    failed = true;
                    let _ = events
                        .send(SqliteExecutionEvent::Failed {
                            execution_id,
                            statement_index: Some(statement.index),
                            statement_start: Some(statement.start),
                            statement_end: Some(statement.end),
                            error: QueryNotError::database(
                                crate::ErrorCategory::Transaction,
                                "SQLite could not begin the manual transaction for this statement.",
                                true,
                            ),
                            transaction: session_transaction_state(self),
                        })
                        .await;
                    break;
                }
                set_transaction_certainty(&self.transaction, TransactionCertainty::Active);
            }
            let statement_started = Instant::now();
            let result_set_id = ResultSetId::new();
            let mut sequence = 0;
            let mut result_rows: usize = 0;
            let mut result_bytes: usize = 0;
            let mut rows_affected: u64 = 0;
            let mut columns = (&mut *connection)
                .prepare(AssertSqlSafe(statement.sql.as_str()).into_sql_str())
                .await
                .ok()
                .map(|prepared| {
                    prepared
                        .columns()
                        .iter()
                        .map(|column| ResultColumn {
                            name: column.name().to_owned(),
                            declared_type: column.type_info().name().to_owned(),
                            nullable: None,
                        })
                        .collect::<Vec<_>>()
                })
                .filter(|columns| !columns.is_empty());
            let mut batch_rows = Vec::new();
            let mut batch_bytes: usize = 0;
            let mut tranche_limit = tranche_rows.clamp(100, 50_000);
            let mut capped = false;
            let mut discarded = false;
            let mut expired = false;
            let mut statement_error: Option<QueryNotError> = None;

            // This is the explicit editor-SQL execution boundary. The text is intentionally
            // user-authored and is never combined with application-generated identifiers or
            // values before entering SQLx's audited dynamic-SQL API.
            let mut stream =
                sqlx::raw_sql(AssertSqlSafe(statement.sql.as_str())).fetch_many(&mut *connection);
            loop {
                let item = stream.try_next().await;
                match item {
                    Ok(Some(Either::Left(done))) => {
                        rows_affected = rows_affected.saturating_add(done.rows_affected());
                    }
                    Ok(Some(Either::Right(row))) => {
                        let row_columns = columns.get_or_insert_with(|| sqlite_columns(&row));
                        let values = match sqlite_values(&row) {
                            Ok(values) => values,
                            Err(error) => {
                                statement_error = Some(error);
                                failed = true;
                                break;
                            }
                        };
                        if values.len() != row_columns.len() {
                            statement_error = Some(QueryNotError::internal(
                                "SQLite returned a row whose shape changed during streaming.",
                            ));
                            failed = true;
                            break;
                        }
                        let row_bytes = values.iter().map(tagged_value_size).sum::<usize>();
                        if row_bytes > MAX_BATCH_BYTES
                            || result_rows >= MAX_RETAINED_ROWS
                            || result_bytes.saturating_add(row_bytes) > MAX_RETAINED_BYTES
                        {
                            capped = true;
                            break;
                        }
                        if !batch_rows.is_empty()
                            && (batch_rows.len() >= MAX_BATCH_ROWS
                                || batch_bytes.saturating_add(row_bytes) > MAX_BATCH_BYTES)
                        {
                            let batch = make_batch(
                                execution_id,
                                result_set_id,
                                sequence,
                                statement.index,
                                columns.take(),
                                std::mem::take(&mut batch_rows),
                                batch_bytes,
                            );
                            if !send_batch_and_wait(batch, &events, &mut controls, &cancel).await {
                                discarded = true;
                                break;
                            }
                            sequence += 1;
                            batch_bytes = 0;
                        }
                        batch_bytes = batch_bytes.saturating_add(row_bytes);
                        result_bytes = result_bytes.saturating_add(row_bytes);
                        result_rows += 1;
                        total_received += 1;
                        batch_rows.push(values);

                        if result_rows >= MAX_RETAINED_ROWS || result_bytes >= MAX_RETAINED_BYTES {
                            capped = true;
                            break;
                        }

                        if result_rows >= tranche_limit {
                            if !batch_rows.is_empty() {
                                let batch = make_batch(
                                    execution_id,
                                    result_set_id,
                                    sequence,
                                    statement.index,
                                    columns.take(),
                                    std::mem::take(&mut batch_rows),
                                    batch_bytes,
                                );
                                if !send_batch_and_wait(batch, &events, &mut controls, &cancel)
                                    .await
                                {
                                    discarded = true;
                                    break;
                                }
                                sequence += 1;
                                batch_bytes = 0;
                            }
                            let _ = events
                                .send(SqliteExecutionEvent::Paused {
                                    execution_id,
                                    result_set_id,
                                    sequence,
                                    received_rows: result_rows,
                                    retained_bytes: result_bytes,
                                })
                                .await;
                            match wait_for_more(result_set_id, &mut controls, &cancel).await {
                                MoreDecision::Continue => {
                                    tranche_limit = tranche_limit
                                        .saturating_add(tranche_rows.clamp(100, 50_000));
                                }
                                MoreDecision::Discard => {
                                    discarded = true;
                                    break;
                                }
                                MoreDecision::Expire => {
                                    expired = true;
                                    break;
                                }
                                MoreDecision::Cancel => break,
                            }
                        }
                    }
                    Ok(None) => break,
                    Err(error) => {
                        let category = if !cancel.load(Ordering::Acquire) {
                            crate::ErrorCategory::Cancelled
                        } else {
                            sqlite_error_category(&error)
                        };
                        if category != crate::ErrorCategory::Cancelled {
                            statement_error = Some(map_sqlite_execution_error(error));
                            failed = true;
                        }
                        break;
                    }
                }
            }
            drop(stream);

            if let Some(error) = statement_error {
                let unsent_rows = batch_rows.len();
                result_rows = result_rows.saturating_sub(unsent_rows);
                total_received = total_received.saturating_sub(unsent_rows);
                result_bytes = result_bytes.saturating_sub(batch_bytes);
                batch_rows.clear();
                batch_bytes = 0;
                let _ = events
                    .send(SqliteExecutionEvent::Failed {
                        execution_id,
                        statement_index: Some(statement.index),
                        statement_start: Some(statement.start),
                        statement_end: Some(statement.end),
                        error,
                        transaction: mark_unknown_if_active(self),
                    })
                    .await;
            }

            if !batch_rows.is_empty() && cancel.load(Ordering::Acquire) && !discarded && !failed {
                let batch = make_batch(
                    execution_id,
                    result_set_id,
                    sequence,
                    statement.index,
                    columns.take(),
                    batch_rows,
                    batch_bytes,
                );
                if send_batch_and_wait(batch, &events, &mut controls, &cancel).await {
                    sequence += 1;
                } else {
                    discarded = true;
                }
            } else if result_rows == 0
                && columns.as_ref().is_some_and(|columns| !columns.is_empty())
                && cancel.load(Ordering::Acquire)
                && !discarded
                && !failed
            {
                let batch = make_batch(
                    execution_id,
                    result_set_id,
                    sequence,
                    statement.index,
                    columns.take(),
                    Vec::new(),
                    0,
                );
                if send_batch_and_wait(batch, &events, &mut controls, &cancel).await {
                    sequence += 1;
                } else {
                    discarded = true;
                }
            }

            if sequence > 0 {
                let terminal_state = if !cancel.load(Ordering::Acquire) {
                    ResultTerminalState::Cancelled
                } else if failed {
                    ResultTerminalState::Failed
                } else if expired {
                    ResultTerminalState::Expired
                } else if discarded {
                    ResultTerminalState::Disposed
                } else {
                    ResultTerminalState::Completed
                };
                let _ = events
                    .send(SqliteExecutionEvent::ResultTerminal(ResultTerminal {
                        execution_id,
                        result_set_id,
                        sequence,
                        state: terminal_state,
                        received_rows: result_rows,
                        retained_bytes: result_bytes,
                        capped,
                    }))
                    .await;
            }
            if failed || !cancel.load(Ordering::Acquire) {
                break;
            }
            reconcile_transaction_statement(&self.transaction, &statement.sql);
            statements_completed += 1;
            let _ = events
                .send(SqliteExecutionEvent::StatementMessage {
                    execution_id,
                    statement_index: statement.index,
                    rows_affected,
                    duration: statement_started.elapsed(),
                    transaction: session_transaction_state(self),
                })
                .await;
        }

        cleanup_progress(&mut connection).await;
        let transaction = session_transaction_state(self);
        if !failed {
            if cancel.load(Ordering::Acquire) {
                let _ = events
                    .send(SqliteExecutionEvent::Finished {
                        execution_id,
                        statements_completed,
                        received_rows: total_received,
                        transaction,
                    })
                    .await;
            } else {
                let _ = events
                    .send(SqliteExecutionEvent::Cancelled {
                        execution_id,
                        confirmed: true,
                        transaction,
                    })
                    .await;
            }
        }
        clear_active_cancel(&self.active_cancel);
    }
}

pub async fn test_sqlite_connection(
    path: &Path,
    read_only: bool,
) -> Result<SqliteConnectionInfo, QueryNotError> {
    let mut connection = SqliteConnection::connect_with(&connect_options(path, read_only, false)?)
        .await
        .map_err(map_sqlite_connect_error)?;
    let info = connection_info(&mut connection, read_only).await?;
    connection.close().await.map_err(map_sqlite_connect_error)?;
    Ok(info)
}

pub async fn create_sqlite_file(path: &Path) -> Result<SqliteConnectionInfo, QueryNotError> {
    if path.exists() {
        return Err(QueryNotError::authorization(
            "The selected SQLite destination already exists; QueryNot did not overwrite it.",
        ));
    }
    let mut connection = SqliteConnection::connect_with(&connect_options(path, false, true)?)
        .await
        .map_err(map_sqlite_connect_error)?;
    let info = connection_info(&mut connection, false).await?;
    connection.close().await.map_err(map_sqlite_connect_error)?;
    Ok(info)
}

pub async fn load_namespaces(
    path: &Path,
    read_only: bool,
) -> Result<Vec<SchemaNamespace>, QueryNotError> {
    let mut connection = SqliteConnection::connect_with(&connect_options(path, read_only, false)?)
        .await
        .map_err(map_sqlite_connect_error)?;
    load_namespaces_connection(&mut connection).await
}

async fn load_namespaces_connection(
    connection: &mut SqliteConnection,
) -> Result<Vec<SchemaNamespace>, QueryNotError> {
    let rows = sqlx::query("PRAGMA database_list")
        .fetch_all(connection)
        .await
        .map_err(map_sqlite_execution_error)?;
    rows.into_iter()
        .map(|row| {
            let name: String = row.try_get("name").map_err(map_sqlite_execution_error)?;
            validate_metadata(&name)?;
            Ok(SchemaNamespace { name })
        })
        .collect()
}

pub async fn load_objects(
    path: &Path,
    read_only: bool,
    namespace: &str,
) -> Result<Vec<SchemaObject>, QueryNotError> {
    let mut connection = SqliteConnection::connect_with(&connect_options(path, read_only, false)?)
        .await
        .map_err(map_sqlite_connect_error)?;
    load_objects_connection(&mut connection, namespace).await
}

async fn load_objects_connection(
    connection: &mut SqliteConnection,
    namespace: &str,
) -> Result<Vec<SchemaObject>, QueryNotError> {
    validate_namespace(namespace)?;
    ensure_namespace(connection, namespace).await?;
    let sql = format!(
        "SELECT name, type FROM {}.sqlite_schema WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name LIMIT {}",
        quote_identifier(namespace),
        MAX_SCHEMA_OBJECTS + 1
    );
    // The namespace is validated against PRAGMA database_list and quoted locally; the
    // remaining SQL is application-owned.
    let rows = sqlx::query(AssertSqlSafe(sql.as_str()))
        .fetch_all(connection)
        .await
        .map_err(map_sqlite_execution_error)?;
    if rows.len() > MAX_SCHEMA_OBJECTS {
        return Err(QueryNotError::database(
            crate::ErrorCategory::UnsupportedCapability,
            "This SQLite namespace exceeds the 10,000-object explorer safety limit.",
            false,
        ));
    }
    rows.into_iter()
        .map(|row| {
            let name: String = row.try_get("name").map_err(map_sqlite_execution_error)?;
            let kind: String = row.try_get("type").map_err(map_sqlite_execution_error)?;
            validate_metadata(&name)?;
            Ok(SchemaObject {
                namespace: namespace.to_owned(),
                name,
                kind: if kind == "view" {
                    SchemaObjectKind::View
                } else {
                    SchemaObjectKind::Table
                },
            })
        })
        .collect()
}

pub async fn load_object_detail(
    path: &Path,
    read_only: bool,
    namespace: &str,
    object_name: &str,
) -> Result<SchemaObjectDetail, QueryNotError> {
    let mut connection = SqliteConnection::connect_with(&connect_options(path, read_only, false)?)
        .await
        .map_err(map_sqlite_connect_error)?;
    load_object_detail_connection(&mut connection, namespace, object_name).await
}

async fn load_object_detail_connection(
    connection: &mut SqliteConnection,
    namespace: &str,
    object_name: &str,
) -> Result<SchemaObjectDetail, QueryNotError> {
    validate_namespace(namespace)?;
    validate_metadata(object_name)?;
    ensure_namespace(connection, namespace).await?;
    let schema_sql = format!(
        "SELECT type, sql FROM {}.sqlite_schema WHERE name = ? AND type IN ('table', 'view')",
        quote_identifier(namespace)
    );
    let row = sqlx::query(AssertSqlSafe(schema_sql.as_str()))
        .bind(object_name)
        .fetch_optional(&mut *connection)
        .await
        .map_err(map_sqlite_execution_error)?
        .ok_or_else(|| {
            QueryNotError::database(
                crate::ErrorCategory::UnsupportedCapability,
                "The selected SQLite object no longer exists.",
                true,
            )
        })?;
    let kind: String = row.try_get("type").map_err(map_sqlite_execution_error)?;
    let definition: Option<String> = row.try_get("sql").map_err(map_sqlite_execution_error)?;
    if let Some(definition) = &definition {
        validate_metadata(definition)?;
    }
    let columns = sqlx::query(
        "SELECT name, type, \"notnull\", dflt_value, pk FROM pragma_table_xinfo(?) ORDER BY cid",
    )
    .bind(object_name)
    .fetch_all(&mut *connection)
    .await
    .map_err(map_sqlite_execution_error)?
    .into_iter()
    .map(|row| {
        let name: String = row.try_get("name").map_err(map_sqlite_execution_error)?;
        let declared_type: String = row.try_get("type").map_err(map_sqlite_execution_error)?;
        validate_metadata(&name)?;
        validate_metadata(&declared_type)?;
        let default_expression: Option<String> = row
            .try_get("dflt_value")
            .map_err(map_sqlite_execution_error)?;
        if let Some(default_expression) = &default_expression {
            validate_metadata(default_expression)?;
        }
        Ok(SchemaColumn {
            name,
            declared_type,
            nullable: row
                .try_get::<i64, _>("notnull")
                .map_err(map_sqlite_execution_error)?
                == 0,
            primary_key_position: row
                .try_get::<i64, _>("pk")
                .map_err(map_sqlite_execution_error)? as u32,
            default_expression,
        })
    })
    .collect::<Result<Vec<_>, QueryNotError>>()?;
    let foreign_keys = sqlx::query(
        "SELECT id, seq, \"table\", \"from\", \"to\", on_update, on_delete FROM pragma_foreign_key_list(?) ORDER BY id, seq",
    )
    .bind(object_name)
    .fetch_all(&mut *connection)
    .await
    .map_err(map_sqlite_execution_error)?
    .into_iter()
    .map(|row| {
        let referenced_table: String = row.try_get("table").map_err(map_sqlite_execution_error)?;
        let from_column: String = row.try_get("from").map_err(map_sqlite_execution_error)?;
        let to_column: Option<String> = row.try_get("to").map_err(map_sqlite_execution_error)?;
        let on_update: String = row.try_get("on_update").map_err(map_sqlite_execution_error)?;
        let on_delete: String = row.try_get("on_delete").map_err(map_sqlite_execution_error)?;
        validate_metadata(&referenced_table)?;
        validate_metadata(&from_column)?;
        if let Some(to_column) = &to_column {
            validate_metadata(to_column)?;
        }
        validate_metadata(&on_update)?;
        validate_metadata(&on_delete)?;
        Ok(SchemaForeignKey {
            id: row.try_get("id").map_err(map_sqlite_execution_error)?,
            sequence: row.try_get("seq").map_err(map_sqlite_execution_error)?,
            referenced_table,
            from_column,
            to_column,
            on_update,
            on_delete,
        })
    })
    .collect::<Result<Vec<_>, QueryNotError>>()?;
    let index_rows =
        sqlx::query("SELECT name, \"unique\", origin FROM pragma_index_list(?) ORDER BY seq")
            .bind(object_name)
            .fetch_all(&mut *connection)
            .await
            .map_err(map_sqlite_execution_error)?;
    let mut indexes = Vec::new();
    for index in index_rows {
        let name: String = index.try_get("name").map_err(map_sqlite_execution_error)?;
        validate_metadata(&name)?;
        let columns: Vec<String> =
            sqlx::query("SELECT name FROM pragma_index_info(?) ORDER BY seqno")
                .bind(&name)
                .fetch_all(&mut *connection)
                .await
                .map_err(map_sqlite_execution_error)?
                .into_iter()
                .filter_map(|row| row.try_get::<Option<String>, _>("name").ok().flatten())
                .collect();
        for column in &columns {
            validate_metadata(column)?;
        }
        let origin: String = index
            .try_get("origin")
            .map_err(map_sqlite_execution_error)?;
        validate_metadata(&origin)?;
        indexes.push(SchemaIndex {
            name,
            unique: index
                .try_get::<i64, _>("unique")
                .map_err(map_sqlite_execution_error)?
                != 0,
            origin,
            columns,
        });
    }
    Ok(SchemaObjectDetail {
        object: SchemaObject {
            namespace: namespace.to_owned(),
            name: object_name.to_owned(),
            kind: if kind == "view" {
                SchemaObjectKind::View
            } else {
                SchemaObjectKind::Table
            },
        },
        columns,
        foreign_keys,
        indexes,
        definition,
        routines_supported: false,
    })
}

async fn connection_info(
    connection: &mut SqliteConnection,
    read_only: bool,
) -> Result<SqliteConnectionInfo, QueryNotError> {
    let exact_version: String = sqlx::query_scalar("SELECT sqlite_version()")
        .fetch_one(&mut *connection)
        .await
        .map_err(map_sqlite_execution_error)?;
    let check: String = sqlx::query_scalar("PRAGMA quick_check")
        .fetch_one(&mut *connection)
        .await
        .map_err(map_sqlite_execution_error)?;
    if check != "ok" {
        return Err(QueryNotError::database(
            crate::ErrorCategory::Connectivity,
            "SQLite rejected the selected file during its integrity check.",
            false,
        ));
    }
    Ok(SqliteConnectionInfo {
        identity: ServerIdentity {
            family: DatabaseFamily::Sqlite,
            product: "SQLite".to_owned(),
            exact_version,
            legacy: false,
        },
        capabilities: AdapterCapabilities {
            metadata: true,
            streaming: true,
            cancellation: true,
            transactions: true,
            multiple_results: true,
            safe_table_mutations: false,
        },
        read_only,
        context: "main".to_owned(),
    })
}

fn connect_options(
    path: &Path,
    read_only: bool,
    create: bool,
) -> Result<SqliteConnectOptions, QueryNotError> {
    if !path.is_absolute() {
        return Err(QueryNotError::authorization(
            "SQLite access requires an absolute native file-chooser path.",
        ));
    }
    let options = SqliteConnectOptions::from_str("sqlite:")
        .map_err(|_| QueryNotError::internal("SQLite options could not be initialized."))?
        .filename(path)
        .read_only(read_only)
        .create_if_missing(create)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));
    let options = if read_only {
        options
    } else {
        options.journal_mode(SqliteJournalMode::Wal)
    };
    let options = options.disable_statement_logging();
    Ok(options)
}

fn sqlite_columns(row: &SqliteRow) -> Vec<ResultColumn> {
    row.columns()
        .iter()
        .map(|column| ResultColumn {
            name: column.name().to_owned(),
            declared_type: column.type_info().name().to_owned(),
            nullable: None,
        })
        .collect()
}

fn sqlite_values(row: &SqliteRow) -> Result<Vec<TaggedValue>, QueryNotError> {
    (0..row.len())
        .map(|index| {
            let raw = row.try_get_raw(index).map_err(map_sqlite_execution_error)?;
            if raw.is_null() {
                return Ok(TaggedValue::Null);
            }
            let type_name = raw.type_info().name().to_ascii_uppercase();
            if type_name.contains("INT") || type_name == "INTEGER" {
                return row
                    .try_get::<i64, _>(index)
                    .map(|value| TaggedValue::SignedInteger(value.to_string()))
                    .map_err(map_sqlite_execution_error);
            }
            if matches!(type_name.as_str(), "REAL" | "FLOAT" | "DOUBLE") {
                return row
                    .try_get::<f64, _>(index)
                    .map(TaggedValue::Float)
                    .map_err(map_sqlite_execution_error);
            }
            if type_name == "BLOB" {
                return row
                    .try_get::<Vec<u8>, _>(index)
                    .map(TaggedValue::Bytes)
                    .map_err(map_sqlite_execution_error);
            }
            row.try_get::<String, _>(index)
                .map(TaggedValue::Text)
                .or_else(|_| row.try_get::<Vec<u8>, _>(index).map(TaggedValue::Bytes))
                .map_err(map_sqlite_execution_error)
        })
        .collect()
}

fn make_batch(
    execution_id: ExecutionId,
    result_set_id: ResultSetId,
    sequence: u64,
    statement_index: u32,
    columns: Option<Vec<ResultColumn>>,
    rows: Vec<Vec<TaggedValue>>,
    encoded_bytes: usize,
) -> ResultBatch {
    ResultBatch {
        execution_id,
        result_set_id,
        sequence,
        statement_index,
        columns,
        rows,
        encoded_bytes,
    }
}

async fn send_batch_and_wait(
    batch: ResultBatch,
    events: &mpsc::Sender<SqliteExecutionEvent>,
    controls: &mut mpsc::Receiver<ExecutionControl>,
    cancel: &AtomicBool,
) -> bool {
    let result_set_id = batch.result_set_id;
    let sequence = batch.sequence;
    if events
        .send(SqliteExecutionEvent::Batch(batch))
        .await
        .is_err()
    {
        cancel.store(false, Ordering::Release);
        return false;
    }
    loop {
        if !cancel.load(Ordering::Acquire) {
            return false;
        }
        match tokio::time::timeout(Duration::from_millis(100), controls.recv()).await {
            Ok(Some(ExecutionControl::Acknowledge {
                result_set_id: id,
                sequence: received,
            })) if id == result_set_id && received == sequence => return true,
            Ok(Some(ExecutionControl::Discard { result_set_id: id })) if id == result_set_id => {
                return false;
            }
            Ok(Some(ExecutionControl::Cancel)) | Ok(None) => {
                cancel.store(false, Ordering::Release);
                return false;
            }
            _ => {}
        }
    }
}

enum MoreDecision {
    Continue,
    Discard,
    Expire,
    Cancel,
}

async fn wait_for_more(
    result_set_id: ResultSetId,
    controls: &mut mpsc::Receiver<ExecutionControl>,
    cancel: &AtomicBool,
) -> MoreDecision {
    wait_for_more_with_lifetime(result_set_id, controls, cancel, PAUSED_CURSOR_LIFETIME).await
}

async fn wait_for_more_with_lifetime(
    result_set_id: ResultSetId,
    controls: &mut mpsc::Receiver<ExecutionControl>,
    cancel: &AtomicBool,
    lifetime: Duration,
) -> MoreDecision {
    let deadline = tokio::time::Instant::now() + lifetime;
    loop {
        if !cancel.load(Ordering::Acquire) {
            return MoreDecision::Cancel;
        }
        match tokio::time::timeout_at(deadline, controls.recv()).await {
            Ok(Some(ExecutionControl::LoadMore { result_set_id: id })) if id == result_set_id => {
                return MoreDecision::Continue;
            }
            Ok(Some(ExecutionControl::Discard { result_set_id: id })) if id == result_set_id => {
                return MoreDecision::Discard;
            }
            Ok(Some(ExecutionControl::Cancel)) | Ok(None) => {
                cancel.store(false, Ordering::Release);
                return MoreDecision::Cancel;
            }
            Err(_) => return MoreDecision::Expire,
            _ => {}
        }
    }
}

fn session_transaction_state(session: &SqliteSession) -> SqliteTransactionState {
    SqliteTransactionState {
        automatic: session.automatic.load(Ordering::Acquire),
        certainty: transaction_certainty(&session.transaction),
    }
}

fn transaction_certainty(transaction: &StdMutex<TransactionCertainty>) -> TransactionCertainty {
    transaction
        .lock()
        .map_or(TransactionCertainty::Unknown, |state| *state)
}

fn set_transaction_certainty(
    transaction: &StdMutex<TransactionCertainty>,
    certainty: TransactionCertainty,
) {
    if let Ok(mut state) = transaction.lock() {
        *state = certainty;
    }
}

fn mark_unknown_if_active(session: &SqliteSession) -> SqliteTransactionState {
    if transaction_certainty(&session.transaction) == TransactionCertainty::Active {
        set_transaction_certainty(&session.transaction, TransactionCertainty::Unknown);
    }
    session_transaction_state(session)
}

fn reconcile_transaction_statement(transaction: &StdMutex<TransactionCertainty>, statement: &str) {
    let keyword = leading_statement_keyword(statement).unwrap_or_default();
    match keyword.as_str() {
        "BEGIN" | "SAVEPOINT" => {
            set_transaction_certainty(transaction, TransactionCertainty::Active)
        }
        "COMMIT" | "END" | "ROLLBACK" => {
            set_transaction_certainty(transaction, TransactionCertainty::Clean)
        }
        _ => {}
    }
}

async fn cleanup_progress(connection: &mut SqliteConnection) {
    if let Ok(mut handle) = connection.lock_handle().await {
        handle.remove_progress_handler();
    }
}

fn clear_active_cancel(active: &StdMutex<Option<Arc<AtomicBool>>>) {
    if let Ok(mut active) = active.lock() {
        *active = None;
    }
}

async fn ensure_namespace(
    connection: &mut SqliteConnection,
    namespace: &str,
) -> Result<(), QueryNotError> {
    let names = sqlx::query("PRAGMA database_list")
        .fetch_all(connection)
        .await
        .map_err(map_sqlite_execution_error)?
        .into_iter()
        .filter_map(|row| row.try_get::<String, _>("name").ok())
        .collect::<Vec<_>>();
    if names.iter().any(|name| name == namespace) {
        Ok(())
    } else {
        Err(QueryNotError::authorization(
            "The selected SQLite namespace is not attached to this profile.",
        ))
    }
}

fn validate_namespace(value: &str) -> Result<(), QueryNotError> {
    validate_metadata(value)?;
    if value.is_empty() || value.bytes().any(|byte| byte == 0) {
        return Err(QueryNotError::authorization("SQLite namespace is invalid."));
    }
    Ok(())
}

fn validate_metadata(value: &str) -> Result<(), QueryNotError> {
    if value.len() > MAX_METADATA_NAME_BYTES || value.bytes().any(|byte| byte == 0) {
        return Err(QueryNotError::database(
            crate::ErrorCategory::UnsupportedCapability,
            "SQLite metadata exceeds the safe display boundary.",
            false,
        ));
    }
    Ok(())
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn map_sqlite_connect_error(error: sqlx::Error) -> QueryNotError {
    let category = sqlite_error_category(&error);
    QueryNotError::database(
        category,
        match category {
            crate::ErrorCategory::Authorization => {
                "SQLite could not open the selected file with the requested access mode."
            }
            crate::ErrorCategory::Connectivity => {
                "SQLite could not open the selected database file."
            }
            _ => "SQLite connection setup failed safely.",
        },
        matches!(
            category,
            crate::ErrorCategory::Connectivity | crate::ErrorCategory::Timeout
        ),
    )
}

fn map_sqlite_execution_error(error: sqlx::Error) -> QueryNotError {
    let category = sqlite_error_category(&error);
    QueryNotError::database(
        category,
        match category {
            crate::ErrorCategory::Cancelled => {
                "SQLite confirmed cancellation of the active statement."
            }
            crate::ErrorCategory::Syntax => "SQLite rejected the statement syntax.",
            crate::ErrorCategory::Constraint => {
                "SQLite rejected the statement because a constraint would be violated."
            }
            crate::ErrorCategory::Authorization => {
                "SQLite denied this operation or the file is read-only."
            }
            crate::ErrorCategory::Connectivity => {
                "The SQLite file became unavailable during the operation."
            }
            _ => "SQLite could not complete the operation.",
        },
        matches!(category, crate::ErrorCategory::Connectivity),
    )
}

fn sqlite_error_category(error: &sqlx::Error) -> crate::ErrorCategory {
    let Some(database) = error.as_database_error() else {
        return match error {
            sqlx::Error::Io(_) => crate::ErrorCategory::Connectivity,
            sqlx::Error::PoolTimedOut => crate::ErrorCategory::Timeout,
            _ => crate::ErrorCategory::Internal,
        };
    };
    match database.code().as_deref() {
        Some("4") | Some("9") => crate::ErrorCategory::Cancelled,
        Some("8") | Some("23") => crate::ErrorCategory::Authorization,
        Some("19") => crate::ErrorCategory::Constraint,
        Some("1") => crate::ErrorCategory::Syntax,
        Some("10") | Some("14") | Some("26") => crate::ErrorCategory::Connectivity,
        _ => crate::ErrorCategory::Internal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sql::plan_execution;
    use tempfile::tempdir;

    async fn fixture() -> (tempfile::TempDir, PathBuf) {
        let directory = tempdir().unwrap();
        let path = directory.path().join("fixture.sqlite3");
        let mut connection =
            SqliteConnection::connect_with(&connect_options(&path, false, true).unwrap())
                .await
                .unwrap();
        connection.execute(
            "CREATE TABLE parent(id INTEGER PRIMARY KEY, label TEXT NOT NULL UNIQUE);\n\
             CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id), payload BLOB);\n\
             CREATE VIEW child_view AS SELECT id, parent_id FROM child;"
        ).await.unwrap();
        connection.close().await.unwrap();
        (directory, path)
    }

    #[tokio::test]
    async fn connection_metadata_and_read_only_mode_are_real() {
        let (_directory, path) = fixture().await;
        let info = test_sqlite_connection(&path, true).await.unwrap();
        assert_eq!(info.identity.product, "SQLite");
        assert!(info.capabilities.streaming);
        let objects = load_objects(&path, true, "main").await.unwrap();
        assert_eq!(objects.len(), 3);
        let detail = load_object_detail(&path, true, "main", "child")
            .await
            .unwrap();
        assert_eq!(detail.columns.len(), 3);
        assert_eq!(detail.foreign_keys.len(), 1);
        let session = SqliteSession::open(&path, true).await.unwrap();
        let mut connection = session.connection.lock().await;
        assert!(
            connection
                .execute("INSERT INTO child(id) VALUES (1)")
                .await
                .is_err()
        );
    }

    #[test]
    fn hostile_metadata_is_rejected_at_the_display_boundary() {
        assert!(validate_metadata(&"x".repeat(MAX_METADATA_NAME_BYTES)).is_ok());
        assert!(validate_metadata(&"x".repeat(MAX_METADATA_NAME_BYTES + 1)).is_err());
        assert!(validate_metadata("unsafe\0metadata").is_err());
    }

    #[tokio::test]
    async fn dedicated_sessions_isolate_transactions_and_temporary_objects() {
        let (_directory, path) = fixture().await;
        let first = SqliteSession::open(&path, false).await.unwrap();
        let second = SqliteSession::open(&path, false).await.unwrap();
        first.set_automatic(false).await.unwrap();
        {
            let mut connection = first.connection.lock().await;
            connection.execute("BEGIN").await.unwrap();
            set_transaction_certainty(&first.transaction, TransactionCertainty::Active);
            connection
                .execute("CREATE TEMP TABLE local_only(value INTEGER)")
                .await
                .unwrap();
            connection
                .execute("INSERT INTO parent VALUES (1, 'pending')")
                .await
                .unwrap();
        }
        assert_eq!(
            first.transaction_state().await.certainty,
            TransactionCertainty::Active
        );
        {
            let mut connection = second.connection.lock().await;
            assert!(
                connection
                    .execute("SELECT * FROM local_only")
                    .await
                    .is_err()
            );
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM parent")
                .fetch_one(&mut *connection)
                .await
                .unwrap();
            assert_eq!(count, 0);
        }
        first.rollback().await.unwrap();
    }

    #[tokio::test]
    async fn manual_mode_reopens_after_in_script_commit_and_reports_each_statement_state() {
        let (_directory, path) = fixture().await;
        let session = SqliteSession::open(&path, false).await.unwrap();
        session.set_automatic(false).await.unwrap();
        let plan = plan_execution(
            "INSERT INTO parent VALUES (1, 'committed'); COMMIT; INSERT INTO parent VALUES (2, 'pending')",
            None,
            0,
            true,
            "profile",
            "session",
            "main",
        )
        .unwrap();
        let (_control_tx, control_rx) = mpsc::channel(2);
        let (event_tx, mut event_rx) = mpsc::channel(8);
        let running = session.clone();
        let task = tokio::spawn(async move {
            running
                .execute(ExecutionId::new(), plan, 100, control_rx, event_tx)
                .await;
        });
        let mut statement_states = Vec::new();
        while let Some(event) = event_rx.recv().await {
            match event {
                SqliteExecutionEvent::StatementMessage { transaction, .. } => {
                    statement_states.push(transaction.certainty);
                }
                SqliteExecutionEvent::Finished { .. } => break,
                SqliteExecutionEvent::Failed { error, .. } => {
                    panic!("manual transaction script failed: {}", error.safe_message)
                }
                _ => {}
            }
        }
        task.await.unwrap();
        assert_eq!(
            statement_states,
            vec![
                TransactionCertainty::Active,
                TransactionCertainty::Clean,
                TransactionCertainty::Active,
            ]
        );
        session.rollback().await.unwrap();
        let mut connection = session.connection.lock().await;
        let labels: Vec<String> = sqlx::query_scalar("SELECT label FROM parent ORDER BY id")
            .fetch_all(&mut *connection)
            .await
            .unwrap();
        assert_eq!(labels, vec!["committed"]);
    }

    #[tokio::test]
    async fn streaming_waits_for_acknowledgement_and_honors_load_more() {
        let (_directory, path) = fixture().await;
        let session = SqliteSession::open(&path, false).await.unwrap();
        let execution_id = ExecutionId::new();
        let plan = plan_execution(
            "WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 250) SELECT value FROM n",
            None,
            0,
            true,
            "profile",
            "session",
            "main",
        ).unwrap();
        let (control_tx, control_rx) = mpsc::channel(8);
        let (event_tx, mut event_rx) = mpsc::channel(8);
        let running = session.clone();
        let task = tokio::spawn(async move {
            running
                .execute(execution_id, plan, 100, control_rx, event_tx)
                .await
        });
        let mut batches = 0;
        let mut pauses = 0;
        let mut observed = Vec::new();
        while let Some(event) = event_rx.recv().await {
            observed.push(format!("{event:?}"));
            match event {
                SqliteExecutionEvent::Batch(batch) => {
                    batches += 1;
                    control_tx
                        .send(ExecutionControl::Acknowledge {
                            result_set_id: batch.result_set_id,
                            sequence: batch.sequence,
                        })
                        .await
                        .unwrap();
                }
                SqliteExecutionEvent::Paused { result_set_id, .. } => {
                    pauses += 1;
                    if pauses == 1 {
                        control_tx
                            .send(ExecutionControl::LoadMore { result_set_id })
                            .await
                            .unwrap();
                    } else {
                        control_tx
                            .send(ExecutionControl::Discard { result_set_id })
                            .await
                            .unwrap();
                    }
                }
                SqliteExecutionEvent::Finished { .. } => break,
                _ => {}
            }
        }
        task.await.unwrap();
        assert!(batches >= 2, "observed events: {observed:#?}");
        assert_eq!(pauses, 2, "observed events: {observed:#?}");
    }

    #[tokio::test]
    async fn empty_result_keeps_column_metadata_and_terminal_order() {
        let (_directory, path) = fixture().await;
        let session = SqliteSession::open(&path, false).await.unwrap();
        let execution_id = ExecutionId::new();
        let plan = plan_execution(
            "SELECT id, label FROM parent WHERE 1 = 0",
            None,
            0,
            true,
            "profile",
            "session",
            "main",
        )
        .unwrap();
        let (control_tx, control_rx) = mpsc::channel(4);
        let (event_tx, mut event_rx) = mpsc::channel(8);
        let running = session.clone();
        let task = tokio::spawn(async move {
            running
                .execute(execution_id, plan, 100, control_rx, event_tx)
                .await
        });
        let mut empty_columns = Vec::new();
        let mut terminal_sequence = None;
        while let Some(event) = event_rx.recv().await {
            match event {
                SqliteExecutionEvent::Batch(batch) => {
                    assert!(batch.rows.is_empty());
                    empty_columns = batch.columns.clone().unwrap_or_default();
                    control_tx
                        .send(ExecutionControl::Acknowledge {
                            result_set_id: batch.result_set_id,
                            sequence: batch.sequence,
                        })
                        .await
                        .unwrap();
                }
                SqliteExecutionEvent::ResultTerminal(terminal) => {
                    terminal_sequence = Some(terminal.sequence);
                }
                SqliteExecutionEvent::Finished { .. } => break,
                _ => {}
            }
        }
        task.await.unwrap();
        assert_eq!(
            empty_columns
                .iter()
                .map(|column| column.name.as_str())
                .collect::<Vec<_>>(),
            vec!["id", "label"]
        );
        assert_eq!(terminal_sequence, Some(1));
    }

    #[tokio::test]
    async fn paused_cursor_control_expires_without_reexecution() {
        let result_set_id = ResultSetId::new();
        let (_control_tx, mut controls) = mpsc::channel(1);
        let cancel = AtomicBool::new(true);
        let decision = wait_for_more_with_lifetime(
            result_set_id,
            &mut controls,
            &cancel,
            Duration::from_millis(5),
        )
        .await;
        assert!(matches!(decision, MoreDecision::Expire));
        assert!(cancel.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn cancellation_interrupts_query_and_leaves_session_usable() {
        let (_directory, path) = fixture().await;
        let session = SqliteSession::open(&path, false).await.unwrap();
        let execution_id = ExecutionId::new();
        let plan = plan_execution(
            "WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 100000000) SELECT SUM(value) FROM n",
            None,
            0,
            true,
            "profile",
            "session",
            "main",
        ).unwrap();
        let (_control_tx, control_rx) = mpsc::channel(2);
        let (event_tx, mut event_rx) = mpsc::channel(8);
        let running = session.clone();
        let task = tokio::spawn(async move {
            running
                .execute(execution_id, plan, 100, control_rx, event_tx)
                .await
        });
        tokio::time::sleep(Duration::from_millis(10)).await;
        assert!(session.request_cancel());
        let mut cancelled = false;
        while let Some(event) = event_rx.recv().await {
            if matches!(
                event,
                SqliteExecutionEvent::Cancelled {
                    confirmed: true,
                    ..
                }
            ) {
                cancelled = true;
                break;
            }
        }
        task.await.unwrap();
        assert!(cancelled);
        let mut connection = session.connection.lock().await;
        let healthy: i64 = sqlx::query_scalar("SELECT 1")
            .fetch_one(&mut *connection)
            .await
            .unwrap();
        assert_eq!(healthy, 1);
    }
}
