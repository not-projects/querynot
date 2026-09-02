use crate::adapter::{
    AdapterCapabilities, AdapterConnectionInfo, CompatibilityStatus, DatabaseFamily, ServerIdentity,
};
use crate::explain::{ExplainRunOutcome, normalize_mysql_family};
use crate::profile::{ConnectionProfile, ConnectionTarget, TlsMode};
use crate::result::{
    MAX_BATCH_BYTES, MAX_BATCH_ROWS, MAX_RETAINED_BYTES, MAX_RETAINED_ROWS, PAUSED_CURSOR_LIFETIME,
    ResultBatch, ResultColumn, ResultTerminal, ResultTerminalState, tagged_value_size,
};
use crate::sql::ExecutionPlan;
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
use pkcs8::{EncryptedPrivateKeyInfo, SecretDocument, der::pem::LineEnding};
use secrecy::ExposeSecret;
use sqlx::mysql::{MySqlArguments, MySqlConnectOptions, MySqlRow, MySqlSslMode};
use sqlx::query::Query;
use sqlx::{
    AssertSqlSafe, Column, ConnectOptions, Connection, Either, Executor, MySql, MySqlConnection,
    Row, SqlSafeStr, Statement, TypeInfo, ValueRef,
};
use std::path::Path;
use std::sync::{
    Arc, Mutex as StdMutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, mpsc};
use zeroize::Zeroizing;

const MAX_METADATA_BYTES: usize = 64 * 1024;
const MAX_SCHEMA_OBJECTS: usize = 10_000;
const MAX_CLIENT_KEY_BYTES: u64 = 1024 * 1024;

#[derive(Clone)]
pub struct MySqlSession {
    connection: Arc<Mutex<MySqlConnection>>,
    control_options: MySqlConnectOptions,
    connection_id: Arc<AtomicU64>,
    read_only: bool,
    automatic: Arc<AtomicBool>,
    transaction: Arc<StdMutex<TransactionCertainty>>,
    transaction_variable_available: bool,
    active_cancel: Arc<StdMutex<Option<Arc<AtomicBool>>>>,
    active_cancel_confirmed: Arc<StdMutex<Option<Arc<AtomicBool>>>>,
}

impl std::fmt::Debug for MySqlSession {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("MySqlSession")
            .field("connection", &"[NATIVE SESSION]")
            .field("control_options", &"[REDACTED]")
            .field("read_only", &self.read_only)
            .finish_non_exhaustive()
    }
}

