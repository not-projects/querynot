# ADR 0007: Local productivity and native-authoritative table editing

Date: 2026-08-14
Status: Implemented locally in Phase 4; target-platform release evidence pending

## Decision

QueryNot completes productivity workflows without moving database authority, secrets, file access, or durable storage into the WebView. Svelte owns presentation and ephemeral interaction state. Rust owns SQL planning and execution, adapter sessions, table metadata, immutable mutation plans, history storage, workspace persistence, credential bundles, and native file grants.

The initial release remains one local application window. Startup and second-instance `.sql` files route into offline query tabs and never connect or execute. Query tabs can be renamed, reordered, duplicated, pinned, and closed. Workspace recovery silently persists query drafts, order, profile bindings, context labels, panel sizes, and the active tab after one second of editing inactivity and orderly close; only a real persistence failure surfaces the recovery warning. It never persists table staging, results, running jobs, open transactions, credentials, or native sessions.

## Editor, schema, history, and files

CodeMirror receives the adapter dialect and available schema metadata for keywords, built-ins, qualified objects, columns, and current-statement aliases. Its parse diagnostics remain advisory. Native formatting changes only the selected range or document, preserves comments through the checked formatter facade, and never executes or saves SQL.

The schema explorer progressively exposes databases or schemas, tables, views, columns, primary and foreign keys, indexes, routines, defaults, generated state, and engine definitions. Dense labels are bounded; full supported detail is opt-in and always rendered as untrusted text.

Query history is an application-store table, enabled by default with 90-day retention. It records only the approved SQL execution summary and no result rows, staged values, credentials, certificate material, endpoints, or raw driver logs. Search, reopen-as-offline-draft, individual deletion, clear, pause, and retention controls are local. Cleanup runs at startup and no more than once per 24 hours while open. A history or draft write failure warns without blocking database work or replacing the last valid recovery state.

Native file grants mediate open, review, save, and Save as. Before overwriting an opened file, QueryNot compares the last-known identity and modification state. An external change stops the save and offers the in-memory draft and current disk version for review; autosave never writes through to the source file. The single-instance plugin is registered before dialog handling so a second process cannot create a competing file/workspace owner.

## Table browse and mutation contract

Opening table data creates a dedicated connection-bound tab session. A declared primary key, or a declared unique key whose columns are all non-nullable, authorizes deterministic keyset paging and safe edits. Views, hidden SQLite `rowid`, nullable unique keys, partial or expression unique indexes, unknown or uncompareable values, generated columns, and binary/LOB values stay read-only. Tables without usable identity use capped, visibly unstable offset paging.

Server filters and sorts are structured native inputs. The planner quotes identifiers through the selected adapter, binds every value, escapes text patterns explicitly, appends identity ordering for deterministic pages, and rejects stale cursors, unsafe column types, and oversized metadata, cells, pages, or plans. MySQL-family information-schema counters are normalized across supported server signedness variants and then range-checked before use.

Cell updates, inserted rows, and deletions live only in Svelte memory until preview. Supported editors validate text, integer ranges, decimals, finite floating-point syntax, booleans, temporal text, enum/set values, and null/default semantics locally, while the Rust planner repeats authoritative type and operation validation. Invalid input stays visibly staged and cannot produce a preview.

Preview creates an immutable native plan identified by an opaque plan ID and staging revision. It shows operation type, target table, expected affected rows, SQL templates, and separately type-labelled, safely truncated parameter previews. The native plan retains exact bound values. Any edit, page/filter/context change, metadata refresh, reconnect, or return to editing invalidates the plan.

Apply executes the recorded operations in order in one transaction on the table tab session. Updates and deletes require the original declared identity plus null-safe comparisons for every originally loaded editable value. Every operation must affect exactly one expected row; otherwise the adapter rolls back the complete batch and leaves staging visible. Inserts require an explicit value, explicit null, or a real database default for every column. After commit, QueryNot refreshes server identities, defaults, triggers, coercions, and row placement through a new browse operation rather than trusting client projections.

## Lifecycle and secret boundaries

Disconnect, refresh, filter/context change, profile deletion, tab close, and window close stop when staged edits, active work, or unresolved transactions need a user decision. Unexpected loss closes native resources and keeps staged values visible only for review; reconnect never replays them, and a newly reviewed preview is required. Table staging is intentionally absent from crash recovery and may be lost on a crash.

An optional encrypted PKCS#8 client-key passphrase shares the existing opaque OS-vault bundle with the database password. Legacy password-only vault entries remain readable. Decryption occurs only in native memory for the connection attempt, and neither passphrase nor decrypted key enters profile metadata, the frontend store, diagnostics, or logs.

## Evidence and limitations

`npm run test:conformance:phase4` uses the same checksum-pinned, marker-verified five-server fixture matrix as Phase 3 and adds deterministic paging, bound hostile filters, typed validation, inserts/updates/deletes, generated-value refresh, optimistic conflicts, and atomic rollback. `npm run verify:phase4` reruns that matrix, SQLite table fault coverage, frontend/native tests, traceability, dependency audits, formatting, linting, and a local optimized desktop build from one clean commit.

This ADR is not a release support claim. Windows/macOS/Linux packaging and native interaction evidence, accessibility and visual review, performance and resource measurements, manual safety and diagnostics review, the fixed five-day dogfood period, the opt-in beta, and the final release evidence audit remain Phase 5 gates.
