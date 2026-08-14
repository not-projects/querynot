# Changelog

All notable changes to QueryNot will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases will use [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once versioned application development begins.

## [Unreleased]

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
- Added the Phase 5 release-candidate framework: aligned unpublished `0.1.0` build metadata, explicit unsigned NSIS/DMG/AppImage/Debian packaging without updater artifacts, application icons, manual-dispatch cross-platform package jobs, SHA-256 generation, release-binary/package inspection, fail-closed evidence auditing, redacted evidence templates, and executable installation/accessibility/performance/safety/security/dogfood/beta procedures. The Phase 5 exit and release remain blocked on the recorded native and human gates.
- Added fail-closed Phase 6 publication preparation: exact manifest/package/checksum matching, explicit confirmation, a no-rebuild manual workflow, draft tag/source validation, draft-asset round-trip verification, fixed release notes with unsupported roadmap labels, and data-safety-first failure triage. Actual publication remains blocked on the complete Phase 5 gate.
- Strengthened the Phase 5 evidence contract with per-package core-journey checks, one network journey per OS family, per-platform accessibility matrices, and recomputed native performance statistics from retained raw samples.

### Changed

- Revised the `0.1.0` release envelope to Windows 11 x86-64 while preserving the complete SQLite/MySQL/MariaDB workflow; WSL2/Linux packages are engineering evidence and Windows 10/macOS/native Linux distribution is deferred.
- Made native owner checks, the fixed five-day dogfood checklist, and external beta explicit post-release validation for the sole initial participant without representing unperformed evidence as passed.
- Made the checksum-pinned five-server native fixture matrix the candidate-CI feasibility gate; the three-image Docker path remains a supplemental fail-closed smoke test and cannot weaken the TLS floor for a legacy image.
