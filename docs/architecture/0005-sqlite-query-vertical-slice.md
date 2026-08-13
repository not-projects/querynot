# ADR 0005: SQLite sessions, streamed results, and immutable execution approval

Date: 2026-08-13
Status: Implemented locally in Phase 2; target-platform interaction evidence pending

## Decision

SQLite profiles use SQLx with bundled SQLite and disabled statement logging. Every connected profile owns a metadata-only session, while every online query tab owns a separate native session. The frontend receives only typed connection identity, capability, transaction, schema, execution, result, and export views. Full SQLite paths remain behind native file grants, and read-only mode is enforced by the driver rather than by UI convention.

Editor SQL enters one audited dynamic-SQL boundary in Rust. Application-generated metadata SQL validates namespaces against `PRAGMA database_list`, quotes identifiers locally, and binds object names. Metadata loads progressively, is length-bounded before crossing the display boundary, and is cached without row data under profile plus exact SQLite version and encoded namespace/object keys. A failed refresh may return the prior cache only with an explicit stale marker; deletion removes that profile's cache.

## Execution and transaction model

The native statement planner respects SQLite comments, strings, quoted identifiers, and statement delimiters. A non-empty selection wins; otherwise Run targets the cursor statement, while Run all remains separate. Statements execute serially on the tab session and stop on first error. Manual mode begins a transaction only when a non-transaction-control statement needs one, reconciles handwritten transaction statements, reports state after every successful statement, and reopens a transaction after an in-script commit when later work requires it. Unknown state blocks every operation not conservatively proven read-only until reconciliation or reconnect.

Destructive classification runs over every requested statement before any execution. Missing, ineffective, ambiguous, and uncertain `UPDATE`/`DELETE` predicates fail closed alongside `DROP` and `TRUNCATE`. The native runtime issues an opaque, single-use approval token bound to the immutable plan fingerprint, profile, tab, session, context, statement text/ranges, and parser flags. Reuse, editing, reconnecting, and context change invalidate it. The dialog shows connection, database/schema, statement type, known object, exact byte range, and exact statement text; cancel is the primary default action.

## Results, backpressure, and export

SQLite rows are converted to tagged native values before event emission. Batches are limited to 1,000 rows and 2 MiB, and each batch must be acknowledged before streaming continues. One Load more action authorizes one additional configured tranche. Per-result retention stops at 100,000 rows or 128 MiB, and a paused cursor expires after five minutes without re-execution.

The native registry validates owner, execution ID, result-set ID, sequence, shape, byte count, row count, and exactly one terminal event before forwarding data. A failed integrity check cancels the job and emits a safe internal failure instead of corrupting retained results. Frontend reload increments a lifecycle epoch while atomically cancelling jobs and clearing sessions, cursors, results, approvals, and owners, so an old event bridge cannot repopulate resources after cleanup.

The Svelte grid renders visible rows plus overscan, isolates bidirectional text, previews large values at 512 characters, and materializes only one full large value on demand. Copy uses canonical raw values and quoted TSV fields when tabs, newlines, or quotes would otherwise alter structure. Export operates only on retained rows or the current retained-row view; it never fetches or re-executes. CSV and JSON encoders preserve duplicate columns and typed values, use atomic temporary-file replacement, require explicit overwrite, and preserve the prior destination on injected interruption.

## Evidence and limitations

The Phase 2 verifier covers a real read-only SQLite query-to-stream-to-retention-to-CSV/JSON journey, metadata and cache behavior, dedicated-session isolation, cancellation, transaction reconciliation, cursor expiry, event rejection, reload cleanup, hostile values, export interruption, a 10,000-row virtualized component fixture, and a release-build 30-sample first-batch benchmark after one discarded setup run.

This ADR does not make a release support claim. Native WebView frame-rate and resident-memory return, real window crash behavior, target-platform dialogs and clipboard behavior, accessibility, packaging, manual security review, and all MySQL/MariaDB conformance remain later release gates.
