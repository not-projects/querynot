use crate::adapter::{
    AdapterCapabilities, AdapterConnectionInfo, CompatibilityStatus, DatabaseFamily, ServerIdentity,
};
use crate::profile::{ConnectionProfile, ConnectionTarget, TlsMode};
use crate::result::{
    MAX_BATCH_BYTES, MAX_BATCH_ROWS, MAX_RETAINED_BYTES, MAX_RETAINED_ROWS, PAUSED_CURSOR_LIFETIME,
    ResultBatch, ResultColumn, ResultTerminal, ResultTerminalState, tagged_value_size,
};
use crate::sql::{ExecutionPlan, leading_statement_keyword};
use crate::sqlite::{
    ExecutionControl, SchemaColumn, SchemaForeignKey, SchemaIndex, SchemaNamespace, SchemaObject,
    SchemaObjectDetail, SchemaObjectKind, SqliteExecutionEvent, SqliteTransactionState,
    TransactionCertainty,
};
use crate::table::{
    BrowseInput, MutationApplyResult, MutationPlan, TableDefinition, TableDialect, TablePage,
    plan_browse, validate_table_page_values,
};
use crate::vault::ConnectionSecrets;
use crate::{ExecutionId, QueryNotError, ResultSetId, TaggedValue};
use futures_util::TryStreamExt;
use secrecy::ExposeSecret;
use sqlx::postgres::{PgArguments, PgConnectOptions, PgRow, PgSslMode, PgValueFormat};
use sqlx::query::Query;
use sqlx::types::chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use sqlx::{
    AssertSqlSafe, Column, ConnectOptions, Connection, Either, Executor, PgConnection, Postgres,
    Row, SqlSafeStr, Statement, TypeInfo, ValueRef,
};
use std::sync::{
    Arc, Mutex as StdMutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, mpsc};

const MAX_METADATA_BYTES: usize = 64 * 1024;
const MAX_SCHEMA_OBJECTS: usize = 10_000;
const EXACT_POSTGRES_FIXTURE: &str = "18.6";

#[derive(Clone)]
pub struct PostgresSession {
    connection: Arc<Mutex<PgConnection>>,
    control_options: PgConnectOptions,
    backend_pid: Arc<AtomicU64>,
    read_only: bool,
    automatic: Arc<AtomicBool>,
    transaction: Arc<StdMutex<TransactionCertainty>>,
    active_cancel: Arc<StdMutex<Option<Arc<AtomicBool>>>>,
    active_cancel_confirmed: Arc<StdMutex<Option<Arc<AtomicBool>>>>,
}

impl std::fmt::Debug for PostgresSession {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PostgresSession")
            .field("connection", &"[NATIVE SESSION]")
            .field("control_options", &"[REDACTED]")
            .field("read_only", &self.read_only)
            .finish_non_exhaustive()
    }
}

