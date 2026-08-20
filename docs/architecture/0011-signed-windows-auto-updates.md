# ADR 0011: Signed Windows automatic-update channel

- Status: Accepted
- Date: 2026-08-14
- Decision owner: QueryNot product owner
- Extends: [ADR 0010](0010-windows-first-release-validation-boundary.md)

## Context

QueryNot `0.1.0` intentionally shipped without updater material. The product owner subsequently authorized an automatic-update channel based on PostNot's healthy Tauri updater pattern and a `0.1.1` release preparation. The update channel must preserve QueryNot's Windows-only support boundary, local-first product model, exact-candidate publication controls, and application close safeguards.

An updater signature establishes that an installer was produced by the holder of QueryNot's updater key. It is separate from Windows Authenticode code signing, which is not part of this release. Reusing PostNot's private key would unnecessarily couple the trust and recovery boundary of two products.

## Decision

QueryNot uses the Tauri 2 updater plugin for Windows x86-64 NSIS releases. Release builds compile a dedicated QueryNot minisign public key and check the stable manifest at `https://github.com/not-projects/querynot/releases/latest/download/latest.json`. Development builds without that key remain usable but report that updates are not configured.

The Settings screen performs one silent signed-feed check after native bootstrap and also offers an explicit check. It displays release metadata as plain text. Installation is always explicit. Before handoff, the application refuses to proceed while connection setup, an execution, an unresolved transaction, staged table edits, or an unsaved recovery snapshot remains. No database details, credentials, query text, application usage, or telemetry are sent. The check necessarily makes a normal HTTPS request to GitHub Releases.

The release candidate boundary requires all of the following:

- repository variable `QUERYNOT_UPDATER_PUBLIC_KEY`, containing the base64-encoded dedicated public-key document;
- repository secret `TAURI_SIGNING_PRIVATE_KEY`, containing the matching private key;
- repository secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` when the private key is password protected;
- exactly one Windows NSIS installer and its matching `.sig` file;
- a deterministic `latest.json` containing only `windows-x86_64-nsis` and the compatibility alias `windows-x86_64`, both pointing to those exact signed bytes;
- an installer-only `SHA256SUMS` file for manual verification; and
- commit/version-addressed inspection, checksum, and updater-manifest reports.

Candidate packaging fails closed when either required key is absent or malformed. Publication never receives signing secrets and never rebuilds. It resolves one successful manual `CI` run on `master`, checks out that exact source commit, downloads the candidate, verifies both Minisign signatures against the configured public key, stages only the installer, signature, `latest.json`, and `SHA256SUMS`, creates an unpublished draft, downloads those four assets again, verifies them, and only then publishes the stable release.

The checked-in Tauri configuration contains an inert updater object with no endpoints and an empty public key so the plugin can initialize in unsigned development builds without making a network request. The Windows packaging script replaces those inert values with Tauri's required `plugins.updater` configuration as an ephemeral CLI overlay derived from `QUERYNOT_UPDATER_PUBLIC_KEY`. The same repository variable therefore configures both the compiled Rust updater and the bundler that creates signed updater artifacts; the real public key is not duplicated in source, and a missing value fails before compilation. Release-note text is normalized to LF before entering `latest.json`, so candidate bytes and publication verification remain deterministic across Windows and Linux runners.

`0.1.0` cannot discover `0.1.1` because it has no updater. Users install `0.1.1` manually once; signed in-application updates begin with later releases.

## Consequences

- QueryNot and PostNot share a proven release architecture but not a private signing identity.
- Losing the QueryNot private key prevents seamless updates from already installed updater-enabled versions. The key and password therefore require durable maintainer-controlled backup outside the repository and CI.
- A compromised GitHub release alone cannot install modified bytes because the compiled public key verifies the updater signature.
- Publishing an updater-enabled release remains impossible until the dedicated key material is configured and a signed candidate passes CI.
- The historical `0.1.0` evidence and unsigned-installation guidance remain immutable release records.
- The first signed release, `v0.1.1`, was published from candidate CI run `31843628362` by publication run `31844465799`; its exact reports and public-download verification are retained under `evidence/release-updates/0.1.1`.
