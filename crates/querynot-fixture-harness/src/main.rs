#![forbid(unsafe_code)]

use std::{collections::HashSet, env, path::PathBuf, process::ExitCode, time::Duration};

use futures_util::TryStreamExt;
use querynot_core::profile::{ConnectionProfile, ConnectionTarget, TlsMode};
use querynot_core::sql::{SqlDialect, plan_execution_for_dialect};
use querynot_core::sqlite::{ExecutionControl, SqliteExecutionEvent, TransactionCertainty};
use querynot_core::table::{
    BrowseInput, FilterOperator, MutationCell, MutationCellMode, MutationInput, MutationKind,
    SortDirection, TableDialect, TableFilter, TableSort, plan_browse, plan_mutations,
};
use querynot_core::vault::ConnectionSecrets;
use querynot_core::{
    AdapterSession, CompatibilityStatus, DatabaseFamily, ExecutionId, ExplainRunOutcome,
    FixtureManifest, FixtureTarget, TaggedValue,
};
use secrecy::ExposeSecret;
use serde::Serialize;
use sqlx::{Connection, MySqlConnection, Row, mysql::MySqlConnectOptions};
use tokio::sync::mpsc;

#[derive(Debug, Serialize)]
struct TargetReport {
    id: String,
    exact_version: String,
    detected_product: String,
    authentication_plugin: String,
    marker_verified: bool,
    streaming_rows: usize,
    typed_values: bool,
    cancellation_cleanup: bool,
    transaction_rollback: bool,
    tls_version: Option<String>,
    tls_identity_verified: bool,
    adapter: AdapterConformanceReport,
}

#[derive(Debug, Serialize)]
struct AdapterConformanceReport {
    exact_identity: bool,
    supported_capability_profile: bool,
    metadata_tables_views_routines: bool,
    streaming_rows: usize,
    typed_values: bool,
    zero_row_column_metadata: bool,
    duplicate_column_names: bool,
    multiple_result_sets: usize,
    transaction_reconciliation: bool,
    implicit_ddl_commit_reconciled: bool,
    cancellation_confirmed: bool,
    session_usable_after_cancel: bool,
    estimated_explain_scan_and_index: bool,
    estimated_explain_non_mutating: bool,
    system_trust_rejected_private_ca: bool,
    client_certificate_required_and_verified: Option<bool>,
    table_editing: TableConformanceReport,
}

#[derive(Debug, Serialize)]
struct TableConformanceReport {
    deterministic_keyset_paging: bool,
    bound_structured_filters: bool,
    typed_validation: bool,
    insert_update_delete: bool,
    generated_value_refresh: bool,
    optimistic_conflict_atomic_rollback: bool,
}

