# ADR 0022: Idle connection health and explicit recovery boundaries

- Status: Implemented in the unreleased development source
- Date: 2026-11-06
- Extends: ADR 0003, ADR 0004, ADR 0006, and ADR 0013

## Decision

After an explicit Connect, the workbench checks connected server profiles every 30 seconds and on window focus. Checks are deduplicated per profile and never hold the workbench busy. SQLite has no network heartbeat. Restored workspaces start offline; the old per-profile automatic-reconnect checkbox is removed, and its serialized flag is retained only for storage compatibility.

Native health commands authorize the owning profile and use bounded, nonblocking network pings. A ping skips a connection whose adapter mutex is occupied and times out after three seconds. Active executions, retained cursors, and immutable native mutation plans are protected; the workbench also pauses background health checks for profiles with staged edits. Recovery uses the existing direct TLS and credential boundaries without weakening verification or prompting for a new credential.

An explicit connection retains its resolved profile and protected credentials in native memory until Disconnect or application exit. Metadata recovery and newly allocated tab sessions use that same configuration. Saving endpoint edits already requires Disconnect at the native boundary. Recovery and new tab allocation additionally retain the active configuration and original credential even when the session credential store is updated independently; replacement credentials cannot be sent to the previous connection implicitly. Saved changes apply after explicit reconnect. Test connection continues to use the current form values as an explicit temporary probe.

A lost idle session is replaced only when its cached transaction certainty is Clean and it has no active execution or mutation plan. The replacement preserves that tab's logical session ownership, context, and automatic/manual preference. It never re-executes SQL, fetches a result again, or applies staged mutations. Existing received rows remain an old result until the user runs another query. Reopening is bounded by the profile timeout, capped at ten seconds per attempt, and later checks retry a temporarily unavailable server.

A lost Active or Unknown transaction is never automatically replaced. Native ownership and obsolete results are released, while SQL remains available. The workbench displays that the transaction outcome may be unknown, blocks execution, and requires the user to review the server state and choose Retry. That explicit new session retains Manual mode when applicable and starts without replaying the previous work.

Each explicit connection has a fresh generation. Every asynchronous recovery checks that generation before changing registries; frontend epochs, revisions, and session signatures discard stale projections. Explicit Disconnect cancels in-flight checks, stops future attempts and prevents a late check from resurrecting the connection. The workbench shows Reconnecting while a known outage is unresolved.

## Validation boundary

The owner requested validation only through the existing `npm run tauri dev` instance in WSL. Native interaction uses its real WebKit and Tauri IPC. A checksum-pinned disposable MySQL 8.0.46 server listens only on a generated loopback port, uses a generated TLS identity and short-lived session credential, and verifies its explicit fixture marker before control operations.

This development validation is not release conformance or a support-matrix expansion. PostgreSQL recovery is compiled through the same adapter contract but is not claimed as independently exercised on a live PostgreSQL fixture in this change. Native Windows and macOS interaction remains unobserved.
