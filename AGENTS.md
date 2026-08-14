# QueryNot Agent Guide

Operational context for coding agents and contributor tooling. This is the agent-facing companion to [README.md](README.md).

## Repository Role

QueryNot is a pre-alpha, local-first desktop SQL client from Not Projects.

> Query your data, not your patience.

The implemented stack is Rust, Tauri 2, Svelte, and TypeScript. Continue to verify checked-in commands, adapters, and evidence before describing any behavior or support claim.

## Canonical Working Directory

Use this project root:

`/home/tansdf/gitreps/querynot`

Windows-side equivalent:

`\\wsl.localhost\Ubuntu\home\tansdf\gitreps\querynot`

## Start Here

For every task, read:

- [README.md](README.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)
- [CHANGELOG.md](CHANGELOG.md)
- the relevant architecture or product document under `docs/`

Then inspect the actual repository state and current branch before proposing changes.

## Current State

The repository contains implemented Phases 0–4 and Phase 5–6 validation/publication tooling. The native surface uses one adapter contract for SQLite and the exact MySQL/MariaDB development matrix, with isolated metadata/tab sessions, fail-closed direct TLS and client identities, detected compatibility, progressive schema metadata/cache, dialect planning, transactions/implicit commits, confirmed cancellation, bounded acknowledged result streaming, multiple results, typed values, atomic received-row export, local history/workspace/file safety, deterministic table paging, bound filters, immutable mutation plans, optimistic conflict predicates, and atomic staged edits. The Svelte workbench uses CodeMirror and virtualized query/table grids.

The approved `0.1.0` support and publication envelope is Windows 11 x86-64 only. WSL2/browser automation and Linux engineering packages are release-development evidence, not application support claims. Native owner checks, fixed dogfood, and external beta are explicit post-release validation under ADR 0010 and must never be represented as already performed.

## Verified Commands

- `npm install` — install the exact frontend/Tauri CLI lockfile.
- `npm run check` — Svelte and TypeScript diagnostics.
- `npm run test` — frontend/policy unit tests with a repository-local temporary directory.
- `npm run test:ui-layout` — Chromium regression checks for large/narrow status-bar geometry, PostNot theme names, and opaque themed dialogs; install the pinned browser once with `npx playwright install chromium`.
- `npm run build` — production frontend build.
- `npm run test:contracts` — generated Rust/TypeScript command contract drift check.
- `npm run test:traceability` — PRD/matrix coverage and evidence invariant check.
- `npm run test:dependencies` — exact npm source, integrity, version-pin, and license policy check.
- `cargo fmt --all -- --check` — Rust formatting.
- `cargo check --workspace --all-targets` — native compile gate.
- `cargo test --workspace` — Rust unit and SQLite feasibility tests.
- `cargo deny check advisories licenses bans sources` — Rust advisory, license, wildcard, and source policy using `cargo-deny 0.20.2`.
- `npm run tauri -- build --no-bundle` — production desktop binary build without packaging.
- `npm run verify:phase1` — clean-tree, commit-addressed Phase 1 local validation and evidence generation; real OS-vault and manual target-platform procedures remain separate gates.
- `npm run benchmark:phase2` — 30-sample release-build SQLite ordinary-result first-batch benchmark after one discarded setup run.
- `npm run verify:phase2` — clean-tree, commit-addressed Phase 2 local validation, benchmark, desktop build, and evidence generation; native target-platform performance and manual review remain separate gates.
- `npm run test:conformance:phase3` — checksum-pinned, marker-verified five-server common-adapter conformance including TLS/client identity, authentication, metadata, results, transactions, and cancellation.
- `npm run verify:phase3` — clean-tree, commit-addressed Phase 3 conformance plus complete local regression, dependency, and desktop-build evidence generation; target-platform release procedures remain separate gates.
- `npm run test:conformance:phase4` — the same exact five-server fixture matrix plus deterministic paging, bound structured filters, typed staged mutations, generated-value refresh, optimistic conflicts, and atomic rollback.
- `npm run verify:phase4` — clean-tree, commit-addressed Phase 4 conformance plus complete local regression, dependency review, and desktop-build evidence generation; target-platform release procedures remain separate gates.
- `npm run package:linux` — production x86-64 Debian and AppImage candidate build through the checksum-pinned release-tool cache; requires AppImage mount/tooling access and does not prove installation compatibility.
- `npm run release:inspect -- --binary <path> --directory <path> --expect <formats> --report <path>` — inspect one platform's nonempty packages, binary material, CSP/capability boundary, version, commit, and updater state.
- `npm run release:checksums -- --directory <path> --output <path> --manifest <path>` — generate commit/version-addressed SHA-256 text and JSON records for the exact candidate packages.
- `npm run test:release-evidence` — final fail-closed revision-2 audit; expected to fail until the exact Windows artifact/checksum, complete WSL2/browser automation, all 121 verified traceability rows, product-owner scope record, and ready release manifest exist.
- `npm run test:conformance:phase5` — exact five-server candidate rerun retained separately from earlier phase evidence.
- `npm run verify:phase5:local` — clean-tree WSL2 regression, UI layout, dependency, conformance, isolated Linux engineering packaging, artifact-inspection, and checksum gate; requires `cargo-deny 0.20.2` on `PATH` and does not replace the Windows package gate.
- `npm run release:prepare-publication -- --directory <candidate-dir> --output artifacts/publication --tag v0.1.0 --confirm publish-v0.1.0 --report <report>` — after the complete Phase 5 gate only, verify and stage the exact reviewed Windows installer plus retained checksum; it is expected to fail while evidence is incomplete.
- `npm run release:verify-publication -- --directory <download-dir> --tag v0.1.0 --report <report>` — round-trip verify the draft release bytes before publication; this is run by the manual Phase 6 workflow.
- `npm run test:feasibility` — exact disposable network-database feasibility run; requires Docker and retains a redacted report.
- `npm run fixtures:fetch:native` then `npm run test:feasibility:native` — checksum-pinned Linux fallback that installs nothing, uses random loopback ports and verified TLS, and retains the same redacted report.