impl MySqlSession {
    pub async fn open(
        profile: &ConnectionProfile,
        secrets: &ConnectionSecrets,
    ) -> Result<Self, QueryNotError> {
        let options = connect_options(profile, secrets)?;
        let mut connection = MySqlConnection::connect_with(&options)
            .await
            .map_err(map_mysql_connect_error)?;
        connection
            .execute("SET SESSION autocommit = 1")
            .await
            .map_err(map_mysql_execution_error)?;
        let info = connection_info(&mut connection, profile).await?;
        // MySQL 8 and the supported MariaDB lines expose an authoritative
        // session variable. MySQL 5.7 does not, so it uses the conservative
        // statement-effect state machine below while still reading autocommit
        // from the server after every statement.
        let transaction_variable_available =
            sqlx::query_scalar::<_, i64>("SELECT @@session.in_transaction")
                .fetch_one(&mut connection)
                .await
                .is_ok();
        let connection_id: u64 = sqlx::query_scalar("SELECT CONNECTION_ID()")
            .fetch_one(&mut connection)
            .await
            .map_err(map_mysql_execution_error)?;
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
            control_options: options,
            connection_id: Arc::new(AtomicU64::new(connection_id)),
            read_only: info.read_only,
            automatic: Arc::new(AtomicBool::new(true)),
            transaction: Arc::new(StdMutex::new(TransactionCertainty::Clean)),
            transaction_variable_available,
            active_cancel: Arc::new(StdMutex::new(None)),
            active_cancel_confirmed: Arc::new(StdMutex::new(None)),
        })
    }

    pub async fn test(
        profile: &ConnectionProfile,
        secrets: &ConnectionSecrets,
    ) -> Result<AdapterConnectionInfo, QueryNotError> {
        let options = connect_options(profile, secrets)?;
        let mut connection = MySqlConnection::connect_with(&options)
            .await
            .map_err(map_mysql_connect_error)?;
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
        let connection_id = self.connection_id.load(Ordering::Acquire);
        let options = self.control_options.clone();
        if connection_id != 0
            && let Ok(handle) = tokio::runtime::Handle::try_current()
        {
            handle.spawn(async move {
                let Ok(mut control) = MySqlConnection::connect_with(&options).await else {
                    return;
                };
                let statement = format!("KILL QUERY {connection_id}");
                if sqlx::raw_sql(AssertSqlSafe(statement.as_str()))
                    .execute(&mut control)
                    .await
                    .is_ok()
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
        let rows =
            sqlx::query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME")
                .fetch_all(&mut *connection)
                .await
                .map_err(map_mysql_execution_error)?;
        if rows.len() > MAX_SCHEMA_OBJECTS {
            return Err(metadata_limit_error());
        }
        rows.into_iter()
            .map(|row| {
                let name: String = row.try_get(0).map_err(map_mysql_execution_error)?;
                validate_metadata(&name)?;
                Ok(SchemaNamespace { name })
            })
            .collect()
    }

    pub async fn objects(&self, namespace: &str) -> Result<Vec<SchemaObject>, QueryNotError> {
        validate_metadata(namespace)?;
        let mut connection = self.connection.lock().await;
        let rows = sqlx::query(
            "SELECT TABLE_SCHEMA, TABLE_NAME, CASE WHEN TABLE_TYPE = 'VIEW' THEN 'view' ELSE 'table' END AS object_kind \
             FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? \
             UNION ALL \
             SELECT ROUTINE_SCHEMA, ROUTINE_NAME, 'routine' FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? \
             ORDER BY 2, 3",
        )
        .bind(namespace)
        .bind(namespace)
        .fetch_all(&mut *connection)
        .await
        .map_err(map_mysql_execution_error)?;
        if rows.len() > MAX_SCHEMA_OBJECTS {
            return Err(metadata_limit_error());
        }
        rows.into_iter()
            .map(|row| {
                let object_namespace: String = row.try_get(0).map_err(map_mysql_execution_error)?;
                let name: String = row.try_get(1).map_err(map_mysql_execution_error)?;
                let kind: String = row.try_get(2).map_err(map_mysql_execution_error)?;
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
        let statement = format!("USE {}", quote_identifier(context));
        connection
            .execute(AssertSqlSafe(statement.as_str()))
            .await
            .map_err(map_mysql_execution_error)?;
        let confirmed: Option<String> = sqlx::query_scalar("SELECT DATABASE()")
            .fetch_one(&mut *connection)
            .await
            .map_err(map_mysql_execution_error)?;
        match confirmed {
            Some(confirmed) if confirmed == context => Ok(confirmed),
            _ => Err(QueryNotError::database(
                crate::ErrorCategory::Connectivity,
                "The server did not confirm the requested database context.",
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
        let plan = plan_browse(&definition, TableDialect::MySql, input)?;
        let mut query = sqlx::query(AssertSqlSafe(plan.sql.as_str()));
        for value in plan.parameters.iter().cloned() {
            query = bind_mysql_value(query, value)?;
        }
        let rows = query
            .fetch_all(&mut *connection)
            .await
            .map_err(map_mysql_execution_error)?;
        let mut values = rows
            .iter()
            .map(mysql_values)
            .collect::<Result<Vec<_>, _>>()?;
        if values
            .iter()
            .any(|row| row.len() != definition.columns.len())
        {
            return Err(QueryNotError::internal(
                "MySQL-family table paging returned a stale row shape.",
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
                "This MySQL-family session is read-only.",
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
            .execute("START TRANSACTION")
            .await
            .map_err(map_mysql_execution_error)?;
        let mut affected_rows = 0_u64;
        for operation in &plan.operations {
            let mut query = sqlx::query(AssertSqlSafe(operation.sql.as_str()));
            for value in operation.parameters.iter().cloned() {
                query = match bind_mysql_value(query, value) {
                    Ok(bound) => bound,
                    Err(error) => {
                        rollback_mysql_mutations(self, &mut connection).await?;
                        return Err(error);
                    }
                };
            }
            match query.execute(&mut *connection).await {
                Ok(result) if result.rows_affected() == operation.expected_rows => {
                    affected_rows = affected_rows.saturating_add(result.rows_affected());
                }
                Ok(_) => {
                    rollback_mysql_mutations(self, &mut connection).await?;
                    return Err(QueryNotError::database(
                        crate::ErrorCategory::Constraint,
                        "A staged row no longer matched exactly one original row. The complete batch was rolled back and remains staged.",
                        false,
                    ));
                }
                Err(error) => {
                    let mapped = map_mysql_execution_error(error);
                    rollback_mysql_mutations(self, &mut connection).await?;
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
        let mut connection = self.connection.lock().await;
        let current = reconcile_transaction(
            &mut connection,
            &self.transaction,
            self.transaction_variable_available,
        )
        .await?;
        if automatic && current.certainty != TransactionCertainty::Clean {
            return Err(QueryNotError::database(
                crate::ErrorCategory::Transaction,
                "Commit or roll back the open transaction before returning to auto-commit.",
                false,
            ));
        }
        connection
            .execute(if automatic {
                "SET SESSION autocommit = 1"
            } else {
                "SET SESSION autocommit = 0"
            })
            .await
            .map_err(map_mysql_execution_error)?;
        self.automatic.store(automatic, Ordering::Release);
        set_transaction_certainty(&self.transaction, TransactionCertainty::Clean);
        reconcile_transaction(
            &mut connection,
            &self.transaction,
            self.transaction_variable_available,
        )
        .await
    }

    pub async fn commit(&self) -> Result<SqliteTransactionState, QueryNotError> {
        let mut connection = self.connection.lock().await;
        let current = reconcile_transaction(
            &mut connection,
            &self.transaction,
            self.transaction_variable_available,
        )
        .await?;
        if current.certainty == TransactionCertainty::Clean {
            return Err(no_transaction_error("commit"));
        }
        connection
            .execute("COMMIT")
            .await
            .map_err(map_mysql_execution_error)?;
        set_transaction_certainty(&self.transaction, TransactionCertainty::Clean);
        reconcile_transaction(
            &mut connection,
            &self.transaction,
            self.transaction_variable_available,
        )
        .await
    }

    pub async fn rollback(&self) -> Result<SqliteTransactionState, QueryNotError> {
        let mut connection = self.connection.lock().await;
        let current = reconcile_transaction(
            &mut connection,
            &self.transaction,
            self.transaction_variable_available,
        )
        .await?;
        if current.certainty == TransactionCertainty::Clean {
            return Err(no_transaction_error("roll back"));
        }
        connection
            .execute("ROLLBACK")
            .await
            .map_err(map_mysql_execution_error)?;
        set_transaction_certainty(&self.transaction, TransactionCertainty::Clean);
        reconcile_transaction(
            &mut connection,
            &self.transaction,
            self.transaction_variable_available,
        )
        .await
    }

    pub async fn explain(&self, sql: &str, product: &str) -> ExplainRunOutcome {
        let cancel = Arc::new(AtomicBool::new(true));
        let cancel_confirmed = Arc::new(AtomicBool::new(false));
        if let Ok(mut active) = self.active_cancel.lock() {
            *active = Some(Arc::clone(&cancel));
        }
        if let Ok(mut active) = self.active_cancel_confirmed.lock() {
            *active = Some(Arc::clone(&cancel_confirmed));
        }
        let statement = format!("EXPLAIN FORMAT=JSON {sql}");
        let result = {
            let mut connection = self.connection.lock().await;
            sqlx::query_scalar::<_, String>(AssertSqlSafe(statement.as_str()))
                .fetch_one(&mut *connection)
                .await
        };
        clear_active(&self.active_cancel);
        clear_active(&self.active_cancel_confirmed);
        if !cancel.load(Ordering::Acquire) {
            return ExplainRunOutcome::Cancelled {
                confirmed: cancel_confirmed.load(Ordering::Acquire),
            };
        }
        match result {
            Ok(raw) => match normalize_mysql_family(raw, product) {
                Ok(output) => ExplainRunOutcome::Completed(output),
                Err(error) => ExplainRunOutcome::Failed(error),
            },
            Err(error) => ExplainRunOutcome::Failed(map_mysql_execution_error(error)),
        }
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
        let mut total_received: usize = 0;
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
                            "This server version is outside the tested matrix; QueryNot disabled possible writes for this connection.",
                            false,
                        ),
                        transaction: session_transaction_state(self),
                    })
                    .await;
                break;
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
                                "The MySQL-family result shape changed without a result-set boundary.",
                            ));
                            failed = true;
                            break 'stream;
                        }
                        let values = match mysql_values(&row) {
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
                        if mysql_error_category(&error) == crate::ErrorCategory::Cancelled {
                            cancel_confirmed.store(true, Ordering::Release);
                            cancel.store(false, Ordering::Release);
                        } else if cancel.load(Ordering::Acquire) {
                            statement_error = Some(map_mysql_execution_error(error));
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
                let transaction = transaction_after_error(
                    &mut connection,
                    &self.transaction,
                    self.transaction_variable_available,
                )
                .await;
                let _ = events
                    .send(SqliteExecutionEvent::Failed {
                        execution_id,
                        statement_index: Some(statement.index),
                        statement_start: Some(statement.start),
                        statement_end: Some(statement.end),
                        error,
                        transaction,
                    })
                    .await;
                break 'statements;
            }
            if failed || !cancel.load(Ordering::Acquire) {
                break;
            }
            if !self.transaction_variable_available {
                reconcile_mysql57_statement_effect(
                    &self.transaction,
                    &statement.sql,
                    self.automatic.load(Ordering::Acquire),
                );
            }
            let transaction = match reconcile_transaction(
                &mut connection,
                &self.transaction,
                self.transaction_variable_available,
            )
            .await
            {
                Ok(transaction) => transaction,
                Err(error) => {
                    failed = true;
                    let _ = events
                        .send(SqliteExecutionEvent::Failed {
                            execution_id,
                            statement_index: Some(statement.index),
                            statement_start: Some(statement.start),
                            statement_end: Some(statement.end),
                            error,
                            transaction: unknown_transaction(self),
                        })
                        .await;
                    break;
                }
            };
            self.automatic
                .store(transaction.automatic, Ordering::Release);
            statements_completed += 1;
            let _ = events
                .send(SqliteExecutionEvent::StatementMessage {
                    execution_id,
                    statement_index: statement.index,
                    rows_affected,
                    duration: statement_started.elapsed(),
                    transaction,
                })
                .await;
        }

        let transaction = if failed {
            session_transaction_state(self)
        } else {
            reconcile_transaction(
                &mut connection,
                &self.transaction,
                self.transaction_variable_available,
            )
            .await
            .unwrap_or_else(|_| unknown_transaction(self))
        };
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
) -> Result<MySqlConnectOptions, QueryNotError> {
    let ConnectionTarget::MysqlFamily {
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
            "The MySQL-family adapter cannot open a SQLite profile.",
            false,
        ));
    };
    let ssl_mode = match tls_mode {
        TlsMode::Disabled => MySqlSslMode::Disabled,
        TlsMode::Required => MySqlSslMode::Required,
        TlsMode::VerifyIdentity | TlsMode::CustomCa => MySqlSslMode::VerifyIdentity,
    };
    let mut options = MySqlConnectOptions::new()
        .host(host)
        .port(*port)
        .username(username)
        .password(secrets.database_password().expose_secret())
        .ssl_mode(ssl_mode)
        .disable_statement_logging();
    if let Some(database) = default_database {
        options = options.database(database);
    }
    if let Some(path) = tls_ca_path {
        options = options.ssl_ca(path);
    }
    if let Some(path) = tls_client_certificate_path {
        options = options.ssl_client_cert(path);
    }
    if let Some(path) = tls_client_key_path {
        let passphrase = secrets.client_key_passphrase().expose_secret();
        if passphrase.is_empty() {
            options = options.ssl_client_key(path);
        } else {
            let decrypted_pem = decrypt_client_key_pem(Path::new(path), passphrase)?;
            options = options.ssl_client_key_from_pem(decrypted_pem.as_bytes());
        }
    }
    Ok(options)
}

pub(crate) fn decrypt_client_key_pem(
    path: &Path,
    passphrase: &str,
) -> Result<Zeroizing<String>, QueryNotError> {
    let metadata = std::fs::metadata(path).map_err(|_| {
        QueryNotError::database(
            crate::ErrorCategory::Tls,
            "The granted client private key is unavailable; no connection was attempted.",
            false,
        )
    })?;
    if !metadata.is_file() {
        return Err(QueryNotError::database(
            crate::ErrorCategory::Tls,
            "The granted client private key is not a regular file; no connection was attempted.",
            false,
        ));
    }
    if metadata.len() > MAX_CLIENT_KEY_BYTES {
        return Err(QueryNotError::database(
            crate::ErrorCategory::Tls,
            "The client private key exceeds the 1 MiB safety limit.",
            false,
        ));
    }
    let encrypted_pem = Zeroizing::new(std::fs::read_to_string(path).map_err(|_| {
        QueryNotError::database(
            crate::ErrorCategory::Tls,
            "The granted client private key could not be read safely.",
            false,
        )
    })?);
    let (label, document) = SecretDocument::from_pem(&encrypted_pem).map_err(|_| {
        QueryNotError::database(
            crate::ErrorCategory::Tls,
            "The client private key is not a supported PEM document.",
            false,
        )
    })?;
    if label != "ENCRYPTED PRIVATE KEY" {
        return Err(QueryNotError::database(
            crate::ErrorCategory::Tls,
            "A client-key passphrase was supplied, but the key is not encrypted PKCS#8 PEM.",
            false,
        ));
    }
    let encrypted = EncryptedPrivateKeyInfo::try_from(document.as_bytes()).map_err(|_| {
        QueryNotError::database(
            crate::ErrorCategory::Tls,
            "The encrypted client private key has an invalid PKCS#8 structure.",
            false,
        )
    })?;
    let decrypted = encrypted.decrypt(passphrase.as_bytes()).map_err(|_| {
        QueryNotError::database(
            crate::ErrorCategory::Authorization,
            "The client private key could not be unlocked with the supplied passphrase.",
            false,
        )
    })?;
    decrypted
        .to_pem("PRIVATE KEY", LineEnding::LF)
        .map_err(|_| {
            QueryNotError::database(
                crate::ErrorCategory::Tls,
                "The unlocked client private key could not be prepared for TLS.",
                false,
            )
        })
}

async fn connection_info(
    connection: &mut MySqlConnection,
    profile: &ConnectionProfile,
) -> Result<AdapterConnectionInfo, QueryNotError> {
    let row = sqlx::query("SELECT VERSION(), @@version_comment, DATABASE()")
        .fetch_one(&mut *connection)
        .await
        .map_err(map_mysql_execution_error)?;
    let reported_version: String = row.try_get(0).map_err(map_mysql_execution_error)?;
    let version_comment: String = row.try_get(1).map_err(map_mysql_execution_error)?;
    let context: Option<String> = row.try_get(2).map_err(map_mysql_execution_error)?;
    let version_says_mariadb = reported_version.to_ascii_lowercase().contains("mariadb");
    let comment_says_mariadb = version_comment.to_ascii_lowercase().contains("mariadb");
    if version_says_mariadb != comment_says_mariadb {
        return Err(QueryNotError::database(
            crate::ErrorCategory::UnsupportedCapability,
            "The server reported an ambiguous MySQL/MariaDB identity; QueryNot refused to guess.",
            false,
        ));
    }
    let product = if version_says_mariadb {
        "MariaDB"
    } else {
        "MySQL"
    };
    let exact_version = reported_version
        .split('-')
        .next()
        .unwrap_or(&reported_version)
        .to_owned();
    let (compatibility_status, legacy, exact_fixture) =
        classify_compatibility(product, &exact_version);
    let mut warnings = Vec::new();
    if compatibility_status == CompatibilityStatus::QueryOnly {
        warnings.push(format!(
            "{product} {exact_version} is outside the tested compatibility matrix; possible writes are disabled."
        ));
    }
    if compatibility_status == CompatibilityStatus::Supported && !exact_fixture {
        warnings.push(format!(
            "{product} {exact_version} is write-enabled under the MySQL 5.7 compatibility line; 5.7.44 remains the exact conformance fixture."
        ));
    }
    if legacy {
        warnings.push(format!(
            "{product} {exact_version} is a legacy/EOL line and should be upgraded."
        ));
    }
    if let ConnectionTarget::MysqlFamily { tls_mode, .. } = &profile.target {
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
    let read_only = compatibility_status == CompatibilityStatus::QueryOnly;
    Ok(AdapterConnectionInfo {
        identity: ServerIdentity {
            family: DatabaseFamily::MySqlFamily,
            product: product.to_owned(),
            exact_version,
            legacy,
        },
        capabilities: AdapterCapabilities {
            metadata: true,
            streaming: true,
            cancellation: true,
            explain: true,
            transactions: !read_only,
            multiple_results: true,
            safe_table_mutations: !read_only,
        },
        read_only,
        context: context.unwrap_or_else(|| "(no default database)".to_owned()),
        dialect: "mysql".to_owned(),
        compatibility_status,
        compatibility_warning: (!warnings.is_empty()).then(|| warnings.join(" ")),
    })
}

fn classify_compatibility(product: &str, exact_version: &str) -> (CompatibilityStatus, bool, bool) {
    let mysql57 = product == "MySQL" && mysql_version_line(exact_version) == Some((5, 7));
    match (product, exact_version) {
        ("MySQL", "5.7.44") => (CompatibilityStatus::Supported, true, true),
        ("MySQL", "8.0.46") => (CompatibilityStatus::Supported, true, true),
        ("MySQL", "8.4.10") | ("MariaDB", "10.11.18" | "11.4.12") => {
            (CompatibilityStatus::Supported, false, true)
        }
        _ if mysql57 => (CompatibilityStatus::Supported, true, false),
        _ => (CompatibilityStatus::QueryOnly, false, false),
    }
}

fn mysql_version_line(exact_version: &str) -> Option<(u64, u64)> {
    let mut components = exact_version.split('.');
    let major = components.next()?.parse().ok()?;
    let minor = components.next()?.parse().ok()?;
    components.next()?.parse::<u64>().ok()?;
    if components.next().is_some() {
        return None;
    }
    Some((major, minor))
}

async fn load_object_detail(
    connection: &mut MySqlConnection,
    namespace: &str,
    object_name: &str,
) -> Result<SchemaObjectDetail, QueryNotError> {
    let table_kind: Option<String> = sqlx::query_scalar(
        "SELECT TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
    )
    .bind(namespace)
    .bind(object_name)
    .fetch_optional(&mut *connection)
    .await
    .map_err(map_mysql_execution_error)?;
    if table_kind.is_none() {
        let definition: Option<String> = sqlx::query_scalar(
            "SELECT ROUTINE_DEFINITION FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = ?",
        )
        .bind(namespace)
        .bind(object_name)
        .fetch_optional(&mut *connection)
        .await
        .map_err(map_mysql_execution_error)?
        .flatten();
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
    let kind = if table_kind.as_deref() == Some("VIEW") {
        SchemaObjectKind::View
    } else {
        SchemaObjectKind::Table
    };
    let column_rows = sqlx::query(
        "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA \
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
         ORDER BY ORDINAL_POSITION",
    )
    .bind(namespace)
    .bind(object_name)
    .fetch_all(&mut *connection)
    .await
    .map_err(map_mysql_execution_error)?;
    let mut columns = column_rows
        .into_iter()
        .map(|row| {
            let name: String = row.try_get(0).map_err(map_mysql_execution_error)?;
            let declared_type: String = row.try_get(1).map_err(map_mysql_execution_error)?;
            validate_metadata(&name)?;
            validate_metadata(&declared_type)?;
            let extra: String = row.try_get(4).map_err(map_mysql_execution_error)?;
            Ok(SchemaColumn {
                name,
                declared_type,
                nullable: row
                    .try_get::<String, _>(2)
                    .map_err(map_mysql_execution_error)?
                    == "YES",
                default_expression: row.try_get(3).map_err(map_mysql_execution_error)?,
                primary_key_position: 0,
                generated: extra.to_ascii_uppercase().contains("GENERATED")
                    || extra.to_ascii_uppercase().contains("AUTO_INCREMENT"),
            })
        })
        .collect::<Result<Vec<_>, QueryNotError>>()?;
    let primary_key_rows = sqlx::query(
        "SELECT COLUMN_NAME, ORDINAL_POSITION FROM information_schema.KEY_COLUMN_USAGE \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' \
         ORDER BY ORDINAL_POSITION",
    )
    .bind(namespace)
    .bind(object_name)
    .fetch_all(&mut *connection)
    .await
    .map_err(map_mysql_execution_error)?;
    for row in primary_key_rows {
        let name: String = row.try_get(0).map_err(map_mysql_execution_error)?;
        let position = u32::try_from(mysql_metadata_counter(&row, 1)?).map_err(|_| {
            QueryNotError::database(
                crate::ErrorCategory::UnsupportedCapability,
                "MySQL-family key metadata exceeds the supported ordinal range.",
                false,
            )
        })?;
        if let Some(column) = columns.iter_mut().find(|column| column.name == name) {
            column.primary_key_position = position;
        }
    }
    let foreign_key_rows = sqlx::query(
        "SELECT k.CONSTRAINT_NAME, k.ORDINAL_POSITION, k.REFERENCED_TABLE_NAME, \
                k.COLUMN_NAME, k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE \
         FROM information_schema.KEY_COLUMN_USAGE k \
         JOIN information_schema.REFERENTIAL_CONSTRAINTS r \
           ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME \
         WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL \
         ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION",
    )
    .bind(namespace)
    .bind(object_name)
    .fetch_all(&mut *connection)
    .await
    .map_err(map_mysql_execution_error)?;
    let mut foreign_keys = Vec::new();
    let mut previous_constraint = String::new();
    let mut foreign_key_id = 0_i64;
    for row in foreign_key_rows {
        let constraint: String = row.try_get(0).map_err(map_mysql_execution_error)?;
        if constraint != previous_constraint {
            foreign_key_id += 1;
            previous_constraint = constraint;
        }
        foreign_keys.push(SchemaForeignKey {
            id: foreign_key_id,
            sequence: i64::try_from(mysql_metadata_counter(&row, 1)?)
                .ok()
                .and_then(|value| value.checked_sub(1))
                .ok_or_else(|| {
                    QueryNotError::database(
                        crate::ErrorCategory::UnsupportedCapability,
                        "MySQL-family foreign-key metadata contains an invalid ordinal.",
                        false,
                    )
                })?,
            referenced_table: row.try_get(2).map_err(map_mysql_execution_error)?,
            from_column: row.try_get(3).map_err(map_mysql_execution_error)?,
            to_column: row.try_get(4).map_err(map_mysql_execution_error)?,
            on_update: row.try_get(5).map_err(map_mysql_execution_error)?,
            on_delete: row.try_get(6).map_err(map_mysql_execution_error)?,
        });
    }
    let index_rows = sqlx::query(
        "SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX \
         FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
         ORDER BY INDEX_NAME, SEQ_IN_INDEX",
    )
    .bind(namespace)
    .bind(object_name)
    .fetch_all(&mut *connection)
    .await
    .map_err(map_mysql_execution_error)?;
    let mut indexes: Vec<SchemaIndex> = Vec::new();
    for row in index_rows {
        let name: String = row.try_get(0).map_err(map_mysql_execution_error)?;
        let unique = mysql_metadata_counter(&row, 1)? == 0;
        let column: Option<String> = row.try_get(2).map_err(map_mysql_execution_error)?;
        if indexes.last().is_none_or(|index| index.name != name) {
            indexes.push(SchemaIndex {
                origin: if name == "PRIMARY" {
                    "primary_key".to_owned()
                } else {
                    "index".to_owned()
                },
                name,
                unique,
                columns: Vec::new(),
                partial: false,
                has_expressions: false,
            });
        }
        if let Some(column) = column {
            indexes
                .last_mut()
                .expect("index was inserted")
                .columns
                .push(column);
        } else if let Some(index) = indexes.last_mut() {
            index.has_expressions = true;
        }
    }
    let definition = if kind == SchemaObjectKind::View {
        sqlx::query_scalar(
            "SELECT VIEW_DEFINITION FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
        )
        .bind(namespace)
        .bind(object_name)
        .fetch_optional(&mut *connection)
        .await
        .map_err(map_mysql_execution_error)?
    } else {
        let statement = format!(
            "SHOW CREATE TABLE {}.{}",
            quote_identifier(namespace),
            quote_identifier(object_name)
        );
        sqlx::query(AssertSqlSafe(statement.as_str()))
            .fetch_optional(&mut *connection)
            .await
            .map_err(map_mysql_execution_error)?
            .and_then(|row| row.try_get::<String, _>(1).ok())
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

fn result_columns(columns: &[sqlx::mysql::MySqlColumn]) -> Vec<ResultColumn> {
    columns
        .iter()
        .map(|column| ResultColumn {
            name: column.name().to_owned(),
            declared_type: column.type_info().name().to_owned(),
            nullable: None,
        })
        .collect()
}

fn mysql_values(row: &MySqlRow) -> Result<Vec<TaggedValue>, QueryNotError> {
    (0..row.len())
        .map(|index| {
            let raw = row.try_get_raw(index).map_err(map_mysql_execution_error)?;
            if raw.is_null() {
                return Ok(TaggedValue::Null);
            }
            let type_name = raw.type_info().name().to_ascii_uppercase();
            if type_name.contains("INT") || matches!(type_name.as_str(), "YEAR") {
                return Ok(if type_name.contains("UNSIGNED") {
                    TaggedValue::UnsignedInteger(
                        row.try_get_unchecked::<u64, _>(index)
                            .map_err(map_mysql_execution_error)?
                            .to_string(),
                    )
                } else {
                    TaggedValue::SignedInteger(
                        row.try_get_unchecked::<i64, _>(index)
                            .map_err(map_mysql_execution_error)?
                            .to_string(),
                    )
                });
            }
            if matches!(type_name.as_str(), "DECIMAL" | "NEWDECIMAL") {
                return row
                    .try_get_unchecked::<sqlx::types::BigDecimal, _>(index)
                    .map(|value| TaggedValue::Decimal(value.to_string()))
                    .map_err(map_mysql_execution_error);
            }
            if matches!(type_name.as_str(), "FLOAT" | "DOUBLE") {
                return row
                    .try_get_unchecked::<f64, _>(index)
                    .map(TaggedValue::Float)
                    .map_err(map_mysql_execution_error);
            }
            if matches!(
                type_name.as_str(),
                "DATE" | "DATETIME" | "TIMESTAMP" | "TIME"
            ) {
                let value: String = row
                    .try_get_unchecked(index)
                    .map_err(map_mysql_execution_error)?;
                return Ok(TaggedValue::DateTime {
                    raw: value,
                    // The classic protocol does not attach the session time-zone
                    // offset to a temporal cell. Preserve the engine text and do
                    // not invent an offset.
                    timezone_or_offset: None,
                });
            }
            if type_name == "BIT" {
                let value = row
                    .try_get_unchecked::<Vec<u8>, _>(index)
                    .map_err(map_mysql_execution_error)?;
                return Ok(match value.as_slice() {
                    [0] => TaggedValue::Boolean(false),
                    [1] => TaggedValue::Boolean(true),
                    _ => TaggedValue::Bytes(value),
                });
            }
            if type_name.contains("BLOB") || matches!(type_name.as_str(), "BINARY" | "VARBINARY") {
                return row
                    .try_get_unchecked::<Vec<u8>, _>(index)
                    .map(TaggedValue::Bytes)
                    .map_err(map_mysql_execution_error);
            }
            if matches!(type_name.as_str(), "JSON" | "ENUM" | "SET") {
                return row
                    .try_get_unchecked::<String, _>(index)
                    .map(|raw| TaggedValue::AdapterSpecific { type_name, raw })
                    .map_err(map_mysql_execution_error);
            }
            row.try_get_unchecked::<String, _>(index)
                .map(TaggedValue::Text)
                .or_else(|_| {
                    row.try_get_unchecked::<Vec<u8>, _>(index)
                        .map(TaggedValue::Bytes)
                })
                .map_err(map_mysql_execution_error)
        })
        .collect()
}

fn mysql_metadata_counter(row: &MySqlRow, index: usize) -> Result<u64, QueryNotError> {
    // MySQL-family information-schema counter columns vary in signedness across
    // supported server lines. Decode the nonnegative protocol value directly,
    // then let each caller enforce its narrower semantic range.
    row.try_get_unchecked::<u64, _>(index)
        .map_err(map_mysql_execution_error)
}

fn bind_mysql_value<'q>(
    query: Query<'q, MySql, MySqlArguments>,
    value: TaggedValue,
) -> Result<Query<'q, MySql, MySqlArguments>, QueryNotError> {
    Ok(match value {
        TaggedValue::Null => query.bind(Option::<String>::None),
        TaggedValue::Text(value) => query.bind(value),
        TaggedValue::Bytes(value) => query.bind(value),
        TaggedValue::SignedInteger(value) => query.bind(value.parse::<i64>().map_err(|_| {
            QueryNotError::authorization("A staged MySQL-family integer is out of range.")
        })?),
        TaggedValue::UnsignedInteger(value) => query.bind(value.parse::<u64>().map_err(|_| {
            QueryNotError::authorization("A staged MySQL-family integer is out of range.")
        })?),
        TaggedValue::Decimal(value) => query.bind(
            value
                .parse::<sqlx::types::BigDecimal>()
                .map_err(|_| QueryNotError::authorization("A staged decimal is invalid."))?,
        ),
        TaggedValue::Float(value) => query.bind(value),
        TaggedValue::Boolean(value) => query.bind(value),
        TaggedValue::DateTime { raw, .. } => query.bind(raw),
        TaggedValue::AdapterSpecific { raw, .. } => query.bind(raw),
    })
}

async fn rollback_mysql_mutations(
    session: &MySqlSession,
    connection: &mut MySqlConnection,
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

async fn reconcile_transaction(
    connection: &mut MySqlConnection,
    transaction: &StdMutex<TransactionCertainty>,
    transaction_variable_available: bool,
) -> Result<SqliteTransactionState, QueryNotError> {
    let automatic = sqlx::query_scalar::<_, i64>("SELECT @@session.autocommit")
        .fetch_one(&mut *connection)
        .await
        .map_err(map_mysql_execution_error)?
        != 0;
    let active = if transaction_variable_available {
        sqlx::query_scalar::<_, i64>("SELECT @@session.in_transaction")
            .fetch_one(&mut *connection)
            .await
            .map_err(map_mysql_execution_error)?
            != 0
    } else {
        transaction_certainty(transaction) == TransactionCertainty::Active
    };
    set_transaction_certainty(
        transaction,
        if active {
            TransactionCertainty::Active
        } else {
            TransactionCertainty::Clean
        },
    );
    Ok(SqliteTransactionState {
        automatic,
        certainty: if active {
            TransactionCertainty::Active
        } else {
            TransactionCertainty::Clean
        },
    })
}

fn reconcile_mysql57_statement_effect(
    transaction: &StdMutex<TransactionCertainty>,
    sql: &str,
    automatic_before_statement: bool,
) {
    let keyword = crate::sql::leading_statement_keyword(sql);
    let effect = match keyword.as_deref() {
        Some("BEGIN" | "START") => Some(TransactionCertainty::Active),
        Some("COMMIT" | "ROLLBACK") => Some(TransactionCertainty::Clean),
        // These classes contain the MySQL 5.7 statements exercised by the
        // editor that commit implicitly. Unknown administrative forms are
        // denied by normal authorization and cannot be treated as writes by
        // an unsupported/query-only connection.
        Some(
            "ALTER" | "CREATE" | "DROP" | "RENAME" | "TRUNCATE" | "GRANT" | "REVOKE" | "ANALYZE"
            | "OPTIMIZE" | "REPAIR" | "LOCK" | "UNLOCK" | "FLUSH" | "RESET" | "INSTALL"
            | "UNINSTALL",
        ) => Some(TransactionCertainty::Clean),
        Some("SET") if sql.to_ascii_uppercase().contains("AUTOCOMMIT") => {
            Some(TransactionCertainty::Clean)
        }
        Some("SHOW" | "DESCRIBE" | "DESC" | "EXPLAIN" | "USE") => None,
        Some(_) if automatic_before_statement => Some(TransactionCertainty::Clean),
        Some(_) => Some(TransactionCertainty::Active),
        None => Some(TransactionCertainty::Unknown),
    };
    if let Some(effect) = effect {
        set_transaction_certainty(transaction, effect);
    }
}

async fn transaction_after_error(
    connection: &mut MySqlConnection,
    transaction: &StdMutex<TransactionCertainty>,
    transaction_variable_available: bool,
) -> SqliteTransactionState {
    reconcile_transaction(connection, transaction, transaction_variable_available)
        .await
        .unwrap_or_else(|_| {
            set_transaction_certainty(transaction, TransactionCertainty::Unknown);
            SqliteTransactionState {
                automatic: false,
                certainty: TransactionCertainty::Unknown,
            }
        })
}

fn session_transaction_state(session: &MySqlSession) -> SqliteTransactionState {
    SqliteTransactionState {
        automatic: session.automatic.load(Ordering::Acquire),
        certainty: transaction_certainty(&session.transaction),
    }
}

fn unknown_transaction(session: &MySqlSession) -> SqliteTransactionState {
    set_transaction_certainty(&session.transaction, TransactionCertainty::Unknown);
    SqliteTransactionState {
        automatic: session.automatic.load(Ordering::Acquire),
        certainty: TransactionCertainty::Unknown,
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
            "MySQL-family metadata exceeds the safe display boundary.",
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
    format!("`{}`", value.replace('`', "``"))
}

fn map_mysql_connect_error(error: sqlx::Error) -> QueryNotError {
    let category = mysql_error_category(&error);
    let safe_detail = mysql_safe_detail(&error);
    let mut mapped = QueryNotError::database(
        category,
        match category {
            crate::ErrorCategory::Authentication => {
                "The MySQL-family server rejected the supplied credential."
            }
            crate::ErrorCategory::Authorization => {
                "The MySQL-family server denied access to the requested database."
            }
            crate::ErrorCategory::Tls => {
                "TLS setup or server identity verification failed; QueryNot did not downgrade the connection."
            }
            crate::ErrorCategory::Connectivity => {
                "QueryNot could not establish the direct MySQL-family connection."
            }
            _ => "MySQL-family connection setup failed safely.",
        },
        matches!(
            category,
            crate::ErrorCategory::Connectivity | crate::ErrorCategory::Timeout
        ),
    );
    mapped.safe_detail = safe_detail;
    mapped
}

fn map_mysql_execution_error(error: sqlx::Error) -> QueryNotError {
    let category = mysql_error_category(&error);
    let safe_detail = mysql_safe_detail(&error);
    let mut mapped = QueryNotError::database(
        category,
        match category {
            crate::ErrorCategory::Cancelled => {
                "The server confirmed cancellation of the active statement."
            }
            crate::ErrorCategory::Syntax => "The server rejected the statement syntax.",
            crate::ErrorCategory::Constraint => {
                "The server rejected the statement because a constraint would be violated."
            }
            crate::ErrorCategory::Authentication => {
                "The MySQL-family session credential is no longer accepted."
            }
            crate::ErrorCategory::Authorization => "The MySQL-family server denied this operation.",
            crate::ErrorCategory::Timeout => "The server timed out the active operation.",
            crate::ErrorCategory::Transaction => {
                "The server could not complete the transaction operation."
            }
            crate::ErrorCategory::Connectivity => {
                "The MySQL-family connection was interrupted during the operation."
            }
            _ => "The MySQL-family server could not complete the operation.",
        },
        matches!(
            category,
            crate::ErrorCategory::Connectivity | crate::ErrorCategory::Timeout
        ),
    );
    mapped.safe_detail = safe_detail;
    mapped
}

fn mysql_safe_detail(error: &sqlx::Error) -> Option<String> {
    if let Some(code) = error
        .as_database_error()
        .and_then(|database| database.code())
    {
        return Some(format!("Vendor error code: {code}."));
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

fn mysql_error_category(error: &sqlx::Error) -> crate::ErrorCategory {
    if let Some(database) = error.as_database_error() {
        return match database.code().as_deref() {
            Some("1045") => crate::ErrorCategory::Authentication,
            Some("1044" | "1142" | "1143" | "1227") => crate::ErrorCategory::Authorization,
            Some("1064") => crate::ErrorCategory::Syntax,
            Some("1062" | "1216" | "1217" | "1451" | "1452") => crate::ErrorCategory::Constraint,
            Some("1205") => crate::ErrorCategory::Timeout,
            Some("1213") => crate::ErrorCategory::Transaction,
            Some("1317") => crate::ErrorCategory::Cancelled,
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

    const ENCRYPTED_TEST_KEY: &str = "-----BEGIN ENCRYPTED PRIVATE KEY-----\n\
MIGbMFcGCSqGSIb3DQEFDTBKMCkGCSqGSIb3DQEFDDAcBAh52YLnDfkaiAICCAAw\n\
DAYIKoZIhvcNAgkFADAdBglghkgBZQMEASoEELLQLXiy79nf9pTPjgr0CSUEQNDN\n\
bHcPS7hxdkIjBcF0AYCeImZ0znQYXSIb/aqVBpiQyIgvzgKwXUG8v1SwNVlbzUFU\n\
syWTcIRpuGqs+IFaeys=\n\
-----END ENCRYPTED PRIVATE KEY-----\n";

    #[test]
    fn encrypted_pkcs8_client_key_is_decrypted_only_with_the_supplied_passphrase() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("client-key.pem");
        std::fs::write(&path, ENCRYPTED_TEST_KEY).unwrap();

        let decrypted = decrypt_client_key_pem(&path, "hunter42").unwrap();
        assert!(decrypted.starts_with("-----BEGIN PRIVATE KEY-----"));

        let error = decrypt_client_key_pem(&path, "incorrect").unwrap_err();
        assert_eq!(error.category, crate::ErrorCategory::Authorization);
        assert!(!error.safe_message.contains("hunter42"));
        assert!(!error.safe_message.contains("incorrect"));
    }

    #[test]
    fn mysql57_line_and_exact_matrix_classification_are_fail_closed() {
        for (product, version, expected) in [
            (
                "MySQL",
                "5.7.0",
                (CompatibilityStatus::Supported, true, false),
            ),
            (
                "MySQL",
                "5.7.39",
                (CompatibilityStatus::Supported, true, false),
            ),
            (
                "MySQL",
                "5.7.44",
                (CompatibilityStatus::Supported, true, true),
            ),
            (
                "MySQL",
                "8.0.46",
                (CompatibilityStatus::Supported, true, true),
            ),
            (
                "MySQL",
                "8.4.10",
                (CompatibilityStatus::Supported, false, true),
            ),
            (
                "MariaDB",
                "10.11.18",
                (CompatibilityStatus::Supported, false, true),
            ),
            (
                "MariaDB",
                "11.4.12",
                (CompatibilityStatus::Supported, false, true),
            ),
            (
                "MySQL",
                "5.7",
                (CompatibilityStatus::QueryOnly, false, false),
            ),
            (
                "MySQL",
                "5.7.44.1",
                (CompatibilityStatus::QueryOnly, false, false),
            ),
            (
                "MySQL",
                "8.4.11",
                (CompatibilityStatus::QueryOnly, false, false),
            ),
        ] {
            assert_eq!(classify_compatibility(product, version), expected);
        }
    }

    #[test]
    fn mysql57_transaction_fallback_tracks_manual_work_and_implicit_commits() {
        let transaction = StdMutex::new(TransactionCertainty::Clean);
        reconcile_mysql57_statement_effect(&transaction, "INSERT INTO t VALUES (1)", false);
        assert_eq!(
            transaction_certainty(&transaction),
            TransactionCertainty::Active
        );
        reconcile_mysql57_statement_effect(
            &transaction,
            "/* deliberate */ CREATE TABLE t2(x INT)",
            false,
        );
        assert_eq!(
            transaction_certainty(&transaction),
            TransactionCertainty::Clean
        );
        reconcile_mysql57_statement_effect(&transaction, "START TRANSACTION", true);
        assert_eq!(
            transaction_certainty(&transaction),
            TransactionCertainty::Active
        );
        reconcile_mysql57_statement_effect(&transaction, "ROLLBACK", true);
        assert_eq!(
            transaction_certainty(&transaction),
            TransactionCertainty::Clean
        );
    }
}
