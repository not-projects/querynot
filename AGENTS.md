# QueryNot Agent Guide

Operational context for coding agents and contributor tooling. This is the agent-facing companion to [README.md](README.md).

## Repository Role

QueryNot is a local-first desktop SQL client from Not Projects. Version 0.1.3 is the current published Windows 11 x86-64 release on the signed-updater channel.

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

The repository contains the completed Phase 0–6 implementation and release evidence. The native surface uses one adapter contract for SQLite and the exact MySQL/MariaDB release matrix, with isolated metadata/tab sessions, fail-closed direct TLS and client identities, detected compatibility, progressive schema metadata/cache, dialect planning, transactions/implicit commits, confirmed cancellation, bounded acknowledged result streaming, multiple results, typed values, atomic received-row export, local history/workspace/file safety, deterministic table paging, bound filters, immutable mutation plans, optimistic conflict predicates, and atomic staged edits. The Svelte workbench uses CodeMirror and virtualized query/table grids.

Connection creation uses one immutable Server/File choice. One explicitly selected database file is probed read-only and detected as SQLite behind an opaque native grant; it is never discovered by scanning. SQL document actions live in the File menu. Safe window close is silent, while actionable native work keeps the window open and focuses its blocker. The persisted query/results split is pointer- and keyboard-resizable from 20–70%.

Version 0.1.3 established stable CodeMirror editing, the unchanged flat workspace, and lazy isolated per-tab sessions. The current unreleased workbench presents readable profile rows and schema navigation in the left sidebar, shows only the selected profile or Offline group's compact tabs above the main workspace, opens local History in a right-side overlay drawer, and uses explicit editor/splitter/result tracks. Connect/Disconnect remain profile-level; selecting a query tab under a connected profile lazily opens that tab's isolated native session, while unused restored tabs remain offline. Selecting a schema object opens a connection-scoped structure tab in the main workspace through the profile metadata session; its secondary Browse rows mode opens the isolated table session and fetches data only when explicitly chosen. CSV safety guidance remains inside Export. Literal Ctrl shortcuts drive execution and document actions; UI scale preview leaves the open Settings dialog at its opening scale; scaled dialogs stay viewport-bounded and fully scrollable; shared SVG controls replace font-symbol icons; and the visual hierarchy keeps Run dominant while secondary metadata and controls stay quiet.

Active-tab close stays in the owning connection or Offline group and creates an empty same-group query if needed. Result fields focus independently from explicit row checkboxes; selected-row copy actions are visible when relevant. Right-click or **Open value** opens one soft-wrapping side value subtab with lossless Raw/Copy behavior and bounded formatted JSON display. Schema namespace rows remain compact instead of stretching through unused sidebar height.

The approved support and publication envelope is Windows 11 x86-64 only. WSL2/browser automation and Linux engineering packages are release-development evidence, not application support claims. Version 0.1.1 established the dedicated QueryNot signed update channel under ADR 0011; version 0.1.3 is the current published release. Native owner checks, fixed dogfood, and external beta are explicit post-release validation under ADR 0010 and must never be represented as already performed.

## Verified Commands

