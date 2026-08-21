# Changelog

All notable changes to QueryNot will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Defined explicit context, scoped-tab, editor, splitter, and result tracks so result headings, column headers, and received rows render directly below the persisted 20–70% separator without changing virtualization, multiple-result, error, or backpressure behavior.
- The dark SQL-completion popup now uses QueryNot theme tokens; Tab accepts the highlighted completion or indents, while Enter inserts a new SQL line instead of accepting a completion.
- Wide results now use one horizontal scrollbar and keep column headers synchronized with virtualized rows instead of clipping the first column between competing scroll surfaces.

### Changed

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