Do not invent additional build, test, packaging, or release commands. Derive changes from checked-in scripts and configuration, verify them, and update this guide.

## Architectural Guardrails

- Keep QueryNot local-first unless a scoped, approved design says otherwise.
- Keep database connectivity and sensitive native operations in Rust behind explicit Tauri command boundaries.
- Keep Svelte components focused on presentation and interaction; do not move credentials or database-driver responsibilities into browser code.
- Do not add telemetry, accounts, cloud synchronization, hosted storage, or remote services without explicit design approval.
- Prefer small modules with clear responsibilities and typed interfaces.
- Treat shared UI extraction from PostNot as a separate project; do not copy implementation blindly or create premature shared packages.
- Describe only behavior that exists. Keep planned behavior clearly labeled in design documents rather than presenting it as implemented.

## Database and Secret Safety

- Never commit or log passwords, tokens, connection strings, private certificates, production data, or unredacted database output.
- Use synthetic fixtures and disposable databases in tests.
- Ensure automated tests cannot discover or connect to databases outside their explicit fixtures.
- Treat TLS verification changes, credential storage, destructive-query confirmation, history, exports, diagnostics, and local-file access as security-sensitive.
- Never weaken certificate validation or destructive-operation safeguards merely to make a test pass.
- Keep secrets out of frontend state and persisted data unless an approved design defines a protected storage boundary.

## Working Rules

- Preserve user changes and unrelated work in a dirty tree.
- Keep changes focused on the approved issue or plan.
- Use tests for application behavior once a test harness exists.
- Update [CHANGELOG.md](CHANGELOG.md) under `Unreleased` for user-visible changes.
- Update public and agent documentation when behavior or verified commands change.
- Record material architecture decisions under `docs/`.
- Run relevant validation before claiming completion and report any skipped checks.

## Repository Hygiene

- Use [README.md](README.md) for user-facing product messaging.
- Use [AGENTS.md](AGENTS.md) for current operational instructions.
- Use [SECURITY.md](SECURITY.md) for disclosure policy and security priorities.
- Keep generated output, local database files, credentials, logs, and tool state out of Git.
- Do not edit [LICENSE](LICENSE) unless the licensing decision changes explicitly.
