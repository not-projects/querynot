# QueryNot Agent Guide

Operational context for coding agents and contributor tooling. This is the agent-facing companion to [README.md](README.md).

## Repository Role

QueryNot is a local-first desktop SQL client from Not Projects. Version 0.1.16 is the current live release on the signed-updater channel for Windows 11 x86-64, Linux x86-64, macOS Intel, and macOS Apple silicon.

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

Connection creation uses one immutable Server/File choice. One explicitly selected database file is probed read-only and detected as SQLite behind an opaque native grant; it is never discovered by scanning. SQL document actions live in the File menu. Safe window close is silent, while actionable native work keeps the window open and focuses its blocker. The persisted query/results split is pointer- and keyboard-resizable from 20–70%, with a scrollable three-and-a-half-row SQL viewport retained at the upper result bound.

Version 0.1.3 established stable CodeMirror editing, the unchanged flat workspace, and lazy isolated per-tab sessions. Version 0.1.4 released readable profile rows and schema navigation in the left sidebar, selected-profile or Offline compact tabs above the main workspace, local History in a right-side overlay drawer, and explicit editor/splitter/result tracks. Connect/Disconnect remain profile-level; selecting a query tab under a connected profile lazily opens that tab's isolated native session, while unused restored tabs remain offline. Selecting a schema object opens a connection-scoped structure tab in the main workspace through the profile metadata session; its secondary Browse rows mode opens the isolated table session and fetches data only when explicitly chosen. CSV safety guidance remains inside Export. Version 0.1.5 uses Command shortcuts on macOS and Control shortcuts on Windows/Linux while retaining the stable editor, bounded dialogs, shared SVG controls, and quiet workbench hierarchy.

Active-tab close stays in the owning connection or Offline group and creates an empty same-group query if needed. Result fields focus independently from explicit row checkboxes; selected-row copy actions are visible when relevant. Right-click or **Open value** opens one soft-wrapping side value subtab with lossless Raw/Copy behavior and bounded formatted JSON display. Schema namespace rows remain compact instead of stretching through unused sidebar height.

Version 0.1.6 treats every well-formed MySQL 5.7.x patch as write-capable with the existing legacy and safety controls; 5.7.44 remains the exact conformance fixture and other 5.7 patches disclose that distinction. Connections and Schema use a persisted 20–80% vertical split that defaults to 50%, routine schema copy and the Offline subtitle are removed, search and refresh use labelled SVG controls, short result columns auto-fit up to the existing 180px cap, and Settings persists table font family and 10–20px text size.

Version 0.1.7 rebalances the application header and connected workbench; groups execution, document, result, selection, copy, inspection, and export controls into consistent tiers; reorganizes Settings into natural-height purpose sections with persistent actions; and structures Add connection around endpoint, transport, credentials, and behavior. Optional client identity and credential fields stay progressively disclosed, SQLite starts with one explicitly selected file, file profiles omit reconnect controls, and current-view export captures its visible row indexes at activation instead of synchronizing them continuously.

Version 0.1.8 reworks Connections, Schema, and local History around one compact control tier, explicit connection states, quieter on-demand schema actions, readable query records, and progressively disclosed local-storage guidance without changing connection, metadata, or query-reopen behavior. Signed release automation reuses successful exact-commit CI, verifies GitHub-computed asset digests, and keeps full-package verification as an on-demand audit.

Version 0.1.9 completes the next workbench redesign iteration. Saved-connection, schema-object, and workspace-tab context actions share one compact keyboard menu with bounded positioning, reliable dismissal, focus return, and explicit destructive treatment. Tab movement and rename preserve the owning connection, native session, SQL, and results. Copy and Export are separated by intent, File owns SQL document commands, and Results distinguish running, statement-only, zero-row, filter-empty, cancelled, failed, and populated outcomes without changing native execution behavior or safety boundaries.

Version 0.1.10 extends SQL completion with context-scoped relation, column, alias, and engine-aware SQLite/MySQL/MariaDB function suggestions, including MySQL-version gates. Loaded statement-table metadata takes precedence, the last explicitly selected table supplies pre-`FROM` columns, Arrow/Page keys move through the popup, Tab accepts, and Enter remains a newline.

