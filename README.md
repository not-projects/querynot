# QueryNot

![Built With AI Agents](https://img.shields.io/badge/built%20with-AI%20agents-ff9b54)
![Contribution Policy](https://img.shields.io/badge/contributions-AI%20generated-2f855a)

> **Query your data, not your patience.**

QueryNot is a local-first desktop SQL client focused on a fast, calm, and dependable workflow for working with databases.

## Project Status

QueryNot 0.1.6 is the current live cross-platform release on the dedicated signed-updater channel, with a PostNot-aligned desktop matrix: Windows x86-64 NSIS/MSI, Linux x86-64 AppImage/DEB/RPM, and macOS Intel/Apple-silicon DMGs, all backed by one combined signed updater feed. It keeps SQL editing stable, lazily opens isolated per-tab sessions, and discloses export safety guidance only when Export is expanded. The workbench keeps readable connection rows and compact schema navigation in the left sidebar, shows only the selected connection's query and object tabs above the workspace, opens local History in a right-side overlay drawer, and lays out returned rows directly below the persisted result splitter. Closing an active query stays within its current group. Result-row selection uses explicit checkboxes and visible selected-row copy actions, while a focused field opens through right-click or **Open value** in a soft-wrapping side subtab with lossless raw text and formatted JSON display. Shortcuts use Command on macOS and Control on Windows/Linux. UI-scale preview does not resize an already-open Settings dialog, scaled dialogs remain bounded and fully scrollable, and the hierarchy keeps Run dominant while secondary context stays quiet. Shared inline SVG controls replace font-symbol icons. Selecting a schema object opens a connection-scoped main-workspace tab with columns, types, keys, indexes, defaults, and generated fields; **Browse rows** remains a secondary, explicit mode that allocates no table session and fetches no data until chosen. The desktop workbench uses one capability-driven adapter flow for SQLite plus the exact MySQL/MariaDB release matrix, including direct TLS, detected identity/version, progressive metadata, dedicated query and table sessions, dialect-aware editing, history and SQL-file workflows, transactions, cancellation, acknowledged streaming, multiple results, lossless values, deterministic table browsing, and staged atomic mutations. Connection creation has one Server/File choice: an explicitly selected database file is detected through a read-only native probe and becomes an SQLite profile without filesystem scanning. Read-only and read-write SQLite profiles are supported; creating a new database file remains deferred.

Version `0.1.6` gives Connections and Schema an even, persisted draggable split; keeps schema search and refresh in compact labelled icon controls; sizes result columns from loaded content up to the established 180px cap; and adds table font and text-size settings. Well-formed MySQL 5.7.x versions are write-capable under the same transaction, destructive-query, bound-mutation, TLS, and legacy-warning safeguards. MySQL 5.7.44 remains the exact automated conformance fixture, so the wider 5.7.x behavior is not presented as independent patch certification.

The current live `0.1.6` distribution envelope is Windows 11 x86-64, Linux x86-64, and macOS 13 or later on Intel and Apple silicon. Version 0.1.1 added the dedicated QueryNot signed-updater channel; existing updater-enabled installations can discover `0.1.6`, while the first installation remains manual. Native hardware checks, dogfood, and external beta remain explicit follow-up evidence until performed.

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

The initial engine scope is SQLite, MySQL 5.7+ (with 5.7.44, 8.0, and 8.4 LTS as the tested lines), and MariaDB 10.11/11.4 LTS. MySQL 5.7 is a legacy compatibility target, not a recommendation to keep using an end-of-life server. The exact tested platform, database patch, authentication, and TLS matrix is published in the [compatibility matrix](docs/compatibility-matrix.md). See the [product requirements](docs/product-requirements.md) for the implementation and release gates.

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
npm run release:validate-updater-signing
npm run release:verify-updater-signature -- <payload> <payload.sig>
npm run release:create-updater-manifest -- --directory <bundle-dir> --output artifacts/release-candidate/latest.json --report artifacts/release-candidate/updater-manifest-report.json
npm run release:validate-update-candidate -- --directory <candidate-dir> --tag v0.1.6 --report artifacts/candidate-validation.json
npm run release:prepare-update-publication -- --directory <candidate-dir> --output artifacts/publication --tag v0.1.6 --confirm publish-v0.1.6 --report artifacts/publication-plan.json
```

`npm run verify:phase1` reruns the complete Phase 1 local gate from a clean committed tree and writes a commit-addressed evidence report. It does not substitute for post-release native Windows vault and accessibility observation.

`npm run verify:phase2` reruns the complete Phase 2 local gate from a clean committed tree, including the real read-only SQLite vertical journey, fault tests, 10,000-row virtualization test, 30-sample release benchmark, and production desktop build. It retains commit-addressed validation and benchmark reports, but does not substitute for post-release native Windows frame-rate, memory, accessibility, packaging, or manual safety observation.

`npm run test:conformance:phase3` verifies all five checksum-pinned MySQL/MariaDB archive fixtures through QueryNot's common adapter, including authentication, TLS/client identity, metadata, values, results, transactions, and cancellation. `npm run verify:phase3` runs this matrix plus the full local regression and desktop-build gate from a clean commit and retains commit-addressed reports.

`npm run test:conformance:phase4` extends the same exact five-server matrix with deterministic table paging, bound structured filters, typed staged inserts/updates/deletes, generated-value refresh, optimistic conflicts, and atomic rollback. `npm run verify:phase4` runs the full Phase 4 regression, dependency review, conformance, and desktop-build gate from a clean commit and retains commit-addressed validation, table-conformance, and dependency reports.

Phase 5 retained the historical unsigned Windows 11 x86-64 `0.1.0` NSIS artifact without updater material. WSL2 remains an automation environment, while `0.1.5` and later releases package Linux on Ubuntu and macOS on native Intel/Apple-silicon runners. `npm run test:ui-layout` exercises large/narrow status-bar geometry, all PostNot-aligned theme names, opaque dialog surfaces, a 200% Settings dialog inside a 600px-high viewport, stable CodeMirror node/focus behavior, dark completion contrast and Tab acceptance, platform-primary query execution, stable Settings controls during scale preview, compact non-stretched tabs, a main-workspace structure tab with lazy row browsing, synchronized wide results, the 20–70% split, and History overlay focus at 720–2048px plus retained 150%-scale workbench captures in Chromium. Follow the historical [unsigned installation guide](docs/release/unsigned-installation.md), [Phase 5 procedures](docs/release/phase5-manual-procedures.md), and current [signed update procedure](docs/release/signed-updates.md).

The retained `npm run verify:phase5:local` and `npm run test:release-evidence` paths belong to the immutable `0.1.0` source/evidence boundary; current post-release source is expected to fail their exact-source comparison. The signed `0.1.1` candidate, publication round trip, public-download hashes, and updater-key verification are retained separately under `evidence/release-updates/0.1.1`. Native interaction, dogfood, and beta remain post-release owner validation under the approved revision-2 scope.

The signed release workflow consumes one successful manually dispatched `CI` run on `master`. Candidate CI builds all four desktop targets, signs every updater payload with the dedicated QueryNot identity, inspects each package, and combines their exact bytes into one eight-key `latest.json` and seven-package checksum. Publication receives no signing secret, rejects substituted or extra public assets, independently verifies all updater signatures, stages the exact 18-asset release, and round-trip verifies a draft before making it stable. It never rebuilds or overwrites the reviewed candidate. [QueryNot 0.1.6](https://github.com/not-projects/querynot/releases/tag/v0.1.6) is the current live release produced by this path.

Release-candidate CI runs `npm run fixtures:fetch:native` and then `npm run test:feasibility:native`. This canonical Linux gate verifies the pinned archive checksums, installs nothing, exercises all five exact database targets over identity-verified TLS 1.2 on random loopback ports, and deletes the disposable servers and secrets after the run.

`npm run test:feasibility` remains an optional three-image Docker smoke harness. It never discovers an existing database, but it is not release evidence: an image whose legacy TLS stack cannot meet QueryNot's TLS floor is rejected rather than triggering a security downgrade. See [fixture isolation](docs/testing/fixture-isolation.md) before running database tests.

Rust dependency policy uses `cargo-deny 0.20.2`; CI installs that exact locked tool version before running `cargo deny check advisories licenses bans sources`.

These commands validate the current local implementation; only the published compatibility matrix and passing release audit establish a support claim.

## License

QueryNot is licensed under the [Apache License 2.0](LICENSE).
