# Changelog

All notable changes to QueryNot will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.14] - 2026-08-31

### Added

- Added the first compiled PostgreSQL adapter as a development-preview connection path, including direct fail-closed TLS and client identity, PostgreSQL 18.x identity classification with 18.6 as the exact planned conformance baseline, isolated schema contexts, overloaded routine metadata, dollar-quoted statement planning, bounded typed/array results, backend cancellation, transactions, deterministic table browsing, and staged atomic mutations through the common native contract.
- Added PostgreSQL connection creation with the 5432 default, accurate saved-connection labels, PostgreSQL CodeMirror parsing, and engine-aware function completion.

### Changed

- Generalized native table plans to use adapter-specific parameter markers, null-safe comparisons, quoted identifiers, and direct planned NULL values without weakening the existing SQLite/MySQL mutation safeguards.

### Security

- Kept PostgreSQL outside the live release support claim until a dedicated disposable PostgreSQL 18.6 password/client-certificate, TLS, metadata, array/value, cancellation, transaction, and table-mutation conformance gate is retained; the MySQL-family release harness fails closed for PostgreSQL targets.
- Enforced the existing immutable file/server and server-engine profile boundary in the native update path, so a saved credential cannot be silently rebound to another adapter kind.

## [0.1.13] - 2026-08-29

### Fixed

- Moved SQL-completion metadata warmup behind successful connection and tab-session readiness so large catalogs no longer leave the profile in Connecting or block ordinary work while columns preload in the background.
- Made out-of-matrix connection warnings dismissible for the current connection without changing its compatibility restrictions.
- Presented both rejected query starts and database execution failures inside Results with a readable category, safe database message, statement location when available, and cause-specific retry guidance.

## [0.1.12] - 2026-08-27

### Added

- Preloaded the active database/schema's table and view names plus a bounded set of their columns for SQL completion when a connection or tab context becomes active, while retaining on-demand lookup for larger or temporarily unavailable catalogs.

### Fixed

- Kept the SQL editor scrollable at the upper result-split bound by aligning CodeMirror and the draggable workspace grid on a three-and-a-half-row minimum viewport, including horizontal-scrollbar space.

## [0.1.11] - 2026-08-27

### Fixed

- Mounted SQL completion popups at the themed application shell instead of inside the clipping editor frame, so suggestions remain visible past the SQL input edge.
- Loaded missing column metadata on demand through the existing native metadata session for tables referenced anywhere in the current statement, including `WHERE` expressions and `SELECT` lists whose `FROM` clause follows the caret.
- Treated every adapter-emitted cancellation event as terminal even when a separate MySQL-family server confirmation is unavailable, stopping the timer, closing the paused result state, and unlocking the SQL editor after cancelling a retained 10,000-row cursor.

## [0.1.10] - 2026-08-27

### Added

- Extended SQL completion with expression-aware SQLite, MySQL, and MariaDB built-in functions plus loaded columns from the tables and aliases referenced by the current statement, falling back to the explicitly selected table's structure when no relation is present yet.

### Fixed

- Restored Arrow Up/Down and Page Up/Down navigation inside the SQL completion popup while keeping Enter as a newline and Tab as completion acceptance.

## [0.1.9] - 2026-08-26

### Changed

- Reworked CI into fail-closed documentation, frontend, and native scopes; removed repeated cross-platform Clippy and core-test work while retaining Windows core behavior and all four desktop compile targets; and replaced job-name-fragmented Rust caches with stable, dependency-aware, purpose-specific cache families written only from `master`.
- Reworked saved-connection and schema-object context actions into one compact, keyboard-navigable menu pattern with explicit destructive treatment, reliable dismissal and focus return, and positioning that remains visible outside sidebar scroll regions.
- Reworked workspace-tab actions around the same keyboard menu pattern, with bounded move commands and a focused rename dialog that preserves the tab's SQL, connection, session, and results.
- Split result Copy and Export disclosures by intent: Copy rows now uses the shared command menu, while Export uses a focused form popover that keeps CSV safety, NULL-token configuration, and server-order/current-view choices explicit.
- Clarified execution and result status ownership: the Results heading carries the overall outcome and elapsed time, loaded-row counts stay with filtering, and per-statement details stay in the grid footer.
- Reworked File into the shared keyboard command menu with explicit active-group and local-file context, visible shortcuts, explained disabled save actions, and disk review when linked; Save actions now live in File while Format remains an editor control.
- Added explicit Results states for queued/running rowless executions, successful statement-only work, returned columns with zero rows, filters with no matches, confirmed cancellation, and failures without changing native execution behavior.
- Added forced-colors, accessible-name, and focus-visibility regression coverage for the redesigned workbench, with native Windows Narrator, OS Contrast Theme, and physical-device observations retained as explicit manual follow-up.

