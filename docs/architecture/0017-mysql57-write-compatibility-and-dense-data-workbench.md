# ADR 0017: MySQL 5.7 write compatibility and dense data workbench

- Status: Accepted
- Date: 2026-08-24
- Scope: QueryNot `0.1.6`

## Context

Live use exposed two gaps behind otherwise supported workflows. The native adapter classified only the exact MySQL 5.7.44 conformance fixture as supported, so another well-formed 5.7 patch inherited query-only mode even though the adapter already uses the same conservative 5.7 transaction reconciliation and mutation safeguards for the line. In the workbench, multiple connection rows could consume most of the sidebar, while routine schema status/search copy and uniform 180px result columns spent space that did not improve context.

Table typography was also fixed in component CSS. Users could scale the whole interface, but could not independently choose a readable font family or data-grid text size.

## Decision

The MySQL-family adapter parses a strict three-component server version after identity agreement. Every well-formed MySQL 5.7.x identity is supported for ordinary writes, manual transactions, and safe staged table mutations, remains marked legacy/EOL, and uses the conservative 5.7 statement-effect reconciliation. A non-5.7.44 patch explicitly states that 5.7.44 remains the exact automated conformance fixture. Malformed versions, other unknown MySQL versions, ambiguous MySQL/MariaDB identity, unknown transaction state, and unsafe statements continue to fail closed.

Connections and Schema become separate bounded sidebar regions divided by a persisted horizontal separator. The split defaults to 50%, clamps to 20–80%, supports pointer drag and Arrow/Home/End keyboard control, and resets to 50% on double-click. Each pane owns its scroll range. The Offline row has no explanatory subtitle; routine current-schema copy is omitted; schema search expands only from a labelled magnifying-glass control; refresh actions use the shared labelled SVG icon.

Query-result columns derive their initial width from loaded header and value display lengths. Widths clamp from 64px to the previous 180px default, so short identifiers compact while long values keep the established width. Explicit pointer resizing remains authoritative for that column and extends to 640px. Width estimation caps work per value and does not render additional rows, preserving virtualization.

Settings persist a constrained table font family (`monospace` or system sans serif) and a 10–20px table text size, defaulting to monospace at 13px. Released settings gain those defaults during deserialization. The choices apply to query-result and table-data grids without changing raw value, copy, export, mutation, or native transport behavior.

## Consequences

- MySQL 5.7 patch compatibility no longer disables writes solely because the patch is not 5.7.44, while the exact release-evidence boundary stays visible.
- No TLS, authentication, destructive-statement, transaction-unknown, parameter binding, optimistic-conflict, or atomic rollback safeguard is weakened.
- The workspace snapshot gains one backward-compatible panel-size field; released snapshots load it at 50%.
- Settings and generated command bindings gain two backward-compatible typography fields.
- Connection-heavy workspaces can reserve predictable schema space without forcing the complete sidebar to scroll as one block.

## Validation

Rust unit tests cover strict MySQL 5.7 line classification, malformed/unknown fail-closed behavior, released-settings defaults, and released-workspace split defaults. Frontend tests cover compact short-value widths, the 180px long-value cap, font-dependent sizing, Settings preview, collapsed schema search, and keyboard sidebar resizing. The Chromium layout gate verifies the centered and bounded sidebar split, compact schema controls, value-aware result widths, saved grid typography, existing responsive geometry, virtualization, synchronized scrolling, result resizing, and value inspection.
