use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use futures_util::TryStreamExt;
use sqlx::{Connection, Executor, Row, SqliteConnection};

#[tokio::test]
async fn sqlite_proves_streaming_cancellation_types_and_transactions() {
    let mut connection = SqliteConnection::connect("sqlite::memory:")
        .await
        .expect("disposable SQLite connection should open");

    connection
        .execute(
            "CREATE TABLE typed_fixture (
                signed_value INTEGER NOT NULL,
                decimal_value TEXT NOT NULL,
                binary_value BLOB NOT NULL,
                text_value TEXT NOT NULL,
                null_value TEXT
            );
            INSERT INTO typed_fixture VALUES (
                -9223372036854775000,
                '12345678901234567890.1234567890',
                X'00FF1080',
                'QueryNot Ω',
                NULL
            );
            CREATE TABLE transaction_fixture (value_text TEXT NOT NULL);",
        )
        .await
        .expect("synthetic schema should initialize");

    let mut rows = sqlx::query(
        "WITH RECURSIVE sequence(value) AS (
            SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < 1024
        ) SELECT value FROM sequence ORDER BY value",
    )
    .fetch(&mut connection);
    let mut streamed = 0;
    while rows
        .try_next()
        .await
        .expect("SQLite rows should stream")
        .is_some()
    {
        streamed += 1;
    }
    drop(rows);
    assert_eq!(streamed, 1_024);

    let typed = sqlx::query("SELECT * FROM typed_fixture")
        .fetch_one(&mut connection)
        .await
        .expect("typed fixture should be readable");
    assert_eq!(
        typed
            .try_get::<i64, _>("signed_value")
            .expect("signed value"),
        -9_223_372_036_854_775_000
    );
    assert_eq!(
        typed
            .try_get::<String, _>("decimal_value")
            .expect("exact decimal text"),
        "12345678901234567890.1234567890"
    );
    assert_eq!(
        typed
            .try_get::<Vec<u8>, _>("binary_value")
            .expect("binary value"),
        vec![0, 255, 16, 128]
    );
    assert_eq!(
        typed
            .try_get::<String, _>("text_value")
            .expect("Unicode text"),
        "QueryNot Ω"
    );
    assert_eq!(
        typed
            .try_get::<Option<String>, _>("null_value")
            .expect("null value"),
        None
    );

    connection
        .execute("BEGIN")
        .await
        .expect("transaction should start");
    connection
        .execute("INSERT INTO transaction_fixture VALUES ('must roll back')")
        .await
        .expect("transactional insert should succeed");
    connection
        .execute("ROLLBACK")
        .await
        .expect("rollback should succeed");
    let retained: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM transaction_fixture")
        .fetch_one(&mut connection)
        .await
        .expect("rollback should be verifiable");
    assert_eq!(retained, 0);

    let keep_running = Arc::new(AtomicBool::new(true));
    {
        let progress_flag = Arc::clone(&keep_running);
        connection
            .lock_handle()
            .await
            .expect("SQLite handle should be available")
            .set_progress_handler(1_000, move || progress_flag.load(Ordering::Relaxed));
    }
    let cancellation_flag = Arc::clone(&keep_running);
    let cancellation_request = tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        cancellation_flag.store(false, Ordering::Relaxed);
    });
    let cancellation = sqlx::query_scalar::<_, i64>(
        "WITH RECURSIVE sequence(value) AS (
            SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < 100000000
        ) SELECT SUM(value) FROM sequence",
    )
    .fetch_one(&mut connection)
    .await;
    cancellation_request
        .await
        .expect("cancellation request should complete");
    assert!(
        cancellation.is_err(),
        "the progress handler should interrupt the long query"
    );
    connection
        .lock_handle()
        .await
        .expect("SQLite handle should remain available")
        .remove_progress_handler();
    let healthy: i64 = sqlx::query_scalar("SELECT 1")
        .fetch_one(&mut connection)
        .await
        .expect("SQLite connection should remain usable after interrupt");
    assert_eq!(healthy, 1);

    connection
        .close()
        .await
        .expect("cancelled SQLite resources should close");
}