## [0.1.8] - 2026-08-26

### Changed

- Streamlined signed releases by reusing successful exact-commit CI for candidate packaging, retaining unrecompressed artifacts briefly, reviewing compact evidence, verifying GitHub's server-computed asset digests instead of routinely downloading every draft package, and keeping full-package verification as an on-demand audit.
- Reworked Connections, Schema, and local History around one compact control tier, explicit connection states, quieter on-demand schema actions, readable query records, and progressively disclosed local-storage guidance without changing connection, metadata, or query-reopen behavior.

## [0.1.7] - 2026-08-25

### Changed

- Rebalanced the application header and connected query workbench so document menus, global utilities, connection status, execution, filtering, selection, copy, value inspection, and export controls use clearer grouping and consistent compact sizing, while result status and retained-row copy scope remain explicit.
- Reorganized Settings into purpose-based, natural-height sections with quieter secondary controls and a persistent action footer, keeping Save, Cancel, and reset access stable while preferences scroll independently at constrained sizes and high UI scales.
- Reworked Add connection around endpoint, transport, credential, and behavior sections with persistent actions, explicit credential storage choices, progressive client-certificate controls, file-first SQLite setup, and no irrelevant reconnect control for file profiles.
- Simplified current-view export so the exact filtered and sorted row indexes are captured when Export is chosen, removing continuous parent-state synchronization without changing server-order export or CSV safety behavior.

## [0.1.6] - 2026-08-24

### Added

- Added persisted table font-family and 10–20px text-size controls that apply to query results and editable table grids.

### Changed

- Enabled ordinary query writes, transactions, and safe staged row mutations for well-formed MySQL 5.7.x server versions while retaining the persistent legacy warning, the exact 5.7.44 conformance baseline, and query-only handling for malformed or unrecognized lines.
- Split Connections and Schema into a persisted 20–80% pointer- and keyboard-resizable sidebar layout that starts centered and resets to 50% on double-click.
- Compacted the sidebar by removing the Offline subtitle and routine schema status copy, hiding schema search behind a labelled magnifying-glass control, and replacing refresh labels with shared SVG controls.
- Made result columns size to their loaded header/value content between 64px and the prior 180px default cap, while preserving manual resizing up to 640px.

## [0.1.5] - 2026-08-23

### Added

- Added a reviewed cross-platform release candidate matrix for Windows x86-64 NSIS/MSI, Linux x86-64 AppImage/DEB/RPM, and macOS Intel/Apple-silicon DMGs with one combined signed updater manifest.

### Changed

- Shortcuts now use Command on macOS and Control on Windows and Linux, including CodeMirror execution bindings, global document actions, labels, and accessibility metadata.
- Signed update installation now uses Tauri's detected package type on Windows, Linux, and macOS instead of rejecting non-Windows installations after a successful update check.
- Expanded candidate aggregation and exact-byte draft publication from the Windows-only four-asset release to the complete 18-asset desktop release set.

### Fixed

- Included the macOS application bundle target and architecture-specific artifact naming in candidate packaging so Tauri retains signed Intel and Apple-silicon updater archives alongside the DMGs.

### Security

- Every unique Windows, Linux, and macOS updater payload is independently verified against the dedicated QueryNot Ed25519-BLAKE2b public key before candidate retention, before publication staging, and after draft download.

## [0.1.4] - 2026-08-22

### Fixed

- Defined explicit context, scoped-tab, editor, splitter, and result tracks so result headings, column headers, and received rows render directly below the persisted 20–70% separator without changing virtualization, multiple-result, error, or backpressure behavior.
- Centered shared SVG controls inside their icon-button boxes, including the Connections Plus action at normal and scaled UI sizes.
- Kept schema namespaces and their loaded objects compact at the top of the sidebar instead of stretching sparse rows through the available height.
- Closing an active query now stays in its current connection or Offline group, activates the preceding same-group tab when available, and creates an empty query in that group when no tabs remain.
- Replaced implicit row selection on field click with explicit row checkboxes and visible selected-row copy actions; focused fields now open in one side value subtab through right-click or **Open value**, with soft wrapping, lossless raw copy, and safe formatted JSON display.
- The dark SQL-completion popup now uses QueryNot theme tokens; Tab accepts the highlighted completion or indents, while Enter inserts a new SQL line instead of accepting a completion.
- Wide results now use one horizontal scrollbar and keep column headers synchronized with virtualized rows instead of clipping the first column between competing scroll surfaces.
- Replaced platform-dependent `Mod` aliases with explicit Windows `Ctrl` shortcuts so `Ctrl+Enter`, `Ctrl+Shift+Enter`, and related file, focus, find, and cancel actions route reliably without treating the Windows key as Command.
- UI scale changes now preview on the application behind Settings while the open Settings dialog keeps its opening size, so the slider remains usable across the 75–200% range.
- Dialogs now remain bounded to the current viewport at large UI scales, with an internal scroll range that can reach both the title controls and bottom actions.
- Kept scaled workbench tabs compact instead of stretching them across the row, replaced repeated visible Unsaved text with labelled edit icons, attached the new-tab action to the strip, and aligned Offline document actions with the editor.