#[derive(Debug, Serialize)]
struct FeasibilityReport {
    schema_version: u8,
    results: Vec<TargetReport>,
}

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(report) => {
            println!(
                "{}",
                serde_json::to_string_pretty(&report).expect("report serialization cannot fail")
            );
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("feasibility harness failed: {message}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<FeasibilityReport, String> {
    let manifest_path = parse_manifest_path()?;
    let manifest =
        FixtureManifest::from_explicit_path(&manifest_path).map_err(|error| error.safe_message)?;
    let mut results = Vec::with_capacity(manifest.targets.len());

    for target in &manifest.targets {
        match target.family {
            DatabaseFamily::MySqlFamily => {
                results
                    .push(check_mysql_target(target, manifest.marker_token.expose_secret()).await?);
            }
            DatabaseFamily::Sqlite => {
                return Err(
                    "network feasibility manifests cannot include SQLite targets".to_owned(),
                );
            }
            DatabaseFamily::Postgres => {
                return Err(
                    "PostgreSQL targets require the dedicated disposable conformance manifest; the five-server MySQL-family release harness cannot claim PostgreSQL evidence"
                        .to_owned(),
                );
            }
        }
    }

    Ok(FeasibilityReport {
        schema_version: 1,
        results,
    })
}

fn parse_manifest_path() -> Result<PathBuf, String> {
    let mut arguments = env::args_os().skip(1);
    if arguments.next().as_deref() != Some("--manifest".as_ref()) {
        return Err("usage: querynot-fixture-harness --manifest /absolute/path.json".to_owned());
    }
    let path = arguments
        .next()
        .map(PathBuf::from)
        .ok_or_else(|| "fixture manifest path is required".to_owned())?;
    if arguments.next().is_some() {
        return Err("unexpected arguments; fixture discovery is forbidden".to_owned());
    }
    Ok(path)
}

async fn check_mysql_target(target: &FixtureTarget, marker: &str) -> Result<TargetReport, String> {
    let tls_identity_verified = validate_tls_configuration(target)?;
    let options: MySqlConnectOptions = target
        .connection_url
        .expose_secret()
        .parse()
        .map_err(|_| format!("{} has an invalid generated URL", target.id))?;
    let mut connection = MySqlConnection::connect_with(&options)
        .await
        .map_err(|error| format!("{} connection failed: {}", target.id, safe_sqlx(&error)))?;

    let version: String = sqlx::query_scalar("SELECT VERSION()")
        .fetch_one(&mut connection)
        .await
        .map_err(|error| format!("{} identity failed: {}", target.id, safe_sqlx(&error)))?;
    if !version.starts_with(&target.expected_version_prefix) {
        return Err(format!("{} returned an unexpected version", target.id));
    }
    let detected_product = if version.to_ascii_lowercase().contains("mariadb") {
        "mariadb"
    } else {
        "mysql"
    };
    if detected_product != target.expected_product {
        return Err(format!(
            "{} returned an unexpected product identity",
            target.id
        ));
    }

    let observed_marker: String = sqlx::query_scalar(
        "SELECT marker_token FROM querynot_fixture.__querynot_fixture_marker LIMIT 1",
    )
    .fetch_one(&mut connection)
    .await
    .map_err(|_| format!("{} does not present the required fixture marker", target.id))?;
    if observed_marker != marker {
        return Err(format!("{} fixture marker mismatch", target.id));
    }

    let mut stream = sqlx::query(
        "SELECT sequence_number FROM querynot_fixture.stream_fixture ORDER BY sequence_number",
    )
    .fetch(&mut connection);
    let mut streaming_rows = 0;
    while let Some(_row) = stream
        .try_next()
        .await
        .map_err(|error| format!("{} streaming failed: {}", target.id, safe_sqlx(&error)))?
    {
        streaming_rows += 1;
    }
    drop(stream);
    if streaming_rows != 1_024 {
        return Err(format!("{} streamed an unexpected row count", target.id));
    }

    let typed = sqlx::query(
        "SELECT signed_value, unsigned_value, CAST(decimal_value AS CHAR) AS decimal_value, binary_value, text_value, null_value FROM querynot_fixture.typed_fixture LIMIT 1",
    )
    .fetch_one(&mut connection)
    .await
    .map_err(|error| format!("{} typed-value query failed: {}", target.id, safe_sqlx(&error)))?;
    let signed_value: i64 = typed
        .try_get("signed_value")
        .map_err(|_| "signed decode failed")?;
    let unsigned_value: u64 = typed
        .try_get("unsigned_value")
        .map_err(|_| "unsigned decode failed")?;
    let decimal_value: String = typed
        .try_get("decimal_value")
        .map_err(|_| "decimal decode failed")?;
    let binary_value: Vec<u8> = typed
        .try_get("binary_value")
        .map_err(|_| "binary decode failed")?;
    let text_value: String = typed
        .try_get("text_value")
        .map_err(|_| "text decode failed")?;
    let null_value: Option<String> = typed
        .try_get("null_value")
        .map_err(|_| "null decode failed")?;
    let typed_values = signed_value == -9_223_372_036_854_775_000
        && unsigned_value == 18_446_744_073_709_551_000
        && decimal_value == "12345678901234567890.1234567890"
        && binary_value == vec![0, 255, 16, 128]
        && text_value == "QueryNot Ω"
        && null_value.is_none();

    let mut transaction = connection.begin().await.map_err(|error| {
        format!(
            "{} transaction start failed: {}",
            target.id,
            safe_sqlx(&error)
        )
    })?;
    sqlx::query(
        "INSERT INTO querynot_fixture.transaction_fixture (value_text) VALUES ('must roll back')",
    )
    .execute(&mut *transaction)
    .await
    .map_err(|error| {
        format!(
            "{} transaction write failed: {}",
            target.id,
            safe_sqlx(&error)
        )
    })?;
    transaction
        .rollback()
        .await
        .map_err(|error| format!("{} rollback failed: {}", target.id, safe_sqlx(&error)))?;
    let transaction_rows: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM querynot_fixture.transaction_fixture WHERE value_text = 'must roll back'",
    )
    .fetch_one(&mut connection)
    .await
    .map_err(|error| format!("{} rollback verification failed: {}", target.id, safe_sqlx(&error)))?;

    let sleep_result = tokio::time::timeout(
        Duration::from_millis(250),
        sqlx::query("SELECT SLEEP(10)").execute(&mut connection),
    )
    .await;
    let cancellation_requested = sleep_result.is_err();
    connection.close().await.map_err(|error| {
        format!(
            "{} cancellation cleanup failed: {}",
            target.id,
            safe_sqlx(&error)
        )
    })?;
    let mut replacement = MySqlConnection::connect_with(&options)
        .await
        .map_err(|error| {
            format!(
                "{} replacement connection failed: {}",
                target.id,
                safe_sqlx(&error)
            )
        })?;
    let replacement_ok: i32 = sqlx::query_scalar("SELECT 1")
        .fetch_one(&mut replacement)
        .await
        .map_err(|error| {
            format!(
                "{} replacement connection unusable: {}",
                target.id,
                safe_sqlx(&error)
            )
        })?;
    let tls_status: Option<(String, String)> = sqlx::query_as("SHOW STATUS LIKE 'Ssl_version'")
        .fetch_optional(&mut replacement)
        .await
        .ok()
        .flatten();
    let tls_version = tls_status
        .map(|(_, value)| value)
        .filter(|value| !value.is_empty());
    replacement
        .close()
        .await
        .map_err(|error| format!("{} final cleanup failed: {}", target.id, safe_sqlx(&error)))?;

    let adapter = check_querynot_adapter(target).await?;

    if let Some(required) = &target.require_tls_version
        && tls_version.as_deref() != Some(required.as_str())
    {
        return Err(format!(
            "{} did not negotiate the required TLS version",
            target.id
        ));
    }

    Ok(TargetReport {
        id: target.id.clone(),
        exact_version: version,
        detected_product: detected_product.to_owned(),
        authentication_plugin: target.expected_authentication_plugin.clone(),
        marker_verified: true,
        streaming_rows,
        typed_values,
        cancellation_cleanup: cancellation_requested && replacement_ok == 1,
        transaction_rollback: transaction_rows == 0,
        tls_version,
        tls_identity_verified,
        adapter,
    })
}