impl PostgresSession {
    pub async fn open(
        profile: &ConnectionProfile,
        secrets: &ConnectionSecrets,
    ) -> Result<Self, QueryNotError> {
        let options = connect_options(profile, secrets)?;
        let mut connection = PgConnection::connect_with(&options)
            .await
            .map_err(map_postgres_connect_error)?;
        let info = connection_info(&mut connection, profile).await?;
        let backend_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut connection)
            .await
            .map_err(map_postgres_execution_error)?;
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
            control_options: options,
            backend_pid: Arc::new(AtomicU64::new(backend_pid.max(0) as u64)),
            read_only: info.read_only,
            automatic: Arc::new(AtomicBool::new(true)),
            transaction: Arc::new(StdMutex::new(TransactionCertainty::Clean)),
            active_cancel: Arc::new(StdMutex::new(None)),
            active_cancel_confirmed: Arc::new(StdMutex::new(None)),
        })
    }

    pub async fn test(
        profile: &ConnectionProfile,
        secrets: &ConnectionSecrets,
    ) -> Result<AdapterConnectionInfo, QueryNotError> {
        let options = connect_options(profile, secrets)?;
        let mut connection = PgConnection::connect_with(&options)
            .await
            .map_err(map_postgres_connect_error)?;
        connection_info(&mut connection, profile).await
    }

    #[must_use]
    pub const fn read_only(&self) -> bool {
        self.read_only
    }

    pub fn request_cancel(&self) -> bool {
        let requested = self
            .active_cancel
            .lock()
            .ok()
            .and_then(|active| active.as_ref().cloned())
            .is_some_and(|flag| {
                flag.store(false, Ordering::Release);
                true
            });
        if !requested {
            return false;
        }
        let confirmed = self
            .active_cancel_confirmed
            .lock()
            .ok()
            .and_then(|active| active.as_ref().cloned());
        let backend_pid = i32::try_from(self.backend_pid.load(Ordering::Acquire)).ok();
        let options = self.control_options.clone();
        if let (Some(backend_pid), Ok(handle)) =
            (backend_pid, tokio::runtime::Handle::try_current())
        {
            handle.spawn(async move {
                let Ok(mut control) = PgConnection::connect_with(&options).await else {
                    return;
                };
                if sqlx::query_scalar::<_, bool>("SELECT pg_cancel_backend($1)")
                    .bind(backend_pid)
                    .fetch_one(&mut control)
                    .await
                    .unwrap_or(false)
                    && let Some(confirmed) = confirmed
                {
                    confirmed.store(true, Ordering::Release);
                }
            });
        }
        true
    }

    pub async fn connection_info(
        &self,
        profile: &ConnectionProfile,
    ) -> Result<AdapterConnectionInfo, QueryNotError> {
        let mut connection = self.connection.lock().await;
        connection_info(&mut connection, profile).await
    }

    pub async fn namespaces(&self) -> Result<Vec<SchemaNamespace>, QueryNotError> {
        let mut connection = self.connection.lock().await;
        let rows = sqlx::query(
            "SELECT nspname FROM pg_catalog.pg_namespace \
             WHERE nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp_%' \
             ORDER BY nspname",
        )
        .fetch_all(&mut *connection)
        .await
        .map_err(map_postgres_execution_error)?;
        if rows.len() > MAX_SCHEMA_OBJECTS {
            return Err(metadata_limit_error());
        }
        rows.into_iter()
            .map(|row| {
                let name: String = row.try_get(0).map_err(map_postgres_execution_error)?;
                validate_metadata(&name)?;
                Ok(SchemaNamespace { name })
            })
            .collect()
    }

    pub async fn objects(&self, namespace: &str) -> Result<Vec<SchemaObject>, QueryNotError> {
        validate_metadata(namespace)?;
        let mut connection = self.connection.lock().await;
        let rows = sqlx::query(
            "SELECT n.nspname, c.relname, \
                    CASE WHEN c.relkind IN ('v', 'm') THEN 'view' ELSE 'table' END \
             FROM pg_catalog.pg_class c \
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'f', 'v', 'm') \
             UNION ALL \
             SELECT n.nspname, \
                    p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')', \
                    'routine' \
             FROM pg_catalog.pg_proc p \
             JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace \
             WHERE n.nspname = $1 \
             ORDER BY 2, 3",
        )
        .bind(namespace)
        .fetch_all(&mut *connection)
        .await
        .map_err(map_postgres_execution_error)?;
        if rows.len() > MAX_SCHEMA_OBJECTS {
            return Err(metadata_limit_error());
        }
        rows.into_iter()
            .map(|row| {
                let object_namespace: String =
                    row.try_get(0).map_err(map_postgres_execution_error)?;
                let name: String = row.try_get(1).map_err(map_postgres_execution_error)?;
                let kind: String = row.try_get(2).map_err(map_postgres_execution_error)?;
                validate_metadata(&object_namespace)?;
                validate_metadata(&name)?;
                Ok(SchemaObject {
                    namespace: object_namespace,
                    name,
                    kind: match kind.as_str() {
                        "view" => SchemaObjectKind::View,
                        "routine" => SchemaObjectKind::Routine,
                        _ => SchemaObjectKind::Table,
                    },
                })
            })
            .collect()
    }

    pub async fn object_detail(
        &self,
        namespace: &str,
        object_name: &str,
    ) -> Result<SchemaObjectDetail, QueryNotError> {
        validate_metadata(namespace)?;
        validate_metadata(object_name)?;
        let mut connection = self.connection.lock().await;
        load_object_detail(&mut connection, namespace, object_name).await
    }

    pub async fn change_context(&self, context: &str) -> Result<String, QueryNotError> {
        validate_metadata(context)?;
        let mut connection = self.connection.lock().await;
        let statement = format!(
            "SET search_path TO {}, pg_catalog",
            quote_identifier(context)
        );
        connection
            .execute(AssertSqlSafe(statement.as_str()))
            .await
            .map_err(map_postgres_execution_error)?;
        let confirmed: Option<String> = sqlx::query_scalar("SELECT current_schema()")
            .fetch_one(&mut *connection)
            .await
            .map_err(map_postgres_execution_error)?;
        match confirmed {
            Some(confirmed) if confirmed == context => Ok(confirmed),
            _ => Err(QueryNotError::database(
                crate::ErrorCategory::Connectivity,
                "The server did not confirm the requested PostgreSQL schema context.",
                true,
            )),
        }
    }

    pub async fn browse_table(
        &self,
        namespace: &str,
        table: &str,
        input: &BrowseInput,
    ) -> Result<TablePage, QueryNotError> {
        let mut connection = self.connection.lock().await;
        let detail = load_object_detail(&mut connection, namespace, table).await?;
        let definition = TableDefinition::from_detail(&detail, self.read_only, !self.read_only);
        let plan = plan_browse(&definition, TableDialect::Postgres, input)?;
        let mut query = sqlx::query(AssertSqlSafe(plan.sql.as_str()));
        for value in plan.parameters.iter().cloned() {
            query = bind_postgres_value(query, value)?;
        }
        let rows = query
            .fetch_all(&mut *connection)
            .await
            .map_err(map_postgres_execution_error)?;
        let mut values = rows
            .iter()
            .map(postgres_values)
            .collect::<Result<Vec<_>, _>>()?;
        if values
            .iter()
            .any(|row| row.len() != definition.columns.len())
        {
            return Err(QueryNotError::internal(
                "PostgreSQL table paging returned a stale row shape.",
            ));
        }
        validate_table_page_values(&values)?;
        let has_more = values.len() > plan.page_size;
        values.truncate(plan.page_size);
        let next_cursor = if plan.keyset && has_more {
            values.last().map_or_else(Vec::new, |row| {
                plan.order_column_indexes
                    .iter()
                    .map(|index| row[*index].clone())
                    .collect()
            })
        } else {
            Vec::new()
        };
        Ok(TablePage {
            definition,
            next_offset: if plan.keyset {
                0
            } else {
                input.offset.saturating_add(values.len() as u64)
            },
            rows: values,
            has_more,
            next_cursor,
            unstable: plan.unstable,
        })
    }

    pub async fn apply_table_mutations(
        &self,
        plan: &MutationPlan,
    ) -> Result<MutationApplyResult, QueryNotError> {
        if self.read_only {
            return Err(QueryNotError::database(
                crate::ErrorCategory::UnsupportedCapability,
                "This PostgreSQL session is read-only.",
                false,
            ));
        }
        if !self.automatic.load(Ordering::Acquire)
            || transaction_certainty(&self.transaction) != TransactionCertainty::Clean
        {
            return Err(QueryNotError::database(
                crate::ErrorCategory::Transaction,
                "Table changes require a clean auto-commit table session.",
                false,
            ));
        }
        let mut connection = self.connection.lock().await;
        connection
            .execute("BEGIN")
            .await
            .map_err(map_postgres_execution_error)?;
        let mut affected_rows = 0_u64;
        for operation in &plan.operations {
            let mut query = sqlx::query(AssertSqlSafe(operation.sql.as_str()));
            for value in operation.parameters.iter().cloned() {
                query = match bind_postgres_value(query, value) {
                    Ok(bound) => bound,
                    Err(error) => {
                        rollback_postgres_mutations(self, &mut connection).await?;
                        return Err(error);
                    }
                };
            }
            match query.execute(&mut *connection).await {
                Ok(result) if result.rows_affected() == operation.expected_rows => {
                    affected_rows = affected_rows.saturating_add(result.rows_affected());
                }
                Ok(_) => {
                    rollback_postgres_mutations(self, &mut connection).await?;
                    return Err(QueryNotError::database(
                        crate::ErrorCategory::Constraint,
                        "A staged row no longer matched exactly one original row. The complete batch was rolled back and remains staged.",
                        false,
                    ));
                }
                Err(error) => {
                    let mapped = map_postgres_execution_error(error);
                    rollback_postgres_mutations(self, &mut connection).await?;
                    return Err(mapped);
                }
            }
        }
        if connection.execute("COMMIT").await.is_err() {
            set_transaction_certainty(&self.transaction, TransactionCertainty::Unknown);
            let _ = connection.execute("ROLLBACK").await;
            return Err(QueryNotError::database(
                crate::ErrorCategory::Transaction,
                "The server could not confirm whether the mutation commit completed. Reconnect and inspect the affected rows before another write.",
                false,
            ));
        }
        Ok(MutationApplyResult {
            affected_rows,
            refreshed: true,
        })
    }

    pub async fn transaction_state(&self) -> SqliteTransactionState {
        session_transaction_state(self)
    }

    pub async fn set_automatic(
        &self,
        automatic: bool,
    ) -> Result<SqliteTransactionState, QueryNotError> {
        let current = session_transaction_state(self);
        if automatic && current.certainty != TransactionCertainty::Clean {
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
        if transaction_certainty(&self.transaction) == TransactionCertainty::Clean {
            return Err(no_transaction_error("commit"));
        }
        let mut connection = self.connection.lock().await;
        connection
            .execute("COMMIT")
            .await
            .map_err(map_postgres_execution_error)?;
        set_transaction_certainty(&self.transaction, TransactionCertainty::Clean);
        Ok(session_transaction_state(self))
    }

    pub async fn rollback(&self) -> Result<SqliteTransactionState, QueryNotError> {
        if transaction_certainty(&self.transaction) == TransactionCertainty::Clean {
            return Err(no_transaction_error("roll back"));
        }
        let mut connection = self.connection.lock().await;
        connection
            .execute("ROLLBACK")
            .await
            .map_err(map_postgres_execution_error)?;
        set_transaction_certainty(&self.transaction, TransactionCertainty::Clean);
        Ok(session_transaction_state(self))
    }
}

