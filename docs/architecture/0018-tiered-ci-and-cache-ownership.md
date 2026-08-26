# ADR 0018: Tiered CI and cache ownership

- Status: Accepted
- Date: 2026-08-26
- Decision owner: QueryNot product owner
- Supersedes: The ordinary-CI scope, native-matrix, and cache-ownership details in ADR 0017

## Context

The `0.1.8` release-source CI used 13 job instances. Five operating systems each ran the same `querynot-core` test and Clippy commands, then five desktop jobs compiled the workspace again before the signed candidate compiled four release packages. The successful source CI took 5 minutes 25 seconds, while the candidate took 14 minutes and was gated by its 13-minute macOS Intel package job.

Rust caching also followed the cache action's automatic job-name key. The repository accumulated 22 Rust cache entries totaling 8.62 GiB, and the macOS Intel candidate could not restore a cache produced by the preceding exact-commit desktop job because the two job names selected different cache families. Pull requests could also write new cache entries even though `master` is the durable source of reusable build state.

The exact-commit candidate, signed-package inspection, human review, and no-rebuild publication controls protect a distinct trust boundary and are not CI duplication. Blacksmith or another external runner provider would add a new execution and secret-handling boundary without first removing the repository's avoidable work.

## Decision

CI classifies every commit into one of three fail-closed scopes:

- `documentation` runs contracts, traceability, unit tests, and formatting;
- `frontend` adds dependency policy, audit, Svelte diagnostics, Chromium layout coverage, and the production frontend build;
- `native` adds Rust formatting, Linux core tests and Clippy, dependency policy, Windows core tests, and one desktop compile on Linux x86-64, Windows x86-64, macOS Intel, and macOS Apple silicon.

Only an explicit allowlist can select `frontend`. It covers the Svelte source tree, static assets, frontend entry/configuration files, and the existing frontend test runners. Workflow, dependency, Rust, Tauri, packaging, versioned release-note, unknown, malformed, empty, or unavailable-base changes select `native`. Documentation may accompany a frontend change without escalating it; any native or unknown path escalates the complete commit.

Rust quality has one Linux owner. Clippy is not repeated on platforms where it checks the same portable crate. Windows retains a core-test run because filesystem and path behavior differs materially. macOS platform-specific Tauri code remains compiled on both architectures. Linux packaging continues to target Ubuntu 22.04; a second Ubuntu 24.04 desktop compile is not treated as runtime-compatibility evidence.

Each Rust cache has one stable, purpose-specific `shared-key`. CI platform caches, Linux quality/tool caches, release feasibility, and signed release packages remain separate so concurrent jobs do not race to save different contents under one immutable key. A checked-in dependency key includes the external Cargo lock graph, dependency/features/profile configuration, Rust toolchain/configuration, and relevant Cargo/compiler environment, but excludes workspace-package and internal-path version bumps that cannot invalidate dependency build artifacts. Pull requests restore caches but only successful `master` pushes save CI caches. Candidate jobs retain their own per-target release cache families.

The release workflows remain on GitHub-hosted runners. Candidate dispatch still requires a successful push-triggered CI run for the exact unchanged `master` commit. Candidate packaging, signature verification, evidence retention, publication without the signing key, GitHub digest verification, and optional deep audit are unchanged.

## Consequences

- Native CI uses eight job instances instead of thirteen while retaining both macOS architectures, Windows, the oldest Linux packaging environment, Rust quality, dependency review, and frontend/browser coverage.
- Frontend-only changes no longer spend Windows and macOS runner time compiling unchanged Rust and Tauri sources.
- Cache families express platform and purpose instead of incidental workflow job names, and pull requests cannot fragment the durable cache set.
- A release-only application version bump can restore the preceding dependency cache; dependency, feature, toolchain, profile, compiler-environment, or registry-lock changes create a new immutable key.
- Versioned release notes and all release, dependency, workflow, packaging, and unknown inputs still fail closed to native CI.
- Candidate duration remains bounded by signed platform packaging, especially macOS Intel. Faster or third-party runners remain a separate measured migration after the simplified baseline is established.
- CI timing and cache-hit improvements require observation on subsequent hosted runs; local validation can prove policy, workflow structure, and commands but not hosted-runner performance.
