# QueryNot 0.1.0

QueryNot 0.1.0 is the first local-first desktop release from Not Projects. It provides the approved SQLite, MySQL, and MariaDB query workflow, local workspace tools, and staged table editing without accounts, telemetry, cloud synchronization, hosted storage, or remote diagnostics.

This release is published only by the fail-closed Phase 6 workflow after all 20 acceptance criteria pass. The workflow uploads the same five package files reviewed during Phase 5—one Windows NSIS installer, separate Intel and Apple-silicon macOS DMGs, and Linux AppImage and Debian packages—plus the retained `SHA256SUMS` file. It does not rebuild or substitute them.

## Verify before installing

The packages are intentionally unsigned and unnotarized. Operating-system warnings are expected; do not disable an operating-system security control globally.

1. Download the package for the exact supported platform and architecture together with `SHA256SUMS`.
2. Calculate the complete SHA-256 digest with `Get-FileHash -Algorithm SHA256` on Windows, `shasum -a 256` on macOS, or `sha256sum` on Linux.
3. Compare both the complete digest and exact filename with `SHA256SUMS`. Do not install a mismatch.
4. Follow the [unsigned installation procedure](https://github.com/not-projects/querynot/blob/v0.1.0/docs/release/unsigned-installation.md), including the per-application Windows SmartScreen or macOS **Open Anyway** path.

QueryNot 0.1.0 has no self-updater and does not bypass Windows SmartScreen, macOS Gatekeeper, package-manager prompts, certificate validation, or database safety confirmations.

## Exact support boundary

Support is limited to the exact operating-system patch, runtime, architecture, package, database patch, authentication mechanism, and TLS combinations in the [published compatibility matrix](https://github.com/not-projects/querynot/blob/v0.1.0/docs/compatibility-matrix.md). A successful connection to an unlisted version is not a support claim. MySQL 5.7 support is limited to the tested legacy 5.7.44 path and retains its lifecycle warning.

## Included workflow

- Local profiles with OS-vault or session-only network credentials and direct, verified TLS.
- Dedicated SQLite and MySQL/MariaDB query and table sessions with visible context, transactions, cancellation, bounded streaming, multiple results, typed values, copy, and atomic CSV/JSON export.
- Progressive schema navigation, CodeMirror SQL editing, completion, diagnostics, formatting, history, drafts, tabs, and SQL-file workflows.
- Deterministic keyed table browsing, bound structured filters, typed staged insert/update/delete plans, immutable previews, optimistic conflict checks, generated-value refresh, and atomic rollback.

## Known limitations and unsupported roadmap

The following are not included or supported in 0.1.0: PostgreSQL, SSH tunnelling, database provisioning or administration suites, third-party adapters, Workbench/DBeaver profile import, cloud synchronization, collaboration, telemetry, automatic updates, and signed or notarized packages. Other Linux distributions and unlisted database or runtime versions may work but are unverified and unsupported.

PostgreSQL, remote-access parity, advanced workflow, administration features, signing, and shared Not Projects UI work are directional post-release roadmap items, not shipped promises. Failures are handled using the repository's [data-safety-first triage policy](https://github.com/not-projects/querynot/blob/v0.1.0/docs/release/failure-triage.md).