impl PostgresSession {
    pub async fn execute(
        &self,
        execution_id: ExecutionId,
        plan: ExecutionPlan,
        tranche_rows: usize,
        mut controls: mpsc::Receiver<ExecutionControl>,
        events: mpsc::Sender<SqliteExecutionEvent>,
    ) {
        let cancel = Arc::new(AtomicBool::new(true));
        let cancel_confirmed = Arc::new(AtomicBool::new(false));
        if let Ok(mut active) = self.active_cancel.lock() {
            *active = Some(Arc::clone(&cancel));
        }
        if let Ok(mut active) = self.active_cancel_confirmed.lock() {
            *active = Some(Arc::clone(&cancel_confirmed));
        }
        let _ = events
            .send(SqliteExecutionEvent::Started {
                execution_id,
                started_at: Instant::now(),
                statement_count: plan.statements.len(),
            })
            .await;
        let mut connection = self.connection.lock().await;
        let mut statements_completed = 0;
        let mut total_received = 0_usize;
        let mut failed = false;

        'statements: for statement in plan.statements {
            if !cancel.load(Ordering::Acquire) {
                break;
            }
            if self.read_only && !crate::sql::statement_is_provably_read_only(&statement.sql) {
                failed = true;
                let _ = events
                    .send(SqliteExecutionEvent::Failed {
                        execution_id,
                        statement_index: Some(statement.index),
                        statement_start: Some(statement.start),
                        statement_end: Some(statement.end),
                        error: QueryNotError::database(
                            crate::ErrorCategory::UnsupportedCapability,
                            "This PostgreSQL version is outside the tested matrix; QueryNot disabled possible writes for this connection.",
                            false,
                        ),
                        transaction: session_transaction_state(self),
                    })
                    .await;
                break;
            }
            let keyword = leading_statement_keyword(&statement.sql);
            let transaction_control = matches!(
                keyword.as_deref(),
                Some("BEGIN" | "START" | "COMMIT" | "END" | "ROLLBACK")
            );
            if !self.automatic.load(Ordering::Acquire)
                && transaction_certainty(&self.transaction) == TransactionCertainty::Clean
                && !transaction_control
            {
                if let Err(error) = connection.execute("BEGIN").await {
                    failed = true;
                    let _ = events
                        .send(SqliteExecutionEvent::Failed {
                            execution_id,
                            statement_index: Some(statement.index),
                            statement_start: Some(statement.start),
                            statement_end: Some(statement.end),
                            error: map_postgres_execution_error(error),
                            transaction: unknown_transaction(self),
                        })
                        .await;
                    break;
                }
                set_transaction_certainty(&self.transaction, TransactionCertainty::Active);
            }

            let statement_started = Instant::now();
            let prepared_columns = (&mut *connection)
                .prepare(AssertSqlSafe(statement.sql.as_str()).into_sql_str())
                .await
                .ok()
                .map(|prepared| result_columns(prepared.columns()))
                .filter(|columns| !columns.is_empty());
            let result_tranche_rows = tranche_rows.clamp(100, 50_000);
            let mut current =
                prepared_columns.map(|columns| CurrentResult::new(columns, result_tranche_rows));
            let mut rows_affected = 0_u64;
            let mut statement_error = None;
            let mut stream =
                sqlx::raw_sql(AssertSqlSafe(statement.sql.as_str())).fetch_many(&mut *connection);

            'stream: loop {
                match stream.try_next().await {
                    Ok(Some(Either::Left(done))) => {
                        rows_affected = rows_affected.saturating_add(done.rows_affected());
                        if let Some(mut result) = current.take()
                            && !finish_result(
                                execution_id,
                                statement.index,
                                &mut result,
                                &events,
                                &mut controls,
                                &cancel,
                            )
                            .await
                        {
                            break 'stream;
                        }
                    }
                    Ok(Some(Either::Right(row))) => {
                        let columns = result_columns(row.columns());
                        let result = current.get_or_insert_with(|| {
                            CurrentResult::new(columns, result_tranche_rows)
                        });
                        if result.skip {
                            continue;
                        }
                        if result.columns.len() != row.len() {
                            statement_error = Some(QueryNotError::internal(
                                "The PostgreSQL result shape changed without a result-set boundary.",
                            ));
                            failed = true;
                            break 'stream;
                        }
                        let values = match postgres_values(&row) {
                            Ok(values) => values,
                            Err(error) => {
                                statement_error = Some(error);
                                failed = true;
                                break 'stream;
                            }
                        };
                        let row_bytes = values.iter().map(tagged_value_size).sum::<usize>();
                        if row_bytes > MAX_BATCH_BYTES
                            || result.received_rows >= MAX_RETAINED_ROWS
                            || result.retained_bytes.saturating_add(row_bytes) > MAX_RETAINED_BYTES
                        {
                            result.capped = true;
                            result.skip = true;
                            continue;
                        }
                        if !result.rows.is_empty()
                            && (result.rows.len() >= MAX_BATCH_ROWS
                                || result.batch_bytes.saturating_add(row_bytes) > MAX_BATCH_BYTES)
                            && !flush_batch(
                                execution_id,
                                statement.index,
                                result,
                                &events,
                                &mut controls,
                                &cancel,
                            )
                            .await
                        {
                            result.discarded = true;
                            result.skip = true;
                            continue;
                        }
                        result.batch_bytes = result.batch_bytes.saturating_add(row_bytes);
                        result.retained_bytes = result.retained_bytes.saturating_add(row_bytes);
                        result.received_rows += 1;
                        total_received += 1;
                        result.rows.push(values);
                        if result.received_rows >= result.tranche_limit {
                            if !flush_batch(
                                execution_id,
                                statement.index,
                                result,
                                &events,
                                &mut controls,
                                &cancel,
                            )
                            .await
                            {
                                result.discarded = true;
                                result.skip = true;
                                continue;
                            }
                            let _ = events
                                .send(SqliteExecutionEvent::Paused {
                                    execution_id,
                                    result_set_id: result.id,
                                    sequence: result.sequence,
                                    received_rows: result.received_rows,
                                    retained_bytes: result.retained_bytes,
                                })
                                .await;
                            match wait_for_more(result.id, &mut controls, &cancel).await {
                                MoreDecision::Continue => {
                                    result.tranche_limit = result
                                        .tranche_limit
                                        .saturating_add(tranche_rows.clamp(100, 50_000));
                                }
                                MoreDecision::Discard => {
                                    result.discarded = true;
                                    result.skip = true;
                                }
                                MoreDecision::Expire => {
                                    result.expired = true;
                                    result.skip = true;
                                }
                                MoreDecision::Cancel => break 'stream,
                            }
                        }
                    }
                    Ok(None) => break 'stream,
                    Err(error) => {
                        if postgres_error_category(&error) == crate::ErrorCategory::Cancelled {
                            cancel_confirmed.store(true, Ordering::Release);
                            cancel.store(false, Ordering::Release);
                        } else if cancel.load(Ordering::Acquire) {
                            statement_error = Some(map_postgres_execution_error(error));
                            failed = true;
                        }
                        break 'stream;
                    }
                }
            }
            drop(stream);

            if let Some(mut result) = current.take() {
                let before = result.received_rows;
                if !finish_result(
                    execution_id,
                    statement.index,
                    &mut result,
                    &events,
                    &mut controls,
                    &cancel,
                )
                .await
                {
                    total_received =
                        total_received.saturating_sub(before.saturating_sub(result.received_rows));
                }
            }
            if let Some(error) = statement_error {
                if transaction_certainty(&self.transaction) != TransactionCertainty::Clean {
                    set_transaction_certainty(&self.transaction, TransactionCertainty::Active);
                }
                let _ = events
                    .send(SqliteExecutionEvent::Failed {
                        execution_id,
                        statement_index: Some(statement.index),
                        statement_start: Some(statement.start),
                        statement_end: Some(statement.end),
                        error,
                        transaction: session_transaction_state(self),
                    })
                    .await;
                break 'statements;
            }
            if failed || !cancel.load(Ordering::Acquire) {
                break;
            }
            reconcile_statement_effect(self, keyword.as_deref());
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
                        confirmed: cancel_confirmed.load(Ordering::Acquire),
                        transaction,
                    })
                    .await;
            }
        }
        clear_active(&self.active_cancel);
        clear_active(&self.active_cancel_confirmed);
    }
}

