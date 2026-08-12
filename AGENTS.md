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

The repository currently contains project policy, product documentation, and an Apache-2.0 license. The application scaffold has not been created yet.

Do not invent build, test, lint, packaging, or release commands. Once configuration files exist, derive commands from checked-in scripts and tool configuration, run them, and update this guide with verified instructions.

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
