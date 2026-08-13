# ADR 0004: Secure local persistence, vault, and file grants

Date: 2026-08-13
Status: Implemented locally in Phase 1; cross-platform integration evidence pending

## Decision

QueryNot stores non-secret application state in one fixed application-owned SQLite database under Tauri's application-data directory. The frontend never supplies that store path. Versioned forward-only migrations run one version per transaction, `PRAGMA quick_check` rejects unreadable input, and any open or migration failure preserves the existing file and starts the application in a visible read-only degraded state rather than creating a replacement store.

The current schema stores non-secret profile metadata, settings, a bounded offline workspace snapshot, history metadata, schema cache, and recoverable profile-deletion operations. Draft text is capped per tab. Credentials are structurally absent from persisted profile types; profiles contain only an opaque vault reference.

## Credential boundary

`SecretVault` is the native abstraction. The production implementation uses `keyring` with the fixed service `com.notprojects.querynot`; it has no file fallback. Submitted secrets are wrapped in `secrecy::SecretString`, saved only on an explicit vault action, or held in a native `SessionSecretStore` until removal or application exit. A rejected vault write returns a safe message and makes session-only use available without writing the secret to the store, log, command line, or environment.

Duplicate profiles omit secret references. Deletion is a recoverable two-step operation: persist a pending deletion, remove the vault item, record that completion, then transactionally remove metadata/cache and delete or relabel optional history/drafts. Retrying either partial state is idempotent. QueryNot never deletes a user-selected database file.

## File and diagnostics boundary

The dialog plugin is called only by Rust commands. The frontend receives an opaque `FileGrantId`, display name, and—only for an explicitly opened UTF-8 SQL file—bounded text. It never receives a full user path. Rust verifies grant purpose and ownership before reusing a path. Persisted source paths are converted back into fresh grants during restoration.

Operational diagnostics accept only structured enum fields and a constrained event-code alphabet. Atomic rotation retains at most 5 MiB and seven days; a logging failure is dropped without blocking application work. Export regenerates the preview natively and writes only after an explicit native save dialog. There is no network, telemetry, crash-upload, shell, process, environment, or unrestricted frontend filesystem capability.

## Workspace behavior

The Phase 1 workbench restores tab text, order, bindings, context labels, panel sizes, and active tab offline. It never restores a transaction, reconnects, or executes SQL. Tab identifiers are allocated and authorized by Rust. Closing a dirty tab requires a decision, and window close can transactionally preserve drafts before destruction without writing through to a source SQL file.

## Consequences and pending evidence

Unit and component tests cover migration rollback/corruption, secret exclusion, vault refusal, deletion recovery, settings reset, log bounds/redaction, ownership, offline restore, first-run routes, and theme contrast. A local Linux production desktop build is part of `npm run verify:phase1`.

The ADR does not claim the Phase 1 exit across all targets. Real Windows Credential Manager, Apple Keychain, and Linux Secret Service behavior plus target-platform keyboard, screen-reader, scale, narrow-width, and visual procedures remain release-blocking evidence to be collected on native systems. Connection testing, database execution, and source-file save behavior belong to later rollout phases and are not exposed here.
