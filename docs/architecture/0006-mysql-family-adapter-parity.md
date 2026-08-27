# ADR 0006: Capability-driven MySQL-family adapter parity

Date: 2026-08-13
Status: Implemented locally in Phase 3; target-platform release evidence pending

## Decision

QueryNot uses one `AdapterSession` contract for SQLite, MySQL, and MariaDB. Direct MySQL-family TCP/TLS connections, metadata, SQL execution, transactions, cancellation, and value decoding remain in Rust. The presentation layer receives detected identity, exact version, dialect, capabilities, compatibility state, and safe errors; it does not select a MySQL versus MariaDB implementation.

The release-development matrix is pinned to MySQL 5.7.44, 8.0.46, and 8.4.10 plus MariaDB 10.11.18 and 11.4.12. Exact identity is derived from both `VERSION()` and `@@version_comment`; disagreement fails closed. Every well-formed MySQL 5.7 patch identity uses the tested 5.7 transaction and mutation capability path, remains visibly legacy, and keeps write safeguards enabled; a non-5.7.44 patch also states that 5.7.44 remains the exact conformance fixture. Other unknown but unambiguous versions enter visible query-only mode and native execution rejects possible writes. MySQL 8.0.46 retains its persistent legacy indicator without weakening any control.

## Transport and authentication

Profiles support an explicitly warned disabled mode, encryption without identity verification, system-trust identity verification, and custom-CA identity verification. Verified modes use `VerifyIdentity` and never fall back to a preferred/opportunistic mode. Optional client certificate and private-key paths stay behind native grants, are redacted from debug output and diagnostics, and are supplied directly to the driver. SQLx is built with native OS trust roots.

The disposable conformance fixture proves the selected `mysql_native_password` and `caching_sha2_password` paths over verified TLS 1.2. It also proves that every server rejects the client-certificate account without its certificate, accepts it with the generated identity, and that system-trust mode rejects the fixture's untrusted private CA.

## Metadata, execution, and transactions

The adapter exposes databases, tables, views, routines, columns, primary/foreign keys, indexes, and definitions through the common schema model. MySQL delimiters, routine bodies, hash comments, backslash escapes, and quoted tokens are handled by the dialect planner. Results use the same acknowledged batches, tranche authorization, retained limits, terminal events, and ownership checks as SQLite; multiple result sets remain ordered.

Native value conversion preserves signed/unsigned integers and decimals as strings, binary data as bytes, booleans as booleans when the protocol proves a one-bit value, temporal engine text without inventing an offset, floating-point values, empty strings, large text, nulls, duplicate column names, and zero-row column metadata.

MySQL 8.x and MariaDB reconcile `@@session.autocommit` and `@@session.in_transaction` after every statement. MySQL 5.7 does not expose the latter variable, so the adapter combines server-owned autocommit with a conservative, tested statement-effect state machine: ordinary manual-mode work becomes active, explicit transaction control updates state, and documented implicit-commit classes become clean. Unclassifiable input becomes unknown and is subject to the existing write gate. Cancellation opens a separate protected control connection, sends `KILL QUERY` only for the validated numeric connection ID, reports confirmation, and preserves the query session when the server confirms cancellation. An adapter-emitted cancellation event is terminal even when that separate server confirmation is unavailable; the UI retains the distinction in its message but stops timing, clears paused-cursor state, and unlocks the editor because the native execution resource has already closed.

Connection test/setup futures have one native owner, a 5–120 second timeout, and an explicit cancellation channel. Cancellation or timeout drops the in-progress future before a session can enter runtime state.

## Evidence and limitations

`npm run test:conformance:phase3` starts only checksum-pinned, marker-verified, random-loopback disposable servers. The Phase 3 verifier reruns that matrix, the complete SQLite journey, frontend/native tests, dependency gates, and a local production desktop build against one clean commit.

This ADR is not a release support claim. Native packaging, target-platform trust-store integration, accessibility, performance, dogfood, beta, and manual safety review remain Phase 5 gates. Encrypted client-key passphrase storage and broader productivity/data-editing behavior remain governed by their numbered requirements and later phase evidence.
