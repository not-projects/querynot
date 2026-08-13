# QueryNot

![Built With AI Agents](https://img.shields.io/badge/built%20with-AI%20agents-ff9b54)
![Contribution Policy](https://img.shields.io/badge/contributions-AI%20generated-2f855a)

> **Query your data, not your patience.**

QueryNot is a planned local-first desktop SQL client focused on a fast, calm, and dependable workflow for working with databases.

## Project Status

QueryNot is in pre-alpha development. The repository contains the Phase 0 Rust/Tauri/Svelte/TypeScript scaffold, release traceability, and disposable adapter-feasibility harness. It does not yet contain a usable database workflow or a release-tested support matrix.

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
npm run tauri -- build
```

`npm run test:feasibility` additionally requires Docker and starts only generated disposable MySQL/MariaDB fixtures on random loopback ports. It never discovers an existing database. See [fixture isolation](docs/testing/fixture-isolation.md) before running database tests.

Linux hosts without Docker can run `npm run fixtures:fetch:native` once, then `npm run test:feasibility:native`. The fallback verifies pinned archive checksums, installs nothing, uses identity-verified TLS 1.2 on random loopback ports, and deletes the disposable servers and secrets after the run.

Rust dependency policy uses `cargo-deny 0.20.2`; CI installs that exact locked tool version before running `cargo deny check advisories licenses bans sources`.

These commands validate the current foundation; they do not imply that the Phase 1–6 product behavior or release compatibility matrix is complete.

## License

QueryNot is licensed under the [Apache License 2.0](LICENSE).