struct CurrentResult {
    id: ResultSetId,
    sequence: u64,
    columns: Vec<ResultColumn>,
    send_columns: bool,
    rows: Vec<Vec<TaggedValue>>,
    batch_bytes: usize,
    received_rows: usize,
    retained_bytes: usize,
    tranche_limit: usize,
    capped: bool,
    discarded: bool,
    expired: bool,
    skip: bool,
}

impl CurrentResult {
    fn new(columns: Vec<ResultColumn>, tranche_limit: usize) -> Self {
        Self {
            id: ResultSetId::new(),
            sequence: 0,
            columns,
            send_columns: true,
            rows: Vec::new(),
            batch_bytes: 0,
            received_rows: 0,
            retained_bytes: 0,
            tranche_limit,
            capped: false,
            discarded: false,
            expired: false,
            skip: false,
        }
    }
}

async fn flush_batch(
    execution_id: ExecutionId,
    statement_index: u32,
    result: &mut CurrentResult,
    events: &mpsc::Sender<SqliteExecutionEvent>,
    controls: &mut mpsc::Receiver<ExecutionControl>,
    cancel: &AtomicBool,
) -> bool {
    if result.rows.is_empty() && !result.send_columns {
        return true;
    }
    let batch = ResultBatch {
        execution_id,
        result_set_id: result.id,
        sequence: result.sequence,
        statement_index,
        columns: result.send_columns.then(|| result.columns.clone()),
        rows: std::mem::take(&mut result.rows),
        encoded_bytes: result.batch_bytes,
    };
    result.send_columns = false;
    result.batch_bytes = 0;
    if !send_batch_and_wait(batch, events, controls, cancel).await {
        return false;
    }
    result.sequence += 1;
    true
}