Version 0.1.11 mounts SQL completion at the themed application shell, lazily resolves missing referenced-table columns through the native metadata session for `SELECT` and `WHERE`, and treats an adapter-emitted cancellation as terminal even when separate MySQL-family server confirmation is unavailable, so cancelling a paused result cursor stops timing and unlocks the editor.

Version 0.1.12 preloads the active database/schema's relation names and a bounded set of table/view columns through the metadata session when a connection or query-tab context becomes active. Larger and temporarily unavailable catalogs retain the existing on-demand fallback.

Version 0.1.13 starts completion metadata warmup after connection and tab-session readiness without holding the connection action open, lets users dismiss out-of-matrix compatibility warnings for the current connection, and presents readable rejected or failed query errors in Results.

Version 0.1.14 ships the first compiled PostgreSQL adapter under ADR 0019 as a development preview. Server profiles can select PostgreSQL with the 5432 default and reuse the native TLS/client-identity, credential, timeout, and session boundaries. The adapter implements PostgreSQL 18.x identity classification, schema contexts, overloaded routines, dollar-quoted planning, typed/array results, cancellation, transactions, browsing, and guarded mutations. PostgreSQL 18.6 is the exact planned disposable baseline, but its dedicated conformance and support evidence remain pending; do not describe PostgreSQL as part of the live support matrix.

Version 0.1.15 adds bounded estimated Explain under ADR 0020. One labelled Explain action targets exactly one selection or caret statement, uses `EXPLAIN QUERY PLAN` on SQLite, `EXPLAIN FORMAT=JSON` on MySQL/MariaDB, and `EXPLAIN (FORMAT JSON)` in the PostgreSQL preview, then replaces Results with factual Tree/Raw views. Never generate or describe runtime `EXPLAIN ANALYZE` as part of this feature. Raw plans are not persisted in History; PostgreSQL remains a development preview.

Version 0.1.16 extends Explain under ADR 0021 with Graph-first normalized plans through 250 nodes, complete Tree and Raw fallbacks, and off-by-default local hotspot estimates derived from valid within-plan cost or row values. Never describe these relative bands as query quality, tuning advice, actual runtime, or duration prediction; layout, selection, zoom, and rankings remain ephemeral and are not persisted or logged.

CI uses fail-closed documentation, frontend, and native scopes. Frontend-only changes retain dependency, audit, Svelte, Chromium, unit, formatting, and production-build coverage without compiling unchanged desktop code. Native and unknown changes add one Linux Rust-quality lane, Windows core tests, dependency review, and Linux x86-64, Windows x86-64, macOS Intel, and macOS Apple-silicon compile checks. Stable purpose-specific Rust caches use dependency-aware keys that ignore only workspace version bumps, are saved only by `master`, and remain separate from the signed candidate's per-target release caches and exact-commit/no-rebuild trust boundary.

The current live `0.1.16` support and publication envelope is Windows 11 x86-64 NSIS/MSI, Linux x86-64 AppImage/DEB/RPM, and macOS 13-or-later Intel/Apple-silicon DMGs with signed updater payloads under ADR 0016. Version 0.1.1 established the dedicated QueryNot signed update channel under ADR 0011. Native hardware, vault, accessibility, performance, dogfood, and beta observations remain follow-up evidence and must never be represented as passed until performed.

## Verified Commands