async fn check_querynot_adapter(
    target: &FixtureTarget,
) -> Result<AdapterConformanceReport, String> {
    let parsed = url::Url::parse(target.connection_url.expose_secret())
        .map_err(|_| format!("{} adapter URL is invalid", target.id))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| format!("{} adapter host is absent", target.id))?;
    let database = parsed.path().trim_start_matches('/');
    let tls_ca_path = parsed
        .query_pairs()
        .find_map(|(key, value)| (key == "ssl-ca").then(|| value.into_owned()))
        .ok_or_else(|| format!("{} adapter CA is absent", target.id))?;
    let profile = ConnectionProfile::new(
        format!("fixture-{}", target.id),
        ConnectionTarget::MysqlFamily {
            host: host.to_owned(),
            port: parsed
                .port()
                .ok_or_else(|| format!("{} adapter port is absent", target.id))?,
            default_database: (!database.is_empty()).then(|| database.to_owned()),
            username: parsed.username().to_owned(),
            tls_mode: TlsMode::CustomCa,
            tls_ca_path: Some(tls_ca_path.clone()),
            tls_client_certificate_path: None,
            tls_client_key_path: None,
        },
        15,
        0,
    )
    .map_err(|_| format!("{} adapter profile is invalid", target.id))?;
    let password = ConnectionSecrets::new(
        parsed
            .password()
            .ok_or_else(|| format!("{} adapter password is absent", target.id))?
            .to_owned(),
        String::new(),
    );
    let system_trust_profile = ConnectionProfile::new(
        format!("system-trust-fixture-{}", target.id),
        ConnectionTarget::MysqlFamily {
            host: host.to_owned(),
            port: parsed
                .port()
                .ok_or_else(|| format!("{} adapter port is absent", target.id))?,
            default_database: (!database.is_empty()).then(|| database.to_owned()),
            username: parsed.username().to_owned(),
            tls_mode: TlsMode::VerifyIdentity,
            tls_ca_path: None,
            tls_client_certificate_path: None,
            tls_client_key_path: None,
        },
        15,
        0,
    )
    .map_err(|_| format!("{} system-trust profile is invalid", target.id))?;
    let system_trust_rejected_private_ca =
        AdapterSession::test_connection(&system_trust_profile, &password)
            .await
            .is_err();

    let client_certificate_required_and_verified = match (
        target.client_certificate_username.as_deref(),
        target.client_certificate_path.as_deref(),
        target.client_key_path.as_deref(),
    ) {
        (Some(client_username), Some(client_certificate), Some(client_key)) => {
            let without_identity = ConnectionProfile::new(
                format!("client-negative-fixture-{}", target.id),
                ConnectionTarget::MysqlFamily {
                    host: host.to_owned(),
                    port: parsed
                        .port()
                        .ok_or_else(|| format!("{} adapter port is absent", target.id))?,
                    default_database: (!database.is_empty()).then(|| database.to_owned()),
                    username: client_username.to_owned(),
                    tls_mode: TlsMode::CustomCa,
                    tls_ca_path: Some(tls_ca_path.clone()),
                    tls_client_certificate_path: None,
                    tls_client_key_path: None,
                },
                15,
                0,
            )
            .map_err(|_| format!("{} client negative profile is invalid", target.id))?;
            let client_identity_required =
                AdapterSession::test_connection(&without_identity, &password)
                    .await
                    .is_err();
            let with_identity = ConnectionProfile::new(
                format!("client-fixture-{}", target.id),
                ConnectionTarget::MysqlFamily {
                    host: host.to_owned(),
                    port: parsed
                        .port()
                        .ok_or_else(|| format!("{} adapter port is absent", target.id))?,
                    default_database: (!database.is_empty()).then(|| database.to_owned()),
                    username: client_username.to_owned(),
                    tls_mode: TlsMode::CustomCa,
                    tls_ca_path: Some(tls_ca_path.clone()),
                    tls_client_certificate_path: Some(client_certificate.to_owned()),
                    tls_client_key_path: Some(client_key.to_owned()),
                },
                15,
                0,
            )
            .map_err(|_| format!("{} client-certificate profile is invalid", target.id))?;
            Some(
                client_identity_required
                    && AdapterSession::test_connection(&with_identity, &password)
                        .await
                        .is_ok(),
            )
        }
        (None, None, None) => None,
        _ => {
            return Err(format!(
                "{} has an incomplete client identity fixture",
                target.id
            ));
        }
    };
    let session = AdapterSession::open(&profile, &password)
        .await
        .map_err(|error| format!("{} adapter open failed: {}", target.id, error.safe_message))?;
    let info = session.connection_info(&profile).await.map_err(|error| {
        format!(
            "{} adapter identity failed: {}",
            target.id, error.safe_message
        )
    })?;
    let exact_identity = info
        .identity
        .product
        .eq_ignore_ascii_case(&target.expected_product)
        && info
            .identity
            .exact_version
            .starts_with(&target.expected_version_prefix)
        && info.dialect == "mysql";
    let supported_capability_profile = info.compatibility_status == CompatibilityStatus::Supported
        && info.capabilities.metadata
        && info.capabilities.streaming
        && info.capabilities.cancellation
        && info.capabilities.explain
        && info.capabilities.transactions
        && info.capabilities.multiple_results
        && !info.read_only;

    let namespaces = session.namespaces().await.map_err(|error| {
        format!(
            "{} adapter namespaces failed: {}",
            target.id, error.safe_message
        )
    })?;
    let objects = session.objects("querynot_fixture").await.map_err(|error| {
        format!(
            "{} adapter objects failed: {}",
            target.id, error.safe_message
        )
    })?;
    let detail = session
        .object_detail("querynot_fixture", "typed_fixture")
        .await
        .map_err(|error| {
            format!(
                "{} adapter detail failed: {} {}",
                target.id,
                error.safe_message,
                error.safe_detail.unwrap_or_default()
            )
        })?;
    let metadata_tables_views_routines = namespaces
        .iter()
        .any(|namespace| namespace.name == "querynot_fixture")
        && objects.iter().any(|object| object.name == "typed_fixture")
        && objects.iter().any(|object| object.name == "fixture_view")
        && objects
            .iter()
            .any(|object| object.name == "fixture_multi_results")
        && detail
            .columns
            .iter()
            .any(|column| column.name == "decimal_value")
        && detail.routines_supported;

    let stream = run_adapter_execution(
        &session,
        "SELECT sequence_number FROM querynot_fixture.stream_fixture ORDER BY sequence_number",
        256,
    )
    .await
    .map_err(|error| format!("{} adapter streaming: {error}", target.id))?;
    let typed = run_adapter_execution(
        &session,
        "SELECT signed_value, unsigned_value, decimal_value, binary_value, text_value, null_value, \
         float_value, boolean_value, date_value, datetime_value, time_value, empty_text, large_text \
         FROM querynot_fixture.typed_fixture",
        100,
    )
    .await
    .map_err(|error| format!("{} adapter typed values: {error}", target.id))?;
    let typed_values = typed.rows.iter().any(|row| {
        matches!(row.first(), Some(TaggedValue::SignedInteger(value)) if value == "-9223372036854775000")
            && matches!(row.get(1), Some(TaggedValue::UnsignedInteger(value)) if value == "18446744073709551000")
            && matches!(row.get(2), Some(TaggedValue::Decimal(value)) if value == "12345678901234567890.1234567890")
            && matches!(row.get(3), Some(TaggedValue::Bytes(value)) if value == &[0, 255, 16, 128])
            && matches!(row.get(4), Some(TaggedValue::Text(value)) if value == "QueryNot Ω")
            && matches!(row.get(5), Some(TaggedValue::Null))
            && matches!(row.get(6), Some(TaggedValue::Float(value)) if (*value - 1.25E100).abs() < 1.0E86)
            && matches!(row.get(7), Some(TaggedValue::Boolean(true)))
            && matches!(row.get(8), Some(TaggedValue::DateTime { raw, timezone_or_offset: None }) if raw == "2024-02-29")
            && matches!(row.get(9), Some(TaggedValue::DateTime { raw, timezone_or_offset: None }) if raw == "2024-02-29 23:59:58.123456")
            && matches!(row.get(10), Some(TaggedValue::DateTime { raw, timezone_or_offset: None }) if raw == "12:34:56.654321")
            && matches!(row.get(11), Some(TaggedValue::Text(value)) if value.is_empty())
            && matches!(row.get(12), Some(TaggedValue::Text(value)) if value.chars().count() == 65_536)
    });
    let zero_rows = run_adapter_execution(
        &session,
        "SELECT sequence_number FROM querynot_fixture.stream_fixture WHERE 1 = 0",
        100,
    )
    .await
    .map_err(|error| format!("{} adapter zero-row result: {error}", target.id))?;
    let zero_row_column_metadata = zero_rows.rows.is_empty()
        && zero_rows
            .column_sets
            .iter()
            .any(|columns| columns == &["sequence_number"]);
    let duplicate = run_adapter_execution(
        &session,
        "SELECT 1 AS duplicate_name, 2 AS duplicate_name",
        100,
    )
    .await
    .map_err(|error| format!("{} adapter duplicate columns: {error}", target.id))?;
    let duplicate_column_names = duplicate
        .column_sets
        .iter()
        .any(|columns| columns == &["duplicate_name", "duplicate_name"]);
    let multiple = run_adapter_execution(
        &session,
        "CALL querynot_fixture.fixture_multi_results()",
        100,
    )
    .await
    .map_err(|error| format!("{} adapter multiple results: {error}", target.id))?;

    let manual = session
        .set_automatic(false)
        .await
        .map_err(|error| format!("{} manual mode failed: {}", target.id, error.safe_message))?;
    let insert = run_adapter_execution(
        &session,
        "INSERT INTO querynot_fixture.transaction_fixture(value_text) VALUES ('adapter rollback')",
        100,
    )
    .await
    .map_err(|error| format!("{} adapter manual transaction: {error}", target.id))?;
    let rolled_back = session.rollback().await.map_err(|error| {
        format!(
            "{} adapter rollback failed: {}",
            target.id, error.safe_message
        )
    })?;
    let transaction_reconciliation = !manual.automatic
        && manual.certainty == TransactionCertainty::Clean
        && insert.transaction_certainty == TransactionCertainty::Active
        && rolled_back.certainty == TransactionCertainty::Clean;

    let ddl = run_adapter_execution(
        &session,
        "CREATE TABLE querynot_fixture.adapter_implicit_commit(id INTEGER)",
        100,
    )
    .await
    .map_err(|error| format!("{} adapter implicit DDL: {error}", target.id))?;
    let implicit_ddl_commit_reconciled = ddl.transaction_certainty == TransactionCertainty::Clean;
    let _ = run_adapter_execution(
        &session,
        "DROP TABLE querynot_fixture.adapter_implicit_commit",
        100,
    )
    .await
    .map_err(|error| format!("{} adapter DDL cleanup: {error}", target.id))?;
    session.set_automatic(true).await.map_err(|error| {
        format!(
            "{} auto mode restore failed: {}",
            target.id, error.safe_message
        )
    })?;

    let scan_plan = session
        .explain(
            "SELECT text_value FROM querynot_fixture.typed_fixture WHERE text_value = 'explain scan missing'",
            &info.identity.product,
        )
        .await;
    let index_plan = session
        .explain(
            "SELECT sequence_number FROM querynot_fixture.stream_fixture WHERE sequence_number = 512",
            &info.identity.product,
        )
        .await;
    let estimated_explain_scan_and_index = match (scan_plan, index_plan) {
        (ExplainRunOutcome::Completed(scan), ExplainRunOutcome::Completed(indexed)) => {
            let scan_fact = scan.nodes.iter().any(|node| {
                node.operation
                    .as_deref()
                    .is_some_and(|operation| operation.to_ascii_lowercase().contains("scan"))
                    || node.access_type.as_deref().is_some_and(|access| {
                        matches!(access.to_ascii_uppercase().as_str(), "ALL" | "INDEX")
                    })
            });
            let index_fact = indexed.nodes.iter().any(|node| {
                node.index.is_some()
                    || node.access_type.as_deref().is_some_and(|access| {
                        matches!(
                            access.to_ascii_uppercase().as_str(),
                            "CONST" | "EQ_REF" | "REF" | "RANGE" | "SYSTEM"
                        )
                    })
            });
            scan.normalization_status == "normalized"
                && indexed.normalization_status == "normalized"
                && scan_fact
                && index_fact
        }
        _ => false,
    };

    let transaction_before_explain = session.transaction_state().await;
    let estimated_explain_non_mutating = match session
        .explain(
            "INSERT INTO querynot_fixture.transaction_fixture(value_text) VALUES ('explain must not execute')",
            &info.identity.product,
        )
        .await
    {
        ExplainRunOutcome::Completed(plan) => {
            let count = run_adapter_execution(
                &session,
                "SELECT COUNT(*) FROM querynot_fixture.transaction_fixture WHERE value_text = 'explain must not execute'",
                10,
            )
            .await
            .map_err(|error| format!("{} adapter explain verification: {error}", target.id))?;
            let unchanged = count.rows.first().and_then(|row| row.first()).is_some_and(
                |value| matches!(value, TaggedValue::SignedInteger(value) | TaggedValue::UnsignedInteger(value) if value == "0"),
            );
            !plan.raw_payload.is_empty()
                && (plan.normalization_status == "normalized"
                    || plan.normalization_status == "raw_only")
                && transaction_before_explain == session.transaction_state().await
                && unchanged
        }
        ExplainRunOutcome::Cancelled { .. } | ExplainRunOutcome::Failed(_) => false,
    };

    let table_editing = check_table_editing(&session)
        .await
        .map_err(|error| format!("{} adapter table editing: {error}", target.id))?;

    let cancellation_confirmed = run_adapter_cancellation(&session)
        .await
        .map_err(|error| format!("{} adapter cancellation: {error}", target.id))?;
    let usable = run_adapter_execution(&session, "SELECT 1", 100)
        .await
        .map_err(|error| format!("{} adapter post-cancel query: {error}", target.id))?;

    let report = AdapterConformanceReport {
        exact_identity,
        supported_capability_profile,
        metadata_tables_views_routines,
        streaming_rows: stream.rows.len(),
        typed_values,
        zero_row_column_metadata,
        duplicate_column_names,
        multiple_result_sets: multiple.result_sets,
        transaction_reconciliation,
        implicit_ddl_commit_reconciled,
        cancellation_confirmed,
        session_usable_after_cancel: usable.finished,
        estimated_explain_scan_and_index,
        estimated_explain_non_mutating,
        system_trust_rejected_private_ca,
        client_certificate_required_and_verified,
        table_editing,
    };
    if !report.exact_identity
        || !report.supported_capability_profile
        || !report.metadata_tables_views_routines
        || report.streaming_rows != 1_024
        || !report.typed_values
        || !report.zero_row_column_metadata
        || !report.duplicate_column_names
        || report.multiple_result_sets < 2
        || !report.transaction_reconciliation
        || !report.implicit_ddl_commit_reconciled
        || !report.cancellation_confirmed
        || !report.session_usable_after_cancel
        || !report.estimated_explain_scan_and_index
        || !report.estimated_explain_non_mutating
        || !report.system_trust_rejected_private_ca
        || report.client_certificate_required_and_verified == Some(false)
        || !report.table_editing.deterministic_keyset_paging
        || !report.table_editing.bound_structured_filters
        || !report.table_editing.typed_validation
        || !report.table_editing.insert_update_delete
        || !report.table_editing.generated_value_refresh
        || !report.table_editing.optimistic_conflict_atomic_rollback
    {
        return Err(format!(
            "{} failed one or more QueryNot adapter conformance assertions",
            target.id
        ));
    }
    Ok(report)
}