### Changed

- Replaced font-symbol controls with a shared inline SVG icon set for close, add, overflow, pin, table, disclosure, status, and sort actions.
- Made the schema sidebar navigation-only. Selecting a table or view now opens a connection-scoped main-workspace structure tab with columns, types, primary keys, defaults, generated fields, indexes, and foreign keys; **Browse rows** is a secondary mode and creates no table session or row fetch until explicitly chosen.
- Flattened the main workbench hierarchy with a compact header and status bar, quieter connection and tab treatments, grouped query/document actions, one dominant Run action, and accurate query-draft status without changing safety or session context.
- Restored a horizontal tab strip above the editor that shows only the selected connection or Offline group's tabs, remembers the most recent tab per group for the current session, and keeps tab keyboard navigation group-local.
- Simplified the left sidebar to readable profile rows with direct connection state actions and compact secondary menus, and moved the complete local History workflow into a non-resizing right-side overlay drawer with managed focus.
- Replaced unexplained online/offline tab dots with explicit Unsaved, Opening, or Error labels only when a tab needs attention; connection and session state remains available in the context bar.

## [0.1.3] - 2026-08-20

### Fixed

- Kept CodeMirror mounted and focused through normal SQL typing by untracking one-time attachment initialization while retaining targeted reactive document, dialect, wrapping, and editable-state updates.

### Changed

- Nested query and table-data tabs under their saved connection profiles, added an Offline group for unbound files and drafts, and removed the duplicate horizontal tab strip.
- Kept Connect and Disconnect at profile level while lazily opening one isolated native session for each selected child; new children on connected profiles open immediately, restored unused children remain offline, failed opens expose scoped Retry, and pending opens block close, disconnect, and updater handoff.
- Moved CSV formula-prefix, NULL-token, and binary-format guidance inside the expanded Export control instead of displaying it whenever result rows exist.

## [0.1.2] - 2026-08-20

### Fixed

- Kept normal SQL typing focused and layout-stable by making the one-second draft-recovery debounce silent; the recovery banner now appears only after a real persistence failure.
- Kept unsigned development builds startable with the current Tauri updater plugin by supplying an inert base configuration; signed release builds still inject the dedicated public key and update feed.
- Reconciled result batches that arrive before the native execution-start response so the first run immediately shows both populated and zero-row result sets.
- Replaced the redundant application-close decision dialog with silent recovery and clean-session shutdown; actionable work keeps the window open and focuses its blocking context.

### Changed

- Reduced Rust development and test debug-symbol volume while retaining incremental compilation, keeping local Tauri builds faster and generated artifacts bounded.
- Unified connection creation behind an immutable Server/File choice. Explicit database files are detected as SQLite through a read-only native probe and represented by opaque grants; standalone open/create SQLite actions were removed, with new-file creation deferred.
- Moved SQL document actions into a compact File menu and replaced the fixed, scroll-heavy result block with a persisted 20–70% keyboard- and pointer-resizable split, selectable result-set tabs, a single virtualized result viewport, and grouped export options.

### Security

- Added independent Ed25519-BLAKE2b verification of updater installer and trusted-comment signatures against the configured public key before future signed-release publication.

## [0.1.1] - 2026-08-14

### Added

- Added a signed Windows update channel with a silent startup check, manual Settings check, plain-text release details, explicit install action, progress feedback, and the existing draft/query/transaction/staged-edit close safeguards.
- Added dedicated QueryNot updater-key boundaries and a fail-closed candidate/publication pipeline for the exact NSIS installer, signature, stable `latest.json`, and manual checksum without rebuilding reviewed bytes.

### Fixed