async fn finish_result(
    execution_id: ExecutionId,
    statement_index: u32,
    result: &mut CurrentResult,
    events: &mpsc::Sender<SqliteExecutionEvent>,
    controls: &mut mpsc::Receiver<ExecutionControl>,
    cancel: &AtomicBool,
) -> bool {
    let delivered = if result.discarded || result.expired || !cancel.load(Ordering::Acquire) {
        true
    } else {
        flush_batch(
            execution_id,
            statement_index,
            result,
            events,
            controls,
            cancel,
        )
        .await
    };
    let state = if !cancel.load(Ordering::Acquire) {
        ResultTerminalState::Cancelled
    } else if result.expired {
        ResultTerminalState::Expired
    } else if result.discarded || !delivered {
        ResultTerminalState::Disposed
    } else {
        ResultTerminalState::Completed
    };
    if result.sequence > 0 {
        let _ = events
            .send(SqliteExecutionEvent::ResultTerminal(ResultTerminal {
                execution_id,
                result_set_id: result.id,
                sequence: result.sequence,
                state,
                received_rows: result.received_rows,
                retained_bytes: result.retained_bytes,
                capped: result.capped,
            }))
            .await;
    }
    delivered
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
    let deadline = tokio::time::Instant::now() + PAUSED_CURSOR_LIFETIME;
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

fn connect_options(
    profile: &ConnectionProfile,
    secrets: &ConnectionSecrets,
) -> Result<PgConnectOptions, QueryNotError> {
    let ConnectionTarget::Postgres {
        host,
        port,
        default_database,
        username,
        tls_mode,
        tls_ca_path,
        tls_client_certificate_path,
        tls_client_key_path,
    } = &profile.target
    else {
        return Err(QueryNotError::database(
            crate::ErrorCategory::UnsupportedCapability,
            "The PostgreSQL adapter cannot open another connection family.",
            false,
        ));
    };
    let ssl_mode = match tls_mode {
        TlsMode::Disabled => PgSslMode::Disable,
        TlsMode::Required => PgSslMode::Require,
        TlsMode::VerifyIdentity | TlsMode::CustomCa => PgSslMode::VerifyFull,
    };
    let mut options = PgConnectOptions::new()
        .host(host)
        .port(*port)
        .password(secrets.database_password().expose_secret())
        .application_name("QueryNot")
        .ssl_mode(ssl_mode)
        .disable_statement_logging();
    if !username.is_empty() {
        options = options.username(username);
    }
    if let Some(database) = default_database {
        options = options.database(database);
    }
    if let Some(path) = tls_ca_path {
        options = options.ssl_root_cert(path);
    }
    if let Some(path) = tls_client_certificate_path {
        options = options.ssl_client_cert(path);
    }
    if let Some(path) = tls_client_key_path {
        let passphrase = secrets.client_key_passphrase().expose_secret();
        if passphrase.is_empty() {
            options = options.ssl_client_key(path);
        } else {
            let decrypted_pem =
                crate::mysql::decrypt_client_key_pem(std::path::Path::new(path), passphrase)?;
            options = options.ssl_client_key_from_pem(decrypted_pem.as_bytes());
        }
    }
    Ok(options)
}

async fn connection_info(
    connection: &mut PgConnection,
    profile: &ConnectionProfile,
) -> Result<AdapterConnectionInfo, QueryNotError> {
    let row = sqlx::query(
        "SELECT version(), current_setting('server_version'), current_database(), current_schema(), \
                current_setting('transaction_read_only') = 'on'",
    )
    .fetch_one(&mut *connection)
    .await
    .map_err(map_postgres_execution_error)?;
    let reported_identity: String = row.try_get(0).map_err(map_postgres_execution_error)?;
    if !reported_identity.starts_with("PostgreSQL ") {
        return Err(QueryNotError::database(
            crate::ErrorCategory::UnsupportedCapability,
            "The endpoint did not report an unambiguous PostgreSQL server identity; QueryNot refused to guess.",
            false,
        ));
    }
    let reported_version: String = row.try_get(1).map_err(map_postgres_execution_error)?;
    let exact_version = parse_exact_version(&reported_version).ok_or_else(|| {
        QueryNotError::database(
            crate::ErrorCategory::UnsupportedCapability,
            "The PostgreSQL server reported a version that QueryNot could not classify safely.",
            false,
        )
    })?;
    let database: String = row.try_get(2).map_err(map_postgres_execution_error)?;
    let context: Option<String> = row.try_get(3).map_err(map_postgres_execution_error)?;
    let server_read_only: bool = row.try_get(4).map_err(map_postgres_execution_error)?;
    validate_metadata(&database)?;
    let (compatibility_status, exact_fixture) = classify_compatibility(&exact_version);
    let mut warnings = Vec::new();
    if compatibility_status == CompatibilityStatus::QueryOnly {
        warnings.push(format!(
            "PostgreSQL {exact_version} is outside the tested PostgreSQL 18.x compatibility line; possible writes are disabled."
        ));
    } else if !exact_fixture {
        warnings.push(format!(
            "PostgreSQL {exact_version} is write-enabled under the PostgreSQL 18.x compatibility line; {EXACT_POSTGRES_FIXTURE} remains the exact conformance baseline."
        ));
    }
    if server_read_only {
        warnings.push(
            "The PostgreSQL server reports read-only transactions; QueryNot disabled writes for this connection."
                .to_owned(),
        );
    }
    if let ConnectionTarget::Postgres { tls_mode, .. } = &profile.target {
        match tls_mode {
            TlsMode::Disabled => warnings.push(
                "This connection is unencrypted and intended only for explicitly trusted local development."
                    .to_owned(),
            ),
            TlsMode::Required => warnings.push(
                "TLS encryption is required, but server identity is not verified in this profile."
                    .to_owned(),
            ),
            TlsMode::VerifyIdentity | TlsMode::CustomCa => {}
        }
    }
    let read_only = compatibility_status == CompatibilityStatus::QueryOnly || server_read_only;
    Ok(AdapterConnectionInfo {
        identity: ServerIdentity {
            family: DatabaseFamily::Postgres,
            product: "PostgreSQL".to_owned(),
            exact_version,
            legacy: false,
        },
        capabilities: AdapterCapabilities {
            metadata: true,
            streaming: true,
            cancellation: true,
            transactions: !read_only,
            multiple_results: true,
            safe_table_mutations: !read_only,
        },
        read_only,
        context: context.unwrap_or_else(|| "public".to_owned()),
        dialect: "postgresql".to_owned(),
        compatibility_status,
        compatibility_warning: (!warnings.is_empty()).then(|| warnings.join(" ")),
    })
}

fn parse_exact_version(reported: &str) -> Option<String> {
    let numeric = reported
        .split(|character: char| !(character.is_ascii_digit() || character == '.'))
        .find(|part| !part.is_empty())?;
    let mut components = numeric.split('.');
    components.next()?.parse::<u64>().ok()?;
    components.next()?.parse::<u64>().ok()?;
    if components.next().is_some() {
        return None;
    }
    Some(numeric.to_owned())
}

fn classify_compatibility(exact_version: &str) -> (CompatibilityStatus, bool) {
    let major = exact_version
        .split_once('.')
        .and_then(|(major, _)| major.parse::<u64>().ok());
    if major == Some(18) {
        (
            CompatibilityStatus::Supported,
            exact_version == EXACT_POSTGRES_FIXTURE,
        )
    } else {
        (CompatibilityStatus::QueryOnly, false)
    }
}

async fn load_object_detail(
    connection: &mut PgConnection,
    namespace: &str,
    object_name: &str,
) -> Result<SchemaObjectDetail, QueryNotError> {
    let table_kind: Option<String> = sqlx::query_scalar(
        "SELECT c.relkind::text FROM pg_catalog.pg_class c \
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
         WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ('r', 'p', 'f', 'v', 'm')",
    )
    .bind(namespace)
    .bind(object_name)
    .fetch_optional(&mut *connection)
    .await
    .map_err(map_postgres_execution_error)?;
    if table_kind.is_none() {
        let definition: Option<String> = sqlx::query_scalar(
            "SELECT pg_catalog.pg_get_functiondef(p.oid) \
             FROM pg_catalog.pg_proc p \
             JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace \
             WHERE n.nspname = $1 \
               AND p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = $2",
        )
        .bind(namespace)
        .bind(object_name)
        .fetch_optional(&mut *connection)
        .await
        .map_err(map_postgres_execution_error)?;
        if definition.is_none() {
            return Err(QueryNotError::database(
                crate::ErrorCategory::Authorization,
                "The requested PostgreSQL schema object is unavailable or no longer exists.",
                false,
            ));
        }
        return Ok(SchemaObjectDetail {
            object: SchemaObject {
                namespace: namespace.to_owned(),
                name: object_name.to_owned(),
                kind: SchemaObjectKind::Routine,
            },
            columns: Vec::new(),
            foreign_keys: Vec::new(),
            indexes: Vec::new(),
            definition,
            routines_supported: true,
        });
    }
    let kind = if matches!(table_kind.as_deref(), Some("v" | "m")) {
        SchemaObjectKind::View
    } else {
        SchemaObjectKind::Table
    };
    let column_rows = sqlx::query(
        "SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), NOT a.attnotnull, \
                pg_catalog.pg_get_expr(d.adbin, d.adrelid), \
                (a.attgenerated <> '' OR a.attidentity <> '') \
         FROM pg_catalog.pg_attribute a \
         JOIN pg_catalog.pg_class c ON c.oid = a.attrelid \
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
         LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum \
         WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped \
         ORDER BY a.attnum",
    )
    .bind(namespace)
    .bind(object_name)
    .fetch_all(&mut *connection)
    .await
    .map_err(map_postgres_execution_error)?;
    let mut columns = column_rows
        .into_iter()
        .map(|row| {
            let name: String = row.try_get(0).map_err(map_postgres_execution_error)?;
            let declared_type: String = row.try_get(1).map_err(map_postgres_execution_error)?;
            validate_metadata(&name)?;
            validate_metadata(&declared_type)?;
            Ok(SchemaColumn {
                name,
                declared_type,
                nullable: row.try_get(2).map_err(map_postgres_execution_error)?,
                default_expression: row.try_get(3).map_err(map_postgres_execution_error)?,
                primary_key_position: 0,
                generated: row.try_get(4).map_err(map_postgres_execution_error)?,
            })
        })
        .collect::<Result<Vec<_>, QueryNotError>>()?;
    let primary_key_rows = sqlx::query(
        "SELECT a.attname, key.ordinality::bigint \
         FROM pg_catalog.pg_class c \
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
         JOIN pg_catalog.pg_index i ON i.indrelid = c.oid AND i.indisprimary \
         JOIN LATERAL unnest(i.indkey) WITH ORDINALITY key(attnum, ordinality) ON true \
         JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = key.attnum \
         WHERE n.nspname = $1 AND c.relname = $2 ORDER BY key.ordinality",
    )
    .bind(namespace)
    .bind(object_name)
    .fetch_all(&mut *connection)
    .await
    .map_err(map_postgres_execution_error)?;
    for row in primary_key_rows {
        let name: String = row.try_get(0).map_err(map_postgres_execution_error)?;
        let position: i64 = row.try_get(1).map_err(map_postgres_execution_error)?;
        let position = u32::try_from(position).map_err(|_| metadata_limit_error())?;
        if let Some(column) = columns.iter_mut().find(|column| column.name == name) {
            column.primary_key_position = position;
        }
    }
    let foreign_key_rows = sqlx::query(
        "SELECT con.oid::bigint, key.ordinality::bigint - 1, referenced.relname, \
                source_column.attname, referenced_column.attname, \
                CASE con.confupdtype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' \
                     WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END, \
                CASE con.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' \
                     WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END \
         FROM pg_catalog.pg_constraint con \
         JOIN pg_catalog.pg_class source ON source.oid = con.conrelid \
         JOIN pg_catalog.pg_namespace n ON n.oid = source.relnamespace \
         JOIN pg_catalog.pg_class referenced ON referenced.oid = con.confrelid \
         JOIN LATERAL generate_subscripts(con.conkey, 1) key(ordinality) ON true \
         JOIN pg_catalog.pg_attribute source_column \
           ON source_column.attrelid = source.oid AND source_column.attnum = con.conkey[key.ordinality] \
         JOIN pg_catalog.pg_attribute referenced_column \
           ON referenced_column.attrelid = referenced.oid AND referenced_column.attnum = con.confkey[key.ordinality] \
         WHERE con.contype = 'f' AND n.nspname = $1 AND source.relname = $2 \
         ORDER BY con.oid, key.ordinality",
    )
    .bind(namespace)
    .bind(object_name)
    .fetch_all(&mut *connection)
    .await
    .map_err(map_postgres_execution_error)?;
    let foreign_keys = foreign_key_rows
        .into_iter()
        .map(|row| {
            Ok(SchemaForeignKey {
                id: row.try_get(0).map_err(map_postgres_execution_error)?,
                sequence: row.try_get(1).map_err(map_postgres_execution_error)?,
                referenced_table: row.try_get(2).map_err(map_postgres_execution_error)?,
                from_column: row.try_get(3).map_err(map_postgres_execution_error)?,
                to_column: row.try_get(4).map_err(map_postgres_execution_error)?,
                on_update: row.try_get(5).map_err(map_postgres_execution_error)?,
                on_delete: row.try_get(6).map_err(map_postgres_execution_error)?,
            })
        })
        .collect::<Result<Vec<_>, QueryNotError>>()?;
    let index_rows = sqlx::query(
        "SELECT index_class.relname, i.indisunique, i.indisprimary, i.indpred IS NOT NULL, \
                i.indexprs IS NOT NULL, \
                ARRAY(SELECT a.attname \
                      FROM unnest(i.indkey) WITH ORDINALITY key(attnum, ordinality) \
                      JOIN pg_catalog.pg_attribute a ON a.attrelid = table_class.oid AND a.attnum = key.attnum \
                      WHERE key.attnum > 0 ORDER BY key.ordinality) \
         FROM pg_catalog.pg_index i \
         JOIN pg_catalog.pg_class table_class ON table_class.oid = i.indrelid \
         JOIN pg_catalog.pg_namespace n ON n.oid = table_class.relnamespace \
         JOIN pg_catalog.pg_class index_class ON index_class.oid = i.indexrelid \
         WHERE n.nspname = $1 AND table_class.relname = $2 \
         ORDER BY index_class.relname",
    )
    .bind(namespace)
    .bind(object_name)
    .fetch_all(&mut *connection)
    .await
    .map_err(map_postgres_execution_error)?;
    let indexes = index_rows
        .into_iter()
        .map(|row| {
            let primary: bool = row.try_get(2).map_err(map_postgres_execution_error)?;
            Ok(SchemaIndex {
                name: row.try_get(0).map_err(map_postgres_execution_error)?,
                unique: row.try_get(1).map_err(map_postgres_execution_error)?,
                origin: if primary {
                    "primary_key".to_owned()
                } else {
                    "index".to_owned()
                },
                partial: row.try_get(3).map_err(map_postgres_execution_error)?,
                has_expressions: row.try_get(4).map_err(map_postgres_execution_error)?,
                columns: row.try_get(5).map_err(map_postgres_execution_error)?,
            })
        })
        .collect::<Result<Vec<_>, QueryNotError>>()?;
    let definition = if kind == SchemaObjectKind::View {
        sqlx::query_scalar(
            "SELECT pg_catalog.pg_get_viewdef(c.oid, true) \
             FROM pg_catalog.pg_class c \
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = $1 AND c.relname = $2",
        )
        .bind(namespace)
        .bind(object_name)
        .fetch_optional(&mut *connection)
        .await
        .map_err(map_postgres_execution_error)?
    } else {
        None
    };
    Ok(SchemaObjectDetail {
        object: SchemaObject {
            namespace: namespace.to_owned(),
            name: object_name.to_owned(),
            kind,
        },
        columns,
        foreign_keys,
        indexes,
        definition,
        routines_supported: true,
    })
}

fn result_columns(columns: &[sqlx::postgres::PgColumn]) -> Vec<ResultColumn> {
    columns
        .iter()
        .map(|column| ResultColumn {
            name: column.name().to_owned(),
            declared_type: column.type_info().name().to_owned(),
            nullable: None,
        })
        .collect()
}

fn postgres_values(row: &PgRow) -> Result<Vec<TaggedValue>, QueryNotError> {
    (0..row.len())
        .map(|index| postgres_value(row, index))
        .collect()
}

fn postgres_value(row: &PgRow, index: usize) -> Result<TaggedValue, QueryNotError> {
    let raw = row
        .try_get_raw(index)
        .map_err(map_postgres_execution_error)?;
    if raw.is_null() {
        return Ok(TaggedValue::Null);
    }
    let type_name = raw.type_info().name().to_ascii_uppercase();
    if raw.format() == PgValueFormat::Text {
        if type_name == "BYTEA" {
            return row
                .try_get_unchecked::<Vec<u8>, _>(index)
                .map(TaggedValue::Bytes)
                .map_err(map_postgres_execution_error);
        }
        let value = raw.as_str().map_err(|_| {
            QueryNotError::database(
                crate::ErrorCategory::UnsupportedCapability,
                "A PostgreSQL value was not valid UTF-8 in the text protocol.",
                false,
            )
        })?;
        return postgres_text_value(&type_name, value);
    }
    match type_name.as_str() {
        "BOOL" => row
            .try_get_unchecked::<bool, _>(index)
            .map(TaggedValue::Boolean)
            .map_err(map_postgres_execution_error),
        "INT2" => integer_value(row.try_get_unchecked::<i16, _>(index)),
        "INT4" => integer_value(row.try_get_unchecked::<i32, _>(index)),
        "INT8" => integer_value(row.try_get_unchecked::<i64, _>(index)),
        "OID" | "XID" | "CID" => row
            .try_get_unchecked::<sqlx::postgres::types::Oid, _>(index)
            .map(|value| TaggedValue::UnsignedInteger(value.0.to_string()))
            .map_err(map_postgres_execution_error),
        "NUMERIC" => row
            .try_get_unchecked::<sqlx::types::BigDecimal, _>(index)
            .map(|value| TaggedValue::Decimal(value.to_string()))
            .map_err(map_postgres_execution_error),
        "FLOAT4" => float_value(
            row.try_get_unchecked::<f32, _>(index).map(f64::from),
            &type_name,
        ),
        "FLOAT8" => float_value(row.try_get_unchecked::<f64, _>(index), &type_name),
        "BYTEA" => row
            .try_get_unchecked::<Vec<u8>, _>(index)
            .map(TaggedValue::Bytes)
            .map_err(map_postgres_execution_error),
        "DATE" => row
            .try_get_unchecked::<NaiveDate, _>(index)
            .map(|value| TaggedValue::DateTime {
                raw: value.to_string(),
                timezone_or_offset: None,
            })
            .map_err(map_postgres_execution_error),
        "TIME" => row
            .try_get_unchecked::<NaiveTime, _>(index)
            .map(|value| TaggedValue::DateTime {
                raw: value.to_string(),
                timezone_or_offset: None,
            })
            .map_err(map_postgres_execution_error),
        "TIMESTAMP" => row
            .try_get_unchecked::<NaiveDateTime, _>(index)
            .map(|value| TaggedValue::DateTime {
                raw: value.to_string(),
                timezone_or_offset: None,
            })
            .map_err(map_postgres_execution_error),
        "TIMESTAMPTZ" => row
            .try_get_unchecked::<DateTime<Utc>, _>(index)
            .map(|value| TaggedValue::DateTime {
                raw: value.to_rfc3339(),
                timezone_or_offset: Some("+00:00".to_owned()),
            })
            .map_err(map_postgres_execution_error),
        "JSON" | "JSONB" => row
            .try_get_unchecked::<sqlx::types::Json<serde_json::Value>, _>(index)
            .map(|value| TaggedValue::AdapterSpecific {
                type_name,
                raw: value.0.to_string(),
            })
            .map_err(map_postgres_execution_error),
        "UUID" => row
            .try_get_unchecked::<uuid::Uuid, _>(index)
            .map(|value| TaggedValue::AdapterSpecific {
                type_name,
                raw: value.to_string(),
            })
            .map_err(map_postgres_execution_error),
        name if name.ends_with("[]") => postgres_array_value(row, index, name),
        "TEXT" | "VARCHAR" | "BPCHAR" | "CHAR" | "NAME" | "UNKNOWN" => row
            .try_get_unchecked::<String, _>(index)
            .map(TaggedValue::Text)
            .map_err(map_postgres_execution_error),
        _ => Err(QueryNotError::database(
            crate::ErrorCategory::UnsupportedCapability,
            format!(
                "PostgreSQL returned the binary type {type_name}, which this adapter cannot decode losslessly yet. Cast it to text for explicit inspection."
            ),
            false,
        )),
    }
}

fn postgres_text_value(type_name: &str, value: &str) -> Result<TaggedValue, QueryNotError> {
    let invalid = || {
        QueryNotError::database(
            crate::ErrorCategory::UnsupportedCapability,
            format!("PostgreSQL returned an invalid {type_name} text value."),
            false,
        )
    };
    Ok(match type_name {
        "BOOL" => TaggedValue::Boolean(match value {
            "t" | "true" => true,
            "f" | "false" => false,
            _ => return Err(invalid()),
        }),
        "INT2" | "INT4" | "INT8" => {
            TaggedValue::SignedInteger(value.parse::<i64>().map_err(|_| invalid())?.to_string())
        }
        "OID" | "XID" | "CID" => {
            TaggedValue::UnsignedInteger(value.parse::<u64>().map_err(|_| invalid())?.to_string())
        }
        "NUMERIC" => TaggedValue::Decimal(value.to_owned()),
        "FLOAT4" | "FLOAT8" => match value.parse::<f64>() {
            Ok(number) if number.is_finite() => TaggedValue::Float(number),
            _ => TaggedValue::AdapterSpecific {
                type_name: type_name.to_owned(),
                raw: value.to_owned(),
            },
        },
        "DATE" | "TIME" | "TIMESTAMP" | "TIMESTAMPTZ" => TaggedValue::DateTime {
            raw: value.to_owned(),
            timezone_or_offset: (type_name == "TIMESTAMPTZ")
                .then(|| postgres_timezone_hint(value))
                .flatten(),
        },
        "JSON" | "JSONB" | "UUID" => TaggedValue::AdapterSpecific {
            type_name: type_name.to_owned(),
            raw: value.to_owned(),
        },
        name if name.ends_with("[]") => TaggedValue::AdapterSpecific {
            type_name: type_name.to_owned(),
            raw: value.to_owned(),
        },
        _ => TaggedValue::Text(value.to_owned()),
    })
}

fn postgres_timezone_hint(value: &str) -> Option<String> {
    if value.ends_with('Z') {
        return Some("Z".to_owned());
    }
    let time = value.get(10..)?;
    time.rfind(['+', '-']).map(|index| time[index..].to_owned())
}

fn integer_value<T: ToString>(value: Result<T, sqlx::Error>) -> Result<TaggedValue, QueryNotError> {
    value
        .map(|value| TaggedValue::SignedInteger(value.to_string()))
        .map_err(map_postgres_execution_error)
}

fn float_value(
    value: Result<f64, sqlx::Error>,
    type_name: &str,
) -> Result<TaggedValue, QueryNotError> {
    value
        .map(|value| {
            if value.is_finite() {
                TaggedValue::Float(value)
            } else {
                TaggedValue::AdapterSpecific {
                    type_name: type_name.to_owned(),
                    raw: value.to_string(),
                }
            }
        })
        .map_err(map_postgres_execution_error)
}

fn postgres_array_value(
    row: &PgRow,
    index: usize,
    type_name: &str,
) -> Result<TaggedValue, QueryNotError> {
    macro_rules! array_json {
        ($type:ty) => {{
            let values = row
                .try_get_unchecked::<Vec<Option<$type>>, _>(index)
                .map_err(map_postgres_execution_error)?;
            serde_json::to_string(&values).map_err(|_| {
                QueryNotError::internal(
                    "A decoded PostgreSQL array could not be bounded for display.",
                )
            })?
        }};
    }
    let raw = match type_name {
        "BOOL[]" => array_json!(bool),
        "INT2[]" => array_json!(i16),
        "INT4[]" => array_json!(i32),
        "INT8[]" => array_json!(i64),
        "FLOAT4[]" => array_json!(f32),
        "FLOAT8[]" => array_json!(f64),
        "TEXT[]" | "VARCHAR[]" | "BPCHAR[]" | "NAME[]" => array_json!(String),
        "UUID[]" => array_json!(uuid::Uuid),
        "NUMERIC[]" => {
            let values = row
                .try_get_unchecked::<Vec<Option<sqlx::types::BigDecimal>>, _>(index)
                .map_err(map_postgres_execution_error)?;
            let values = values
                .into_iter()
                .map(|value| value.map(|value| value.to_string()))
                .collect::<Vec<_>>();
            serde_json::to_string(&values).map_err(|_| {
                QueryNotError::internal(
                    "A decoded PostgreSQL numeric array could not be displayed.",
                )
            })?
        }
        _ => {
            return Err(QueryNotError::database(
                crate::ErrorCategory::UnsupportedCapability,
                format!(
                    "PostgreSQL returned the array type {type_name}, which this adapter cannot decode losslessly yet. Cast it to text for explicit inspection."
                ),
                false,
            ));
        }
    };
    Ok(TaggedValue::AdapterSpecific {
        type_name: type_name.to_owned(),
        raw,
    })
}

fn bind_postgres_value<'q>(
    query: Query<'q, Postgres, PgArguments>,
    value: TaggedValue,
) -> Result<Query<'q, Postgres, PgArguments>, QueryNotError> {
    Ok(match value {
        TaggedValue::Null => {
            return Err(QueryNotError::authorization(
                "PostgreSQL NULL values must be represented directly in the immutable SQL plan.",
            ));
        }
        TaggedValue::Text(value) => query.bind(value),
        TaggedValue::Bytes(value) => query.bind(value),
        TaggedValue::SignedInteger(value) => query.bind(value.parse::<i64>().map_err(|_| {
            QueryNotError::authorization("A staged PostgreSQL integer is out of range.")
        })?),
        TaggedValue::UnsignedInteger(value) => {
            let value = value.parse::<u64>().map_err(|_| {
                QueryNotError::authorization("A PostgreSQL paging value is out of range.")
            })?;
            let value = i64::try_from(value).map_err(|_| {
                QueryNotError::authorization("A PostgreSQL paging value exceeds BIGINT.")
            })?;
            query.bind(value)
        }
        TaggedValue::Decimal(value) => query.bind(
            value
                .parse::<sqlx::types::BigDecimal>()
                .map_err(|_| QueryNotError::authorization("A staged decimal is invalid."))?,
        ),
        TaggedValue::Float(value) if value.is_finite() => query.bind(value),
        TaggedValue::Float(_) => {
            return Err(QueryNotError::authorization(
                "A staged PostgreSQL floating-point value must be finite.",
            ));
        }
        TaggedValue::Boolean(value) => query.bind(value),
        TaggedValue::DateTime { raw, .. } => {
            if let Ok(value) = DateTime::parse_from_rfc3339(&raw) {
                query.bind(value)
            } else if let Ok(value) = NaiveDateTime::parse_from_str(&raw, "%Y-%m-%d %H:%M:%S%.f")
                .or_else(|_| NaiveDateTime::parse_from_str(&raw, "%Y-%m-%dT%H:%M:%S%.f"))
            {
                query.bind(value)
            } else if let Ok(value) = NaiveDate::parse_from_str(&raw, "%Y-%m-%d") {
                query.bind(value)
            } else if let Ok(value) = NaiveTime::parse_from_str(&raw, "%H:%M:%S%.f") {
                query.bind(value)
            } else {
                return Err(QueryNotError::authorization(
                    "A staged PostgreSQL date/time value is invalid.",
                ));
            }
        }
        TaggedValue::AdapterSpecific { .. } => {
            return Err(QueryNotError::authorization(
                "PostgreSQL adapter-specific and array values remain read-only in table editing.",
            ));
        }
    })
}