async fn check_table_editing(session: &AdapterSession) -> Result<TableConformanceReport, String> {
    let namespace = "querynot_fixture";
    let table = "table_edit_fixture";
    let input = BrowseInput {
        filters: Vec::new(),
        sorts: vec![TableSort {
            column: "name".to_owned(),
            direction: SortDirection::Ascending,
        }],
        cursor: Vec::new(),
        offset: 0,
        page_size: 25,
    };
    session
        .object_detail(namespace, table)
        .await
        .map_err(|error| {
            format!(
                "initial table detail: {} {}",
                error.safe_message,
                error.safe_detail.unwrap_or_default()
            )
        })?;
    let initial = session
        .browse_table(namespace, table, &input)
        .await
        .map_err(|error| {
            format!(
                "initial browse: {} {}",
                error.safe_message,
                error.safe_detail.unwrap_or_default()
            )
        })?;
    let definition = initial.definition.clone();
    let deterministic_keyset_paging = !initial.unstable
        && definition.editable
        && definition
            .identity
            .as_ref()
            .is_some_and(|identity| identity.columns == ["id"]);

    let hostile_filter = TableFilter {
        column: "name".to_owned(),
        operator: FilterOperator::Contains,
        value: Some(TaggedValue::Text("x%' OR 1=1 --".to_owned())),
    };
    let hostile_input = BrowseInput {
        filters: vec![hostile_filter],
        ..input.clone()
    };
    let bound_plan = plan_browse(&definition, TableDialect::MySql, &hostile_input)
        .map_err(|error| format!("hostile filter planning: {}", error.safe_message))?;
    let filtered = session
        .browse_table(namespace, table, &hostile_input)
        .await
        .map_err(|error| format!("hostile filter browse: {}", error.safe_message))?;
    let bound_structured_filters = !bound_plan.sql.contains("OR 1=1")
        && matches!(bound_plan.parameters.first(), Some(TaggedValue::Text(_)))
        && filtered.rows.is_empty();

    let original = initial
        .rows
        .first()
        .cloned()
        .ok_or_else(|| "table-edit fixture has no initial row".to_owned())?;
    let typed_validation = plan_mutations(
        &definition,
        TableDialect::MySql,
        1,
        &[MutationInput {
            kind: MutationKind::Update,
            original,
            cells: vec![MutationCell {
                column: "name".to_owned(),
                mode: MutationCellMode::Value(TaggedValue::SignedInteger("7".to_owned())),
            }],
        }],
    )
    .is_err();

    let insert = plan_mutations(
        &definition,
        TableDialect::MySql,
        2,
        &[MutationInput {
            kind: MutationKind::Insert,
            original: Vec::new(),
            cells: vec![
                MutationCell {
                    column: "id".to_owned(),
                    mode: MutationCellMode::DatabaseDefault,
                },
                MutationCell {
                    column: "name".to_owned(),
                    mode: MutationCellMode::Value(TaggedValue::Text("phase4-insert".to_owned())),
                },
                MutationCell {
                    column: "note".to_owned(),
                    mode: MutationCellMode::Value(TaggedValue::Null),
                },
                MutationCell {
                    column: "defaulted".to_owned(),
                    mode: MutationCellMode::DatabaseDefault,
                },
            ],
        }],
    )
    .map_err(|error| format!("insert planning: {}", error.safe_message))?;
    session
        .apply_table_mutations(&insert)
        .await
        .map_err(|error| format!("insert apply: {}", error.safe_message))?;

    let inserted_input = BrowseInput {
        filters: vec![TableFilter {
            column: "name".to_owned(),
            operator: FilterOperator::Equal,
            value: Some(TaggedValue::Text("phase4-insert".to_owned())),
        }],
        sorts: Vec::new(),
        cursor: Vec::new(),
        offset: 0,
        page_size: 25,
    };
    let inserted_page = session
        .browse_table(namespace, table, &inserted_input)
        .await
        .map_err(|error| format!("insert refresh browse: {}", error.safe_message))?;
    let inserted = inserted_page
        .rows
        .first()
        .cloned()
        .ok_or_else(|| "inserted table-edit row was not refreshed".to_owned())?;
    let column_index = |name: &str| {
        definition
            .columns
            .iter()
            .position(|column| column.name == name)
            .ok_or_else(|| format!("table-edit column {name} is absent"))
    };
    let id_index = column_index("id")?;
    let note_index = column_index("note")?;
    let default_index = column_index("defaulted")?;
    let generated_value_refresh = matches!(
        inserted.get(id_index),
        Some(TaggedValue::UnsignedInteger(_))
    ) && matches!(
        inserted.get(default_index),
        Some(TaggedValue::Text(value)) if value == "server-default"
    );

    let update = plan_mutations(
        &definition,
        TableDialect::MySql,
        3,
        &[MutationInput {
            kind: MutationKind::Update,
            original: inserted,
            cells: vec![MutationCell {
                column: "note".to_owned(),
                mode: MutationCellMode::Value(TaggedValue::Text("updated".to_owned())),
            }],
        }],
    )
    .map_err(|error| format!("update planning: {}", error.safe_message))?;
    session
        .apply_table_mutations(&update)
        .await
        .map_err(|error| format!("update apply: {}", error.safe_message))?;
    let updated_page = session
        .browse_table(namespace, table, &inserted_input)
        .await
        .map_err(|error| format!("update refresh browse: {}", error.safe_message))?;
    let updated = updated_page
        .rows
        .first()
        .cloned()
        .ok_or_else(|| "updated table-edit row disappeared".to_owned())?;
    let update_visible = matches!(
        updated.get(note_index),
        Some(TaggedValue::Text(value)) if value == "updated"
    );

    let conflict = plan_mutations(
        &definition,
        TableDialect::MySql,
        4,
        &[
            MutationInput {
                kind: MutationKind::Update,
                original: updated.clone(),
                cells: vec![MutationCell {
                    column: "note".to_owned(),
                    mode: MutationCellMode::Value(TaggedValue::Text("must-roll-back".to_owned())),
                }],
            },
            MutationInput {
                kind: MutationKind::Update,
                original: updated.clone(),
                cells: vec![MutationCell {
                    column: "note".to_owned(),
                    mode: MutationCellMode::Value(TaggedValue::Text("must-conflict".to_owned())),
                }],
            },
        ],
    )
    .map_err(|error| format!("conflict planning: {}", error.safe_message))?;
    let conflict_detected = session.apply_table_mutations(&conflict).await.is_err();
    let after_conflict = session
        .browse_table(namespace, table, &inserted_input)
        .await
        .map_err(|error| format!("conflict refresh browse: {}", error.safe_message))?;
    let rollback_preserved = matches!(
        after_conflict.rows.first().and_then(|row| row.get(note_index)),
        Some(TaggedValue::Text(value)) if value == "updated"
    );

    let current = after_conflict
        .rows
        .first()
        .cloned()
        .ok_or_else(|| "table-edit row disappeared after conflict".to_owned())?;
    let delete = plan_mutations(
        &definition,
        TableDialect::MySql,
        5,
        &[MutationInput {
            kind: MutationKind::Delete,
            original: current,
            cells: Vec::new(),
        }],
    )
    .map_err(|error| format!("delete planning: {}", error.safe_message))?;
    session
        .apply_table_mutations(&delete)
        .await
        .map_err(|error| format!("delete apply: {}", error.safe_message))?;
    let deleted = session
        .browse_table(namespace, table, &inserted_input)
        .await
        .map_err(|error| format!("delete refresh browse: {}", error.safe_message))?
        .rows
        .is_empty();

    Ok(TableConformanceReport {
        deterministic_keyset_paging,
        bound_structured_filters,
        typed_validation,
        insert_update_delete: update_visible && deleted,
        generated_value_refresh,
        optimistic_conflict_atomic_rollback: conflict_detected && rollback_preserved,
    })
}

