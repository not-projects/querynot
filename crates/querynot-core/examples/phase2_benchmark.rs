use querynot_core::ExecutionId;
use querynot_core::sql::plan_execution;
use querynot_core::sqlite::{ExecutionControl, SqliteExecutionEvent, SqliteSession};
use serde_json::json;
use sqlx::{Connection, Executor, SqliteConnection};
use std::time::Instant;
use tokio::sync::mpsc;

const MEASURED_SAMPLES: usize = 30;

#[tokio::main]
async fn main() {
    let directory = tempfile::tempdir().expect("benchmark temporary directory");
    let database_path = directory.path().join("phase2-benchmark.sqlite3");
    let mut fixture =
        SqliteConnection::connect(&format!("sqlite://{}?mode=rwc", database_path.display()))
            .await
            .expect("benchmark fixture connection");
    fixture
        .execute(
            "CREATE TABLE ordinary_result( \
                id INTEGER PRIMARY KEY, signed_value INTEGER, decimal_value TEXT,\
                float_value REAL, boolean_value INTEGER, binary_value BLOB, \
                unicode_value TEXT, variable_value TEXT, null_value TEXT, \
                timestamp_value TEXT, formula_value TEXT, payload TEXT); \
             WITH RECURSIVE n(value) AS ( \
                SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 10000 \
             ) \
             INSERT INTO ordinary_result \
             SELECT value, -value, printf('%d.123456789', value), value / 7.0, \
                    value % 2, randomblob(32), 'QueryNot Ω مرحبا', \
                    substr('variable-width-text-variable-width-text', 1, 8 + value % 32), \
                    CASE WHEN value % 3 = 0 THEN NULL ELSE '' END, \
                    '2026-08-13T12:34:56+03:00', '=1+1', \
                    printf('%0800d', value) \
             FROM n;",
        )
        .await
        .expect("ordinary-result fixture");
    fixture.close().await.expect("close fixture connection");

    let session = SqliteSession::open(&database_path, true)
        .await
        .expect("benchmark session");
    let sqlite_exact_version = session
        .connection_info()
        .await
        .expect("benchmark SQLite identity")
        .identity
        .exact_version;
    let mut first_batch_ms = Vec::with_capacity(MEASURED_SAMPLES);
    let mut complete_ms = Vec::with_capacity(MEASURED_SAMPLES);

    for sample_index in 0..=MEASURED_SAMPLES {
        let plan = plan_execution(
            "SELECT * FROM ordinary_result ORDER BY id",
            None,
            0,
            true,
            "benchmark-profile",
            "benchmark-session",
            "main",
        )
        .expect("benchmark plan");
        let execution_id = ExecutionId::new();
        let (control_tx, control_rx) = mpsc::channel(16);
        let (event_tx, mut event_rx) = mpsc::channel(16);
        let started = Instant::now();
        let running = session.clone();
        let task = tokio::spawn(async move {
            running
                .execute(execution_id, plan, 10_000, control_rx, event_tx)
                .await;
        });
        let mut first_batch = None;
        while let Some(event) = event_rx.recv().await {
            match event {
                SqliteExecutionEvent::Batch(batch) => {
                    first_batch.get_or_insert_with(|| started.elapsed());
                    control_tx
                        .send(ExecutionControl::Acknowledge {
                            result_set_id: batch.result_set_id,
                            sequence: batch.sequence,
                        })
                        .await
                        .expect("acknowledge benchmark batch");
                }
                SqliteExecutionEvent::Paused { result_set_id, .. } => {
                    control_tx
                        .send(ExecutionControl::Discard { result_set_id })
                        .await
                        .expect("discard benchmark cursor");
                }
                SqliteExecutionEvent::Finished { .. } => break,
                SqliteExecutionEvent::Failed { error, .. } => {
                    panic!("benchmark execution failed: {}", error.safe_message)
                }
                _ => {}
            }
        }
        task.await.expect("benchmark execution task");
        if sample_index > 0 {
            first_batch_ms.push(first_batch.expect("first result batch").as_secs_f64() * 1_000.0);
            complete_ms.push(started.elapsed().as_secs_f64() * 1_000.0);
        }
    }

    let first_p95 = percentile_95(&first_batch_ms);
    let complete_p95 = percentile_95(&complete_ms);
    let report = json!({
        "schema_version": 1,
        "sqlite_exact_version": sqlite_exact_version,
        "fixture": {
            "rows": 10_000,
            "columns": 12,
            "approximate_payload_bytes_per_row": 1_000,
            "synthetic": true
        },
        "sample_policy": {
            "discarded_setup_runs": 1,
            "measured_independent_runs": MEASURED_SAMPLES
        },
        "first_driver_stream_to_first_1000_row_batch_ms": {
            "samples": first_batch_ms,
            "p95": first_p95,
            "target_max_ms": 100.0,
            "status": if first_p95 <= 100.0 { "pass" } else { "fail" }
        },
        "full_10000_row_stream_and_discard_ms": {
            "samples": complete_ms,
            "p95": complete_p95
        },
        "limitations": [
            "The first-batch sample includes local SQLite driver time and is therefore conservative relative to the PRD processing-overhead definition.",
            "Native WebView frame-rate, resident-memory return, cold-launch, and target-platform interaction measurements remain Phase 5 procedures."
        ]
    });
    println!(
        "{}",
        serde_json::to_string(&report).expect("serialize benchmark")
    );
    if first_p95 > 100.0 {
        std::process::exit(1);
    }
}

fn percentile_95(samples: &[f64]) -> f64 {
    let mut ordered = samples.to_vec();
    ordered.sort_by(f64::total_cmp);
    let rank = ((ordered.len() as f64 * 0.95).ceil() as usize).saturating_sub(1);
    ordered[rank]
}