async fn rollback_postgres_mutations(
    session: &PostgresSession,
    connection: &mut PgConnection,
) -> Result<(), QueryNotError> {
    if connection.execute("ROLLBACK").await.is_err() {
        set_transaction_certainty(&session.transaction, TransactionCertainty::Unknown);
        return Err(QueryNotError::database(
            crate::ErrorCategory::Transaction,
            "The server could not confirm rollback of the failed mutation batch. Reconnect before another write.",
            false,
        ));
    }
    Ok(())
}

fn reconcile_statement_effect(session: &PostgresSession, keyword: Option<&str>) {
    let certainty = match keyword {
        Some("BEGIN" | "START" | "SAVEPOINT") => TransactionCertainty::Active,
        Some("COMMIT" | "END" | "ROLLBACK") => TransactionCertainty::Clean,
        Some(_) if session.automatic.load(Ordering::Acquire) => TransactionCertainty::Clean,
        Some(_) => TransactionCertainty::Active,
        None => TransactionCertainty::Unknown,
    };
    set_transaction_certainty(&session.transaction, certainty);
}

fn session_transaction_state(session: &PostgresSession) -> SqliteTransactionState {
    SqliteTransactionState {
        automatic: session.automatic.load(Ordering::Acquire),
        certainty: transaction_certainty(&session.transaction),
    }
}