struct AdapterExecutionReport {
    rows: Vec<Vec<TaggedValue>>,
    column_sets: Vec<Vec<String>>,
    result_sets: usize,
    transaction_certainty: TransactionCertainty,
    finished: bool,
}

async fn run_adapter_execution(
    session: &AdapterSession,
    sql: &str,
    tranche_rows: usize,
) -> Result<AdapterExecutionReport, String> {
    let execution_id = ExecutionId::new();
    let plan = plan_execution_for_dialect(
        sql,
        None,
        0,
        true,
        SqlDialect::MySql,
        "fixture-profile",
        "fixture-session",
        "querynot_fixture",
    )
    .map_err(|error| format!("adapter plan failed: {error}"))?;
    let (control_tx, control_rx) = mpsc::channel(32);
    let (event_tx, mut event_rx) = mpsc::channel(32);
    let running = session.clone();
    let task = tokio::spawn(async move {
        running
            .execute(execution_id, plan, tranche_rows, control_rx, event_tx)
            .await;
    });
    let mut rows = Vec::new();
    let mut column_sets = Vec::new();
    let mut result_sets = HashSet::new();
    let mut certainty = TransactionCertainty::Clean;
    let mut finished = false;
    while let Some(event) = event_rx.recv().await {
        match event {
            SqliteExecutionEvent::Batch(batch) => {
                result_sets.insert(batch.result_set_id);
                if let Some(columns) = &batch.columns {
                    column_sets.push(columns.iter().map(|column| column.name.clone()).collect());
                }
                rows.extend(batch.rows);
                control_tx
                    .send(ExecutionControl::Acknowledge {
                        result_set_id: batch.result_set_id,
                        sequence: batch.sequence,
                    })
                    .await
                    .map_err(|_| "adapter acknowledgement channel closed".to_owned())?;
            }
            SqliteExecutionEvent::Paused { result_set_id, .. } => {
                control_tx
                    .send(ExecutionControl::LoadMore { result_set_id })
                    .await
                    .map_err(|_| "adapter load-more channel closed".to_owned())?;
            }
            SqliteExecutionEvent::StatementMessage { transaction, .. } => {
                certainty = transaction.certainty;
            }
            SqliteExecutionEvent::Finished { transaction, .. } => {
                certainty = transaction.certainty;
                finished = true;
            }
            SqliteExecutionEvent::Failed { error, .. } => {
                return Err(format!(
                    "adapter execution failed: {} {}",
                    error.safe_message,
                    error.safe_detail.unwrap_or_default()
                ));
            }
            SqliteExecutionEvent::Cancelled { .. } => {
                return Err("adapter execution was unexpectedly cancelled".to_owned());
            }
            SqliteExecutionEvent::Started { .. } | SqliteExecutionEvent::ResultTerminal(_) => {}
        }
    }
    task.await
        .map_err(|_| "adapter execution task did not complete".to_owned())?;
    Ok(AdapterExecutionReport {
        rows,
        column_sets,
        result_sets: result_sets.len(),
        transaction_certainty: certainty,
        finished,
    })
}