- `npm install` — install the exact frontend/Tauri CLI lockfile.
- `npm run check` — Svelte and TypeScript diagnostics.
- `npm run test` — frontend/policy unit tests with a repository-local temporary directory.
- `npm run test:ui-layout` — Chromium regression checks for 720–2048px and 100–200% geometry; stable File/History/Settings utilities; bounded opaque Settings and Add connection dialogs with persistent actions, responsive sections, progressive security controls, and file-first SQLite setup; stable CodeMirror focus plus application-shell-hosted completion, preloaded current-context metadata with on-demand `SELECT`/`WHERE` fallback, Arrow-key completion navigation, Tab acceptance, and Enter-newline behavior; consistent execution, Explain, document, result, selection, copy, inspection, and export controls; explicit running, rowless, failed, zero-row, filter-empty, terminal paused-cursor cancellation, populated result, and estimated-plan Graph/Tree/Raw states with local hotspot annotations, bounded zoom, dense and Raw-only fallbacks, and exact raw copy; accessible command names, keyboard focus return, and a forced-colors focus/layout proxy; a centered persisted 20–80% Connections/Schema split; compact schema navigation; lazy structure-first object tabs; value-aware result widths and saved typography; synchronized wide results and 20–70% query/result splits; a bounded formatted-JSON value subtab; group-local active-tab close; and History overlay/focus behavior across PostNot themes. The pinned browser is installed once with `npx playwright install chromium`.
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
- `npm run test:conformance:phase3` — checksum-pinned, marker-verified five-server common-adapter conformance including TLS/client identity, authentication, metadata, results, transactions, cancellation, and non-mutating estimated Explain.
- `npm run verify:phase3` — clean-tree, commit-addressed Phase 3 conformance plus complete local regression, dependency, and desktop-build evidence generation; native Windows owner review remains a post-release non-claim.
- `npm run test:conformance:phase4` — the same exact five-server fixture matrix plus deterministic paging, bound structured filters, typed staged mutations, generated-value refresh, optimistic conflicts, and atomic rollback.
- `npm run verify:phase4` — clean-tree, commit-addressed Phase 4 conformance plus complete local regression, dependency review, and desktop-build evidence generation; native Windows owner review remains a post-release non-claim.
- `npm run release:validate-updater-signing` — fail closed unless the dedicated QueryNot updater public/private key environment is present and structurally valid; it never prints key material.
- `npm run release:verify-updater-signature -- <payload> <payload.sig>` — verify any Tauri Minisign updater payload and trusted-comment signature against `QUERYNOT_UPDATER_PUBLIC_KEY` without requiring the private key.
- `npm run release:inspect -- --binary <path> --directory <path> --expect <formats> --report <path>` — inspect one platform's nonempty packages, matching updater signature, binary material, CSP/capability boundary, version, and commit.
- `npm run release:checksums -- --directory <path> --output <path> --manifest <path>` — generate commit/version-addressed SHA-256 text and JSON records for the exact candidate packages.
- `npm run release:create-updater-manifest -- --directory <path> --output <latest.json> --report <report>` — generate the eight-key Windows/Linux/macOS updater manifest from the seven signed payloads and checked-in versioned release notes.
- `npm run release:validate-update-candidate -- --directory <candidate-dir> --tag v0.1.16 --report <report>` — validate the combined four-target candidate, seven installable packages, seven updater payload signatures, eight feed keys, retained inspections, and exact source/version evidence.
- `npm run test:conformance:phase5` — exact five-server candidate rerun retained separately from earlier phase evidence.
- `npm run release:prepare-update-publication -- --directory <candidate-dir> --output artifacts/publication --tag v0.1.16 --confirm publish-v0.1.16 --report <report>` — verify the candidate source, retained reports, hashes, manifest, and every updater signature, then stage exactly the 18 reviewed public assets.
- `npm run release:verify-asset-metadata -- --release <release.json> --plan <publication-plan.json> --version 0.1.16 --tag v0.1.16 --source <commit> --draft <true|false> --report <report>` — fail closed unless GitHub's exact release state, asset count, byte sizes, and server-computed SHA-256 digests match the staged publication plan; the signed-release workflow runs this before and after publication without downloading packages.
- `npm run release:verify-update-publication -- --directory <download-dir> --tag v0.1.16 --plan <publication-plan.json> --report <report>` — optional deep audit that downloads and cryptographically re-verifies all 18 public assets against the pre-draft plan; it is not part of routine publication.
- `npm run fixtures:fetch:native` then `npm run test:feasibility:native` — canonical checksum-pinned Linux feasibility gate used by candidate CI; bounded retries absorb transient mirror/transport errors without weakening the checksum, installs nothing, exercises all five exact targets on random loopback ports with verified TLS 1.2, and retains a redacted report.

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