fn unknown_transaction(session: &PostgresSession) -> SqliteTransactionState {
    set_transaction_certainty(&session.transaction, TransactionCertainty::Unknown);
    session_transaction_state(session)
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

fn clear_active(active: &StdMutex<Option<Arc<AtomicBool>>>) {
    if let Ok(mut active) = active.lock() {
        *active = None;
    }
}

fn no_transaction_error(action: &str) -> QueryNotError {
    QueryNotError::database(
        crate::ErrorCategory::Transaction,
        format!("There is no open transaction to {action}."),
        false,
    )
}

fn validate_metadata(value: &str) -> Result<(), QueryNotError> {
    if value.is_empty() || value.len() > MAX_METADATA_BYTES || value.bytes().any(|byte| byte == 0) {
        return Err(QueryNotError::database(
            crate::ErrorCategory::UnsupportedCapability,
            "PostgreSQL metadata exceeds the safe display boundary.",
            false,
        ));
    }
    Ok(())
}

fn metadata_limit_error() -> QueryNotError {
    QueryNotError::database(
        crate::ErrorCategory::UnsupportedCapability,
        "This namespace exceeds the 10,000-object explorer safety limit.",
        false,
    )
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn map_postgres_connect_error(error: sqlx::Error) -> QueryNotError {
    let category = postgres_error_category(&error);
    let safe_detail = postgres_safe_detail(&error);
    let mut mapped = QueryNotError::database(
        category,
        match category {
            crate::ErrorCategory::Authentication => {
                "The PostgreSQL server rejected the supplied credential."
            }
            crate::ErrorCategory::Authorization => {
                "The PostgreSQL server denied access to the requested database."
            }
            crate::ErrorCategory::Tls => {
                "TLS setup or server identity verification failed; QueryNot did not downgrade the connection."
            }
            crate::ErrorCategory::Connectivity => {
                "QueryNot could not establish the direct PostgreSQL connection."
            }
            _ => "PostgreSQL connection setup failed safely.",
        },
        matches!(
            category,
            crate::ErrorCategory::Connectivity | crate::ErrorCategory::Timeout
        ),
    );
    mapped.safe_detail = safe_detail;
    mapped
}

fn map_postgres_execution_error(error: sqlx::Error) -> QueryNotError {
    let category = postgres_error_category(&error);
    let safe_detail = postgres_safe_detail(&error);
    let mut mapped = QueryNotError::database(
        category,
        match category {
            crate::ErrorCategory::Cancelled => {
                "The PostgreSQL server confirmed cancellation of the active statement."
            }
            crate::ErrorCategory::Syntax => "The server rejected the statement syntax.",
            crate::ErrorCategory::Constraint => {
                "The server rejected the statement because a constraint would be violated."
            }
            crate::ErrorCategory::Authentication => {
                "The PostgreSQL session credential is no longer accepted."
            }
            crate::ErrorCategory::Authorization => "The PostgreSQL server denied this operation.",
            crate::ErrorCategory::Timeout => "The server timed out the active operation.",
            crate::ErrorCategory::Transaction => {
                "The PostgreSQL server could not complete the transaction operation."
            }
            crate::ErrorCategory::Connectivity => {
                "The PostgreSQL connection was interrupted during the operation."
            }
            _ => "The PostgreSQL server could not complete the operation.",
        },
        matches!(
            category,
            crate::ErrorCategory::Connectivity | crate::ErrorCategory::Timeout
        ),
    );
    mapped.safe_detail = safe_detail;
    mapped
}

fn postgres_safe_detail(error: &sqlx::Error) -> Option<String> {
    if let Some(code) = error
        .as_database_error()
        .and_then(|database| database.code())
    {
        return Some(format!("SQLSTATE: {code}."));
    }
    match error {
        sqlx::Error::ColumnDecode { index, .. } => {
            Some(format!("Value decoding failed at result column {index}."))
        }
        sqlx::Error::Decode(_) => {
            Some("A native value could not be decoded losslessly.".to_owned())
        }
        sqlx::Error::ColumnIndexOutOfBounds { index, len } => Some(format!(
            "The result shape exposed column {index} but contained {len} columns."
        )),
        _ => None,
    }
}

fn postgres_error_category(error: &sqlx::Error) -> crate::ErrorCategory {
    if let Some(database) = error.as_database_error() {
        let code = database.code();
        let code = code.as_deref().unwrap_or_default();
        return match code {
            "28P01" => crate::ErrorCategory::Authentication,
            "42501" | "3D000" => crate::ErrorCategory::Authorization,
            "42601" => crate::ErrorCategory::Syntax,
            "57014" => crate::ErrorCategory::Cancelled,
            "25P02" | "25000" => crate::ErrorCategory::Transaction,
            code if code.starts_with("23") => crate::ErrorCategory::Constraint,
            code if code.starts_with("08") => crate::ErrorCategory::Connectivity,
            _ => crate::ErrorCategory::Internal,
        };
    }
    match error {
        sqlx::Error::Tls(_) => crate::ErrorCategory::Tls,
        sqlx::Error::Io(_) | sqlx::Error::Protocol(_) | sqlx::Error::WorkerCrashed => {
            crate::ErrorCategory::Connectivity
        }
        sqlx::Error::PoolTimedOut => crate::ErrorCategory::Timeout,
        _ => crate::ErrorCategory::Internal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn postgres18_line_and_exact_fixture_are_classified_fail_closed() {
        assert_eq!(
            classify_compatibility("18.6"),
            (CompatibilityStatus::Supported, true)
        );
        assert_eq!(
            classify_compatibility("18.4"),
            (CompatibilityStatus::Supported, false)
        );
        assert_eq!(
            classify_compatibility("17.11"),
            (CompatibilityStatus::QueryOnly, false)
        );
        assert_eq!(
            classify_compatibility("19.0"),
            (CompatibilityStatus::QueryOnly, false)
        );
    }

    #[test]
    fn version_parser_accepts_vendor_suffixes_without_guessing_malformed_versions() {
        assert_eq!(
            parse_exact_version("18.6 (Debian 18.6-1)"),
            Some("18.6".to_owned())
        );
        assert_eq!(parse_exact_version("18beta2"), None);
        assert_eq!(parse_exact_version("PostgreSQL"), None);
    }
}
