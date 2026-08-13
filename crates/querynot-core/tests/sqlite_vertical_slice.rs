use querynot_core::export::{ExportFormat, ExportOptions, NoExportFault, write_received_rows};
use querynot_core::result::{ResultRegistry, ResultTerminalState, RetainedResult};
use querynot_core::sql::plan_execution;
use querynot_core::sqlite::{ExecutionControl, SqliteExecutionEvent, SqliteSession};
use querynot_core::{ErrorCategory, ExecutionId, TaggedValue};
use sqlx::{Connection, Executor, SqliteConnection};
use tokio::sync::mpsc;

#[tokio::test]
async fn sqlite_read_only_query_stream_retain_and_export_journey() {
    let directory = tempfile::tempdir().unwrap();
    let database_path = directory.path().join("journey.sqlite3");
    let mut fixture =
        SqliteConnection::connect(&format!("sqlite://{}?mode=rwc", database_path.display()))
            .await
            .unwrap();
    fixture
        .execute(
            "CREATE TABLE values_fixture(id INTEGER PRIMARY KEY, text_value TEXT, binary_value BLOB, null_value TEXT);\
             INSERT INTO values_fixture VALUES(-9223372036854775000, '<script>Ω</script>', X'00FF1080', NULL);",
        )
        .await
        .unwrap();
    fixture.close().await.unwrap();

    let session = SqliteSession::open(&database_path, true).await.unwrap();
    let execution_id = ExecutionId::new();
    let plan = plan_execution(
        "SELECT id, text_value, binary_value, null_value FROM values_fixture",
        None,
        0,
        true,
        "profile",
        "session",
        "main",
    )
    .unwrap();
    let (control_tx, control_rx) = mpsc::channel(8);
    let (event_tx, mut event_rx) = mpsc::channel(8);
    let running = session.clone();
    let task = tokio::spawn(async move {
        running
            .execute(execution_id, plan, 10_000, control_rx, event_tx)
            .await;
    });
    let mut registry = ResultRegistry::default();
    let mut retained_id = None;
    let mut finished = false;
    while let Some(event) = event_rx.recv().await {
        match event {
            SqliteExecutionEvent::Batch(batch) => {
                if registry.get(batch.result_set_id).is_err() {
                    registry
                        .insert(RetainedResult::new(
                            batch.execution_id,
                            batch.result_set_id,
                            batch.statement_index,
                        ))
                        .unwrap();
                }
                retained_id = Some(batch.result_set_id);
                let result_set_id = batch.result_set_id;
                let sequence = batch.sequence;
                registry
                    .get_mut(result_set_id)
                    .unwrap()
                    .accept_batch(batch)
                    .unwrap();
                control_tx
                    .send(ExecutionControl::Acknowledge {
                        result_set_id,
                        sequence,
                    })
                    .await
                    .unwrap();
            }
            SqliteExecutionEvent::ResultTerminal(terminal) => {
                assert_eq!(terminal.state, ResultTerminalState::Completed);
                registry
                    .get_mut(terminal.result_set_id)
                    .unwrap()
                    .accept_terminal(&terminal)
                    .unwrap();
            }
            SqliteExecutionEvent::Finished { .. } => {
                finished = true;
                break;
            }
            SqliteExecutionEvent::Started { .. }
            | SqliteExecutionEvent::StatementMessage { .. }
            | SqliteExecutionEvent::Paused { .. } => {}
            unexpected => panic!("unexpected query event: {unexpected:?}"),
        }
    }
    task.await.unwrap();
    assert!(finished);
    let retained = registry.get(retained_id.unwrap()).unwrap();
    assert_eq!(retained.rows.len(), 1);
    assert_eq!(
        retained.rows[0],
        vec![
            TaggedValue::SignedInteger("-9223372036854775000".to_owned()),
            TaggedValue::Text("<script>Ω</script>".to_owned()),
            TaggedValue::Bytes(vec![0, 255, 16, 128]),
            TaggedValue::Null,
        ]
    );

    for (format, extension) in [(ExportFormat::Csv, "csv"), (ExportFormat::Json, "json")] {
        let destination = directory.path().join(format!("received.{extension}"));
        assert_eq!(
            write_received_rows(
                &destination,
                retained,
                &[0],
                &ExportOptions {
                    format,
                    null_token: "\\N".to_owned(),
                    overwrite_confirmed: false,
                },
                &NoExportFault,
            )
            .unwrap(),
            1
        );
        let bytes = std::fs::read(destination).unwrap();
        assert!(
            bytes
                .windows("<script>Ω</script>".len())
                .any(|window| { window == "<script>Ω</script>".as_bytes() })
        );
    }

    let write_execution = ExecutionId::new();
    let write_plan = plan_execution(
        "INSERT INTO values_fixture VALUES(2, 'blocked', X'00', NULL)",
        None,
        0,
        true,
        "profile",
        "session",
        "main",
    )
    .unwrap();
    let (_write_controls, control_rx) = mpsc::channel(2);
    let (event_tx, mut event_rx) = mpsc::channel(4);
    let running = session.clone();
    let write_task = tokio::spawn(async move {
        running
            .execute(write_execution, write_plan, 10_000, control_rx, event_tx)
            .await;
    });
    let mut denied = false;
    while let Some(event) = event_rx.recv().await {
        if let SqliteExecutionEvent::Failed { error, .. } = event {
            denied = error.category == ErrorCategory::Authorization;
        }
    }
    write_task.await.unwrap();
    assert!(denied, "read-only execution must fail through the adapter");
}