- Kept successful connection, deletion, settings, tab-close, and diagnostics actions from leaving completed dialogs open.
- Made terminal query timers stop, docked returned result sets in the visible workbench, and granted the narrowly scoped window-destroy capability used after explicit close safety checks.
- Prevented connection actions and schema controls from overflowing the sidebar, made native dropdown choices readable in every theme, and applied UI scale to the complete application and dialog viewports.

### Changed

- Schema starter queries now open a dedicated query-tab session on an already connected profile, while local history is compact and positioned below the schema explorer.
- Removed unused direct frontend test/editor declarations and unused direct Rust core declarations; required Tauri, OS-vault, database-driver, and CodeMirror transitive dependencies remain lockfile-pinned.
- Reworked the application icon into the PostNot family: an open cream `Q` with an orange query dot inside the shared dark-green bordered tile.

## [0.1.0] - 2026-08-14

### Fixed

- Restored a content-height bottom status bar at large window sizes, opaque themed dialogs, PostNot-aligned theme names, and the standard native close path for windows without active or unsaved work.

### Added

- Established the initial project identity, community policies, security guidance, contributor workflow, agent instructions, and GitHub contribution templates.
- Defined the planned initial-release product requirements, including legacy MySQL 5.7+ compatibility, architecture boundaries, safety constraints, acceptance criteria, and roadmap.
- Added the Phase 0 Rust/Tauri/Svelte/TypeScript scaffold, generated command contracts, release traceability and evidence foundations, cross-platform CI, security boundaries, and disposable database feasibility harnesses.
- Implemented the Phase 1 secure local foundation: non-secret profile metadata, optional OS-vault and session-only secrets, transactional application-store migrations, recoverable profile deletion, settings, redacted bounded diagnostics, native file grants, explicit runtime state machines and ownership checks, and an accessible offline draft-restoring workbench with no SQL execution path.
- Implemented the Phase 2 SQLite query vertical slice: explicit SQLite file profiles, isolated metadata and tab sessions, progressive cached schema browsing, a CodeMirror SQL editor, statement targeting and single-use destructive confirmations, manual transactions, native cancellation, acknowledged streaming with caps and cursor expiry, virtualized hostile-value-safe results, canonical copy, atomic CSV/JSON export, reload cleanup, and release-build reference benchmarking.
- Implemented Phase 3 MySQL-family parity through the common adapter contract: exact MySQL 5.7.44/8.0.46/8.4.10 and MariaDB 10.11.18/11.4.12 identity and lifecycle detection, direct fail-closed TLS, client certificates, tested password authentication, progressive metadata including routines, MySQL dialect/routine parsing, lossless edge values, multiple results, transaction and implicit-commit reconciliation, confirmed cancellation, query-only unknown-version safeguards, persistent legacy guidance, and cancellable connection setup.
- Implemented Phase 4 productivity and safe data editing: schema-aware completion and diagnostics, selection-preserving formatting, schema search/detail actions, local query history, recoverable workspace and SQL-file workflows, single-window file routing, encrypted client-key passphrases, query tab management, loaded-result sort/filter, deterministic table paging, structured bound filters, typed ephemeral staging, immutable previews, optimistic conflict detection, generated-value refresh, and atomic rollback across SQLite and the exact five-server MySQL/MariaDB development matrix.
- Completed the Windows-first Phase 5 release gate: aligned `0.1.0` build metadata, one unsigned Windows x86-64 NSIS artifact without updater material, application icons, manual-dispatch candidate CI, SHA-256 generation, release-binary/package inspection, fail-closed evidence auditing, and retained evidence for all 101 requirements and 20 acceptance criteria.
- Added fail-closed Phase 6 publication: exact manifest/package/checksum matching, explicit confirmation, a no-rebuild manual workflow, draft tag/source validation, draft-asset round-trip verification, fixed release notes with unsupported roadmap labels, and data-safety-first failure triage.
- Strengthened the Phase 5 evidence contract with per-package core-journey checks, one network journey per OS family, per-platform accessibility matrices, and recomputed native performance statistics from retained raw samples.

### Changed

- Revised the `0.1.0` release envelope to Windows 11 x86-64 while preserving the complete SQLite/MySQL/MariaDB workflow; WSL2/Linux packages are engineering evidence and Windows 10/macOS/native Linux distribution is deferred.
- Made native owner checks, the fixed five-day dogfood checklist, and external beta explicit post-release validation for the sole initial participant without representing unperformed evidence as passed.
- Made the checksum-pinned five-server native fixture matrix the candidate-CI feasibility gate; the three-image Docker path remains a supplemental fail-closed smoke test and cannot weaken the TLS floor for a legacy image.