async fn run_adapter_cancellation(session: &AdapterSession) -> Result<bool, String> {
    let execution_id = ExecutionId::new();
    let plan = plan_execution_for_dialect(
        "SELECT SLEEP(10)",
        None,
        0,
        true,
        SqlDialect::MySql,
        "fixture-profile",
        "fixture-session",
        "querynot_fixture",
    )
    .map_err(|error| format!("adapter cancellation plan failed: {error}"))?;
    let (_control_tx, control_rx) = mpsc::channel(4);
    let (event_tx, mut event_rx) = mpsc::channel(8);
    let running = session.clone();
    let task = tokio::spawn(async move {
        running
            .execute(execution_id, plan, 100, control_rx, event_tx)
            .await;
    });
    let started = tokio::time::timeout(Duration::from_secs(2), event_rx.recv())
        .await
        .map_err(|_| "adapter cancellation did not start".to_owned())?
        .is_some_and(|event| matches!(event, SqliteExecutionEvent::Started { .. }));
    if !started || !session.request_cancel() {
        return Err("adapter cancellation could not be requested".to_owned());
    }
    let mut confirmed = false;
    tokio::time::timeout(Duration::from_secs(5), async {
        while let Some(event) = event_rx.recv().await {
            match event {
                SqliteExecutionEvent::Cancelled {
                    confirmed: observed,
                    ..
                } => confirmed = observed,
                SqliteExecutionEvent::Failed { error, .. } => {
                    return Err(format!(
                        "adapter cancellation failed: {}",
                        error.safe_message
                    ));
                }
                _ => {}
            }
        }
        Ok(())
    })
    .await
    .map_err(|_| "adapter cancellation did not terminate".to_owned())??;
    task.await
        .map_err(|_| "adapter cancellation task did not complete".to_owned())?;
    Ok(confirmed)
}

