# QueryNot Agent Guide

Operational context for coding agents and contributor tooling. This is the agent-facing companion to [README.md](README.md).

## Repository Role

QueryNot is a pre-alpha, local-first desktop SQL client from Not Projects.

> Query your data, not your patience.

The planned stack is Rust, Tauri 2, Svelte, and TypeScript. Treat those choices as approved direction, but do not claim components, commands, database drivers, or supported engines exist until they are checked into this repository.

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

The repository contains the Phase 0 Rust/Tauri/Svelte/TypeScript scaffold, generated command-contract checks, a 121-row release traceability matrix, CI, and fail-closed disposable SQLite/MySQL/MariaDB feasibility harnesses. It is not yet a usable SQL client, and no compatibility row is a release support claim.

## Verified Commands

- `npm install` — install the exact frontend/Tauri CLI lockfile.
- `npm run check` — Svelte and TypeScript diagnostics.
- `npm run test` — frontend/policy unit tests with a repository-local temporary directory.
- `npm run build` — production frontend build.
- `npm run test:contracts` — generated Rust/TypeScript command contract drift check.
- `npm run test:traceability` — PRD/matrix coverage and evidence invariant check.
- `npm run test:dependencies` — exact npm source, integrity, version-pin, and license policy check.
- `cargo fmt --all -- --check` — Rust formatting.
- `cargo check --workspace --all-targets` — native compile gate.
- `cargo test --workspace` — Rust unit and SQLite feasibility tests.
- `cargo deny check advisories licenses bans sources` — Rust advisory, license, wildcard, and source policy using `cargo-deny 0.20.2`.
- `npm run tauri -- build` — production desktop binary build; Phase 0 has bundling disabled.
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
