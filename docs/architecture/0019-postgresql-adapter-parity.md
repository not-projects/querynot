# ADR 0019: Capability-driven PostgreSQL adapter parity

Date: 2026-08-31
Status: Implemented on `master`; disposable conformance and release evidence pending

## Context

The approved product roadmap names PostgreSQL as QueryNot's first post-initial-release engine and explicitly uses it to test whether the common adapter contract can absorb schemas, arrays, cancellation, row identity, and transaction differences without presentation-layer engine branching.

The live `0.1.13` release supports SQLite and the published MySQL/MariaDB matrix. Adding a PostgreSQL choice to the connection form without the native lifecycle, dialect, metadata, result, and safety paths would violate the vertical-slice rule. Conversely, describing a newly compiled adapter as released before a disposable server matrix passes would overstate the compatibility evidence.

## Decision

PostgreSQL is a distinct compiled-in server connection family behind the existing `AdapterSession` contract. Rust owns its connection options, credentials, TLS, identity detection, metadata, schema context, execution, result conversion, cancellation, transactions, browsing, and staged mutations. The WebView receives the same capability and connection views used by the existing adapters.

PostgreSQL profiles use host, port, database, username, password, timeout, reconnect, and the existing native-granted TLS fields. Port `5432` is suggested but editable. The target database is fixed by the profile because PostgreSQL cannot switch databases within one session. QueryNot maps the tab context to a schema and changes it with a quoted, confirmed `search_path`; profile metadata and every active tab/table continue to own isolated connections.

The transport mapping is fail-closed:

- **Disabled** uses no TLS and retains the existing local-development warning.
- **Required** requires encryption but does not claim server identity verification.
- **System trust** and **Custom CA** use full certificate and hostname verification.
- Client certificate and private-key paths remain native grants. An encrypted PKCS#8 key is decrypted only in native memory through the existing passphrase boundary.

The adapter requires an unambiguous `PostgreSQL` identity. PostgreSQL `18.x` uses the write-capable compatibility path, with `18.6` selected as the exact disposable conformance baseline. A different 18.x minor displays that distinction. Other majors remain query-only until their own compatibility decision and conformance evidence exist. This selection follows PostgreSQL's maintained-major policy and the current 2026-08-13 minor release; it is not a live support claim.

## Dialect, metadata, and data fidelity

The native statement planner handles PostgreSQL dollar-quoted bodies (including UTF-8 tags and bodies), tagged dollar quotes, nested block comments, quoted identifiers, explicit `E'…'` escape strings, ordinary strings, and semicolon boundaries. A configuration-dependent ordinary `\'` boundary fails as ambiguous instead of assuming a `standard_conforming_strings` value. Table plans use double-quoted identifiers, numbered `$n` parameters, `IS NOT DISTINCT FROM` optimistic comparisons, literal planned `NULL`, and PostgreSQL `DEFAULT VALUES` syntax.

Schema metadata comes from `pg_catalog`. It exposes ordinary, partitioned, and foreign tables; views and materialized views; overloaded routines using their identity arguments; columns, generated/identity state, primary and foreign keys, indexes, expressions/partial state, and supported definitions. Object names and definitions retain the existing untrusted, bounded text treatment.

User query results use the existing acknowledged batches, retained row/byte caps, tranche pauses, expiry, ownership checks, and terminal events. PostgreSQL scalar values retain lossless integer/decimal tags, byte arrays, booleans, temporal text/offsets, JSON/JSONB, UUID, and finite/non-finite float distinctions. Supported arrays retain a type label and lossless JSON-shaped element/null representation when binary decoding is required; arbitrary text-protocol PostgreSQL types remain inspectable without inventing a frontend type. An unsupported binary type fails with cast-to-text guidance rather than guessing.

## Transactions, cancellation, and table safety

Auto-commit uses normal PostgreSQL statement transactions. A server reporting `transaction_read_only = on` is projected as read-only even on the selected compatibility line. Manual mode opens `BEGIN` lazily before ordinary work and retains the connection until explicit Commit or Rollback. Handwritten `BEGIN`/`START`, `COMMIT`/`END`, `ROLLBACK`, and `SAVEPOINT` update the common transaction projection. Statement failure inside an explicit transaction remains active/aborted and requires rollback; an unprovable transition becomes unknown and blocks writes.

Cancellation uses a separately protected PostgreSQL connection and `pg_cancel_backend` for the exact recorded backend PID. Only a server `57014` response or a successful cancellation call confirms cancellation. The query session remains reusable after confirmed auto-commit cancellation; an explicit transaction still requires its normal rollback decision.

Table browsing and staged changes reuse the immutable native plans, deterministic declared identity, bound filters, optimistic original-row predicates, expected affected-row checks, one-transaction apply, complete rollback, and post-commit refresh contract. PostgreSQL adapter-specific values, arrays, JSON, UUID, binary values, and types without a supported editor remain read-only.

## Delivery plan and gates

| Stage | Scope | Status |
| --- | --- | --- |
| Contract and implementation | Profile target, adapter dispatch, PostgreSQL dialect/table planning, native lifecycle, UI engine choice, editor language/completion | Implemented on `master` |
| Local regression | Rust unit tests, frontend contract/completion tests, Svelte/TypeScript checks, workspace compile | Required before handoff |
| Disposable PostgreSQL conformance | Checksum- or digest-pinned PostgreSQL `18.6`; generated marker; password and client-certificate auth; disabled/system/custom-CA TLS cases; identity, schema/routine overloads, arrays/types, streaming, zero rows, transactions, cancellation, browse/edit/conflict/rollback | Pending; the MySQL-family fixture harness explicitly refuses to claim this evidence |
| Release integration | Add the proven PostgreSQL fixture to candidate CI, traceability, compatibility matrix, dependency/security evidence, and all four target compile/package lanes | Pending |
| Native release evidence | Trust-store/client-identity observations, accessibility/UI review, performance/resource observation, dogfood, and signed package candidate audit | Pending |

Until the pending gates pass, documentation may say that `master` contains the PostgreSQL adapter, but the live release and compatibility tables must not claim PostgreSQL support.

## Consequences

PostgreSQL demonstrates that the session and capability contract can represent a schema-oriented server without moving credentials, SQL authority, or engine mechanics into Svelte. The common table planner now owns placeholder and null-safe-equality differences explicitly. The remaining work is evidence and fixture integration, not a hidden UI-only adapter.

The compiled SQLx PostgreSQL feature adds no hosted service, telemetry, runtime download, adapter plugin, SSH tunnel, socket transport, database provisioning, or administration surface.

## References

- [PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/)
- [PostgreSQL 18.6 release notes](https://www.postgresql.org/docs/release/18.6/)
- [Product roadmap section 16.1](../product-requirements.md#161-next-postgresql-and-remote-access-parity)
- [Common MySQL-family adapter decision](0006-mysql-family-adapter-parity.md)
- [Native table-editing decision](0007-productivity-and-safe-data-editing.md)
