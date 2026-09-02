# ADR 0020: Bounded estimated query plans

Date: 2026-09-01
Status: Implemented in current source; five-server Explain conformance verified

## Context

QueryNot needs a query-plan workflow that preserves its existing session, safety, ownership, data-fidelity, and local-history boundaries. Engine plan formats differ materially and can change between releases. SQLite explicitly describes `EXPLAIN QUERY PLAN` output as intended for interactive debugging and warns that its shape may change. MySQL and MariaDB both expose JSON plans but do not share one stable JSON structure. PostgreSQL has its own JSON node schema.

Runtime analysis is outside this decision. `EXPLAIN ANALYZE` and MariaDB `ANALYZE FORMAT=JSON` execute the source statement, including data-changing statements where supported, and therefore require a separate future safety contract.

## Decision

The adapter capability view includes `explain`. A query tab exposes one labelled **Explain** action beside Run all, without a shortcut. It targets exactly one nonempty editor selection or the statement at the caret, rejects multiple selected statements and source text already prefixed by `EXPLAIN` or `ANALYZE`, and lets the database decide whether the remaining statement kind is explainable. Explain never uses destructive-statement approval because QueryNot generates only:

- SQLite: `EXPLAIN QUERY PLAN <statement>`
- MySQL and MariaDB: `EXPLAIN FORMAT=JSON <statement>`
- PostgreSQL: `EXPLAIN (FORMAT JSON) <statement>`

The generated statement runs on the existing isolated tab session. It therefore sees the same database/schema, temporary objects, and session settings as Run. It does not open a manual transaction or intentionally change transaction mode. Explain and Run share the existing per-tab active-operation registry, `ExecutionId`, cancellation command, ownership cleanup, connection-loss cleanup, and result replacement. Starting either operation replaces the other's visible payload.

`start_explain` emits a dedicated, sequenced `query_explain` lifecycle: `started`, then exactly one of `completed`, `failed`, or `cancelled`. Plan events cannot enter the acknowledged row-stream path. Duplicate, late, unknown, or out-of-order frontend events are rejected and cancellation is requested for the owning operation.

## Fidelity and normalization

The native adapter returns an `ExplainPlanView` with engine, exact version, context, raw format and payload, normalization status and warnings, and a flat parent-before-child node list. Optional node facts are operation, relation, alias, access type, join type, index, estimated rows, startup cost, total cost, width, condition, and engine detail. Numeric estimates remain strings across the WebView boundary.

Raw is the fidelity boundary. Raw retention is limited to 4 MiB; a larger response fails. Normalization is limited to 1,000 nodes and 64 levels. A malformed, unfamiliar, or over-complex structure succeeds as Raw-only with a reason instead of discarding useful engine output or inventing a tree. SQLite normalization uses its id/parent/detail rows. MySQL-family normalization accepts legacy table/query-block shapes and newer operation/input forms without treating MariaDB JSON as identical to MySQL. PostgreSQL normalization follows its `Plan`/`Plans` hierarchy. Unknown fields remain present in Raw.

The lower pane is titled **Query plan** for Explain. It defaults to Tree only when normalized nodes exist and otherwise selects Raw. Raw JSON may be prettified for display; **Copy raw** always copies the exact retained payload. All database text is rendered as text. The UI presents engine facts and never recommends indexes, rewrites, or tuning actions.

## History and support boundaries

Local history adds `operation_kind: query | explain`. Missing values deserialize as `query`, so the local store needs no schema migration. Explain entries retain only targeted SQL and normal outcome metadata. They never retain raw plans, normalized nodes, or driver payloads. Reopening any entry opens SQL in a query tab and never executes or explains it automatically.

SQLite and the five published MySQL/MariaDB fixtures participate in the Explain conformance extension. PostgreSQL compiles, parses, normalizes, and exposes Explain inside the existing development preview, but this decision does not add PostgreSQL to the live support matrix. Its dedicated disposable PostgreSQL fixture remains required by ADR 0019.

## Consequences

QueryNot gains a useful estimated-plan workflow without adding dependencies, hosted services, plan persistence, plan export, plan comparison, automatic recommendations, or a runtime-analysis safety exception. Engine format drift remains visible and recoverable through Raw-only success.

The five-server Phase 3/4 harness requires scan and indexed JSON plans and verifies that explaining a data-changing statement does not mutate fixture data or alter QueryNot's transaction projection. Both working-tree harness runs passed on MySQL 5.7.44, 8.0.46, and 8.4.10 plus MariaDB 10.11.18 and 11.4.12. An exact committed rerun remains part of the existing phase exit gates. PostgreSQL support evidence remains pending until its dedicated fixture passes.

## References

- [SQLite EXPLAIN QUERY PLAN](https://sqlite.org/eqp.html)
- [MySQL EXPLAIN](https://dev.mysql.com/doc/refman/8.4/en/explain.html)
- [MariaDB ANALYZE and EXPLAIN JSON distinction](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/analyze-and-explain-statements/analyze-format-json)
- [PostgreSQL EXPLAIN](https://www.postgresql.org/docs/18/sql-explain.html)
- [ADR 0019: Capability-driven PostgreSQL adapter parity](0019-postgresql-adapter-parity.md)
