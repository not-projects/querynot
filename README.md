# QueryNot

![Built With AI Agents](https://img.shields.io/badge/built%20with-AI%20agents-ff9b54)
![Contribution Policy](https://img.shields.io/badge/contributions-AI%20generated-2f855a)

> **Query your data, not your patience.**

QueryNot is a local-first desktop SQL client focused on a fast, calm, and dependable workflow for working with databases.

## Project Status

QueryNot is in pre-release development. The repository contains the Phase 0 scaffold, Phase 1 secure foundation, Phase 2 SQLite vertical slice, Phase 3 MySQL-family parity, Phase 4 productivity and safe-data-editing, and Phase 5–6 validation/publication tooling. The desktop workbench uses one capability-driven adapter flow for SQLite plus the exact MySQL/MariaDB development matrix, including direct TLS, detected identity/version, progressive metadata, dedicated query and table sessions, dialect-aware editing, history and SQL-file workflows, transactions, cancellation, acknowledged streaming, multiple results, lossless values, deterministic table browsing, and staged atomic mutations. Existing SQLite database files are opened directly through the native file chooser as SQLite connections; read-only and read-write profiles are supported.

The approved `0.1.0` release envelope is Windows 11 x86-64 only. WSL2 and Linux package builds are engineering evidence, not supported application platforms or public release artifacts. Native owner checks, five-day dogfood, and external beta follow the first release and remain explicitly unperformed until they occur.

The planned application stack is:

- Rust for native database and application services
- Tauri 2 for the desktop shell
- Svelte and TypeScript for the user interface

## Product Direction

QueryNot is being designed around a small set of principles:

- **Fast by default:** Opening a connection, writing SQL, running it, and inspecting results should feel immediate.
- **Simple without being limiting:** Common work should stay obvious while advanced tools remain available when needed.
- **Local-first:** Connection profiles, query history, and workspace state should remain on the user's machine unless a future feature explicitly says otherwise.
- **Safe around data:** Credentials, destructive statements, exports, logs, and diagnostics require deliberate handling.
- **Desktop-native:** Database work belongs in a focused application, not another crowded browser tab.

The initial engine scope is SQLite, MySQL 5.7+ (with 5.7.44, 8.0, and 8.4 LTS as the tested lines), and MariaDB 10.11/11.4 LTS. MySQL 5.7 is a legacy compatibility target, not a recommendation to keep using an end-of-life server. The exact tested platform, database patch, authentication, and TLS matrix is frozen before publication. See the [product requirements](docs/product-requirements.md) for the implementation and release gates.

## AI-Generated Project

QueryNot follows the Not Projects contribution model: repository contributions submitted through pull requests must be generated with AI tooling and reviewed by a human before submission.

Humans remain responsible for product direction, prompts, review, testing, legal compliance, and merge decisions. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full policy.

## Project Documents

- [Product requirements](docs/product-requirements.md)
- [Contributing guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [Agent guide](AGENTS.md)
- [License](LICENSE)

## Development

The verified foundation commands are:

```sh
npm install
npm run check
npm run test
npm run test:ui-layout
npm run test:dependencies
npm run build
cargo test --workspace
npm run benchmark:phase2
npm run test:conformance:phase3
npm run test:conformance:phase4
npm run tauri -- build --no-bundle
npm run test:release-evidence
npm run verify:phase5:local
npm run release:prepare-publication -- --directory <candidate-dir> --output artifacts/publication --tag v0.1.0 --confirm publish-v0.1.0 --report artifacts/publication-plan.json
```

`npm run verify:phase1` reruns the complete Phase 1 local gate from a clean committed tree and writes a commit-addressed evidence report. It does not substitute for the pending Windows/macOS/Linux OS-vault and manual accessibility procedures.

`npm run verify:phase2` reruns the complete Phase 2 local gate from a clean committed tree, including the real read-only SQLite vertical journey, fault tests, 10,000-row virtualization test, 30-sample release benchmark, and production desktop build. It retains commit-addressed validation and benchmark reports, but does not substitute for Phase 5 native WebView frame-rate, memory, accessibility, packaging, or manual safety procedures.

`npm run test:conformance:phase3` verifies all five checksum-pinned MySQL/MariaDB archive fixtures through QueryNot's common adapter, including authentication, TLS/client identity, metadata, values, results, transactions, and cancellation. `npm run verify:phase3` runs this matrix plus the full local regression and desktop-build gate from a clean commit and retains commit-addressed reports.

`npm run test:conformance:phase4` extends the same exact five-server matrix with deterministic table paging, bound structured filters, typed staged inserts/updates/deletes, generated-value refresh, optimistic conflicts, and atomic rollback. `npm run verify:phase4` runs the full Phase 4 regression, dependency review, conformance, and desktop-build gate from a clean commit and retains commit-addressed validation, table-conformance, and dependency reports.

Phase 5 prepares the unsigned Windows 11 x86-64 NSIS release artifact without updater material. WSL2 is the approved local automation environment, not a supported application platform or public package source. `npm run test:ui-layout` exercises large/narrow status-bar geometry, all PostNot-aligned theme names, and opaque dialog surfaces in Chromium. `npm run test:release-evidence` remains fail-closed until the Windows package, exact checksum, commit-addressed automation, revised traceability, manifest, and product-owner scope record agree. Follow the [unsigned installation guide](docs/release/unsigned-installation.md) and [Phase 5 procedures](docs/release/phase5-manual-procedures.md).

`npm run verify:phase5:local` reruns the complete WSL2 regression, automated UI layout gate, exact dependency gates, and five-server candidate conformance. It does not substitute for the required Windows NSIS construction and inspection. Native interaction, dogfood, and beta remain post-release owner validation under the approved revision-2 scope.

The Phase 6 publication command is intended for the manual release workflow after the Phase 5 gate. It reruns that gate, rejects substituted or extra artifacts, stages only the reviewed Windows installer and retained checksum file, and requires an exact release confirmation. The workflow creates and round-trip verifies a draft before publication; it never rebuilds or overwrites a candidate.

Release-candidate CI runs `npm run fixtures:fetch:native` and then `npm run test:feasibility:native`. This canonical Linux gate verifies the pinned archive checksums, installs nothing, exercises all five exact database targets over identity-verified TLS 1.2 on random loopback ports, and deletes the disposable servers and secrets after the run.

`npm run test:feasibility` remains an optional three-image Docker smoke harness. It never discovers an existing database, but it is not release evidence: an image whose legacy TLS stack cannot meet QueryNot's TLS floor is rejected rather than triggering a security downgrade. See [fixture isolation](docs/testing/fixture-isolation.md) before running database tests.

Rust dependency policy uses `cargo-deny 0.20.2`; CI installs that exact locked tool version before running `cargo deny check advisories licenses bans sources`.

These commands validate the current local implementation; only the published compatibility matrix and passing release audit establish a support claim.

## License

QueryNot is licensed under the [Apache License 2.0](LICENSE).