fn validate_tls_configuration(target: &FixtureTarget) -> Result<bool, String> {
    let connection_url = url::Url::parse(target.connection_url.expose_secret())
        .map_err(|_| format!("{} has an invalid generated URL", target.id))?;
    let mut ssl_mode = None;
    let mut ssl_ca = None;
    for (key, value) in connection_url.query_pairs() {
        match key.as_ref() {
            "ssl-mode" | "sslmode" => ssl_mode = Some(value.into_owned()),
            "ssl-ca" | "sslca" => ssl_ca = Some(value.into_owned()),
            _ => {}
        }
    }

    let verified = ssl_mode.as_deref() == Some("verify_identity")
        && ssl_ca
            .as_deref()
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .and_then(|path| std::fs::symlink_metadata(path).ok())
            .is_some_and(|metadata| metadata.is_file() && !metadata.file_type().is_symlink());
    if target.require_verified_tls && !verified {
        return Err(format!(
            "{} lacks an absolute regular CA file and identity verification",
            target.id
        ));
    }
    Ok(verified)
}

fn safe_sqlx(error: &sqlx::Error) -> String {
    match error {
        sqlx::Error::Configuration(_) => "configuration".to_owned(),
        sqlx::Error::Database(database) => {
            let vendor_number = database
                .try_downcast_ref::<sqlx::mysql::MySqlDatabaseError>()
                .map(|error| error.number().to_string())
                .unwrap_or_else(|| "unknown".to_owned());
            format!(
                "database:{}:{vendor_number}",
                database.code().as_deref().unwrap_or("unknown")
            )
        }
        sqlx::Error::Io(error) => {
            let kind = match error.kind() {
                std::io::ErrorKind::ConnectionRefused => "refused",
                std::io::ErrorKind::ConnectionReset => "reset",
                std::io::ErrorKind::ConnectionAborted => "aborted",
                std::io::ErrorKind::TimedOut => "timeout",
                std::io::ErrorKind::UnexpectedEof => "eof",
                _ => "other",
            };
            format!("connectivity:{kind}")
        }
        sqlx::Error::Tls(_) => "tls".to_owned(),
        sqlx::Error::Protocol(_) => "protocol".to_owned(),
        sqlx::Error::RowNotFound => "row_not_found".to_owned(),
        _ => "internal".to_owned(),
    }
}