- `npm install` — install the exact frontend/Tauri CLI lockfile.
- `npm run check` — Svelte and TypeScript diagnostics.
- `npm run test` — frontend/policy unit tests with a repository-local temporary directory.
- `npm run test:ui-layout` — Chromium regression checks for 720–2048px and 100–150% workbench geometry, a fully reachable 200% Settings dialog in a 600px-high viewport, PostNot theme names, opaque themed dialogs, stable CodeMirror node/focus behavior, dark completion contrast and Enter/Tab behavior, literal Ctrl execution, stable Settings controls during scale preview, compact non-stretched tabs, compact schema namespaces, a main-workspace schema structure tab with lazy row browsing, synchronized wide results and 20–70% splits, explicit row-selection actions, a bounded soft-wrapping formatted-JSON value subtab, group-local active-tab close, plus History overlay/focus behavior; the retained evidence includes 1915×1237 captures at 150% scale, and the pinned browser is installed once with `npx playwright install chromium`.
- `npm run build` — production frontend build.
- `npm run test:contracts` — generated Rust/TypeScript command contract drift check.
- `npm run test:traceability` — PRD/matrix coverage and evidence invariant check.
- `npm run test:dependencies` — exact npm source, integrity, version-pin, and license policy check.
- `cargo fmt --all -- --check` — Rust formatting.
- `cargo check --workspace --all-targets` — native compile gate.
- `cargo test --workspace` — Rust unit and SQLite feasibility tests.
- `cargo deny check advisories licenses bans sources` — Rust advisory, license, wildcard, and source policy using `cargo-deny 0.20.2`.
- `npm run tauri -- build --no-bundle` — production desktop binary build without packaging.
- `npm run verify:phase1` — clean-tree, commit-addressed Phase 1 local validation and evidence generation; post-release native Windows vault and accessibility observation remains a non-claim.
- `npm run benchmark:phase2` — 30-sample release-build SQLite ordinary-result first-batch benchmark after one discarded setup run.
- `npm run verify:phase2` — clean-tree, commit-addressed Phase 2 local validation, benchmark, desktop build, and evidence generation; post-release native Windows performance and manual review remains a non-claim.
- `npm run test:conformance:phase3` — checksum-pinned, marker-verified five-server common-adapter conformance including TLS/client identity, authentication, metadata, results, transactions, and cancellation.
- `npm run verify:phase3` — clean-tree, commit-addressed Phase 3 conformance plus complete local regression, dependency, and desktop-build evidence generation; native Windows owner review remains a post-release non-claim.
- `npm run test:conformance:phase4` — the same exact five-server fixture matrix plus deterministic paging, bound structured filters, typed staged mutations, generated-value refresh, optimistic conflicts, and atomic rollback.
- `npm run verify:phase4` — clean-tree, commit-addressed Phase 4 conformance plus complete local regression, dependency review, and desktop-build evidence generation; native Windows owner review remains a post-release non-claim.
- `npm run release:validate-updater-signing` — fail closed unless the dedicated QueryNot updater public/private key environment is present and structurally valid; it never prints key material.
- `npm run release:verify-updater-signature -- <installer.exe> <installer.exe.sig>` — verify the Tauri Minisign installer and trusted-comment signatures against `QUERYNOT_UPDATER_PUBLIC_KEY` without requiring the private key.
- `npm run release:inspect -- --binary <path> --directory <path> --expect <formats> --report <path>` — inspect one platform's nonempty packages, matching updater signature, binary material, CSP/capability boundary, version, and commit.
- `npm run release:checksums -- --directory <path> --output <path> --manifest <path>` — generate commit/version-addressed SHA-256 text and JSON records for the exact candidate packages.
- `npm run release:create-updater-manifest -- --directory <path> --output <latest.json> --report <report>` — generate the stable Windows updater manifest from exactly one signed NSIS candidate and the checked-in versioned release notes.
- `npm run test:conformance:phase5` — exact five-server candidate rerun retained separately from earlier phase evidence.
- `npm run release:prepare-update-publication -- --directory <candidate-dir> --output artifacts/publication --tag v0.1.3 --confirm publish-v0.1.3 --report <report>` — verify the candidate source, retained reports, hashes, manifest, and updater signature, then stage exactly the installer, signature, `latest.json`, and checksum.
- `npm run release:verify-update-publication -- --directory <download-dir> --tag v0.1.3 --report <report>` — cryptographically and byte-for-byte verify the four draft or public assets; the manual signed-release workflow runs this before publication.
- `npm run fixtures:fetch:native` then `npm run test:feasibility:native` — canonical checksum-pinned Linux feasibility gate used by candidate CI; installs nothing, exercises all five exact targets on random loopback ports with verified TLS 1.2, and retains a redacted report.

`npm run test:feasibility` is a supplemental three-image Docker smoke harness, not release evidence. A legacy image that cannot negotiate QueryNot's TLS floor must fail rather than weaken the adapter.

The retained `npm run verify:phase5:local`, `npm run test:release-evidence`, and unsigned publication commands are historical `0.1.0` boundaries. They intentionally reject current post-release source and must not be rewritten to make the immutable initial-release evidence appear current.

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
