#![forbid(unsafe_code)]

use std::{env, path::PathBuf, process::ExitCode, time::Duration};

use futures_util::TryStreamExt;
use querynot_core::{DatabaseFamily, FixtureManifest, FixtureTarget};
use secrecy::ExposeSecret;
use serde::Serialize;
use sqlx::{Connection, MySqlConnection, Row, mysql::MySqlConnectOptions};

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
    })
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
        sqlx::Error::Io(_) => "connectivity".to_owned(),
        sqlx::Error::Tls(_) => "tls".to_owned(),
        sqlx::Error::Protocol(_) => "protocol".to_owned(),
        sqlx::Error::RowNotFound => "row_not_found".to_owned(),
        _ => "internal".to_owned(),
    }
}
