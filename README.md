# QueryNot

![Built With AI Agents](https://img.shields.io/badge/built%20with-AI%20agents-ff9b54)
![Contribution Policy](https://img.shields.io/badge/contributions-AI%20generated-2f855a)

> **Query your data, not your patience.**

QueryNot is a planned local-first desktop SQL client focused on a fast, calm, and dependable workflow for working with databases.

## Project Status

QueryNot is in pre-alpha development. The repository contains the Phase 0 scaffold, the locally validated Phase 1 secure foundation, the Phase 2 SQLite vertical slice, and implemented Phase 3 MySQL-family parity. The desktop workbench uses one capability-driven adapter flow for SQLite plus the exact MySQL/MariaDB development matrix, including direct TLS, detected identity/version, progressive metadata, dedicated query-tab sessions, transactions, cancellation, acknowledged streaming, multiple results, and lossless values. This is development behavior, not a release-tested support claim: productivity and safe table editing, target-platform evidence, packaging, dogfood, and beta gates remain incomplete.

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

The planned initial engine scope is SQLite, MySQL 5.7+ (with 5.7.44, 8.0, and 8.4 LTS as the initial tested lines), and MariaDB 10.11/11.4 LTS. MySQL 5.7 is a legacy compatibility target, not a recommendation to keep using an end-of-life server. This is a product plan, not a shipped support claim; the exact tested platform, database patch, authentication, and TLS matrix must be published before a release candidate. See the [product requirements](docs/product-requirements.md) for the implementation and release gates.

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
npm run test:dependencies
npm run build
cargo test --workspace
npm run benchmark:phase2
npm run test:conformance:phase3
npm run tauri -- build
```

`npm run verify:phase1` reruns the complete Phase 1 local gate from a clean committed tree and writes a commit-addressed evidence report. It does not substitute for the pending Windows/macOS/Linux OS-vault and manual accessibility procedures.

`npm run verify:phase2` reruns the complete Phase 2 local gate from a clean committed tree, including the real read-only SQLite vertical journey, fault tests, 10,000-row virtualization test, 30-sample release benchmark, and production desktop build. It retains commit-addressed validation and benchmark reports, but does not substitute for Phase 5 native WebView frame-rate, memory, accessibility, packaging, or manual safety procedures.

`npm run test:conformance:phase3` verifies all five checksum-pinned MySQL/MariaDB archive fixtures through QueryNot's common adapter, including authentication, TLS/client identity, metadata, values, results, transactions, and cancellation. `npm run verify:phase3` runs this matrix plus the full local regression and desktop-build gate from a clean commit and retains commit-addressed reports.

`npm run test:feasibility` additionally requires Docker and starts only generated disposable MySQL/MariaDB fixtures on random loopback ports. It never discovers an existing database. See [fixture isolation](docs/testing/fixture-isolation.md) before running database tests.

Linux hosts without Docker can run `npm run fixtures:fetch:native` once, then `npm run test:feasibility:native`. The fallback verifies pinned archive checksums, installs nothing, uses identity-verified TLS 1.2 on random loopback ports, and deletes the disposable servers and secrets after the run.

Rust dependency policy uses `cargo-deny 0.20.2`; CI installs that exact locked tool version before running `cargo deny check advisories licenses bans sources`.

These commands validate the current local implementation; they do not imply that cross-platform exit evidence, Phase 4–6 behavior, or the release compatibility matrix is complete.

## License

QueryNot is licensed under the [Apache License 2.0](LICENSE).
