# Changelog

All notable changes to QueryNot will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases will use [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once versioned application development begins.

## [Unreleased]

### Added

- Established the initial project identity, community policies, security guidance, contributor workflow, agent instructions, and GitHub contribution templates.
- Defined the planned initial-release product requirements, including legacy MySQL 5.7+ compatibility, architecture boundaries, safety constraints, acceptance criteria, and roadmap.
- Added the Phase 0 Rust/Tauri/Svelte/TypeScript scaffold, generated command contracts, release traceability and evidence foundations, cross-platform CI, security boundaries, and disposable database feasibility harnesses.
- Implemented the Phase 1 secure local foundation: non-secret profile metadata, optional OS-vault and session-only secrets, transactional application-store migrations, recoverable profile deletion, settings, redacted bounded diagnostics, native file grants, explicit runtime state machines and ownership checks, and an accessible offline draft-restoring workbench with no SQL execution path.
- Implemented the Phase 2 SQLite query vertical slice: explicit SQLite file profiles, isolated metadata and tab sessions, progressive cached schema browsing, a CodeMirror SQL editor, statement targeting and single-use destructive confirmations, manual transactions, native cancellation, acknowledged streaming with caps and cursor expiry, virtualized hostile-value-safe results, canonical copy, atomic CSV/JSON export, reload cleanup, and release-build reference benchmarking.
- Implemented Phase 3 MySQL-family parity through the common adapter contract: exact MySQL 5.7.44/8.0.46/8.4.10 and MariaDB 10.11.18/11.4.12 identity and lifecycle detection, direct fail-closed TLS, client certificates, tested password authentication, progressive metadata including routines, MySQL dialect/routine parsing, lossless edge values, multiple results, transaction and implicit-commit reconciliation, confirmed cancellation, query-only unknown-version safeguards, persistent legacy guidance, and cancellable connection setup.
