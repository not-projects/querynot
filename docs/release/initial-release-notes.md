# QueryNot 0.1.0

QueryNot 0.1.0 is the first local-first desktop release from Not Projects. It provides the approved SQLite, MySQL, and MariaDB query workflow, local workspace tools, and staged table editing without accounts, telemetry, cloud synchronization, hosted storage, or remote diagnostics.

This release is published only by the fail-closed Phase 6 workflow after all 20 revised acceptance criteria pass. The workflow uploads the same Windows 11 x86-64 NSIS installer reviewed during Phase 5 plus the retained `SHA256SUMS` file. It does not rebuild or substitute either file.

## Verify before installing

The packages are intentionally unsigned and unnotarized. Operating-system warnings are expected; do not disable an operating-system security control globally.

1. Download the Windows x86-64 NSIS installer together with `SHA256SUMS`.
2. Calculate the complete SHA-256 digest with `Get-FileHash -Algorithm SHA256` in Windows PowerShell.
3. Compare both the complete digest and exact filename with `SHA256SUMS`. Do not install a mismatch.
4. Follow the [unsigned installation procedure](https://github.com/not-projects/querynot/blob/v0.1.0/docs/release/unsigned-installation.md), including the per-application Windows SmartScreen path.

QueryNot 0.1.0 has no self-updater and does not bypass Windows SmartScreen, certificate validation, or database safety confirmations.

## Exact support boundary

Support is limited to the exact operating-system patch, runtime, architecture, package, database patch, authentication mechanism, and TLS combinations in the [published compatibility matrix](https://github.com/not-projects/querynot/blob/v0.1.0/docs/compatibility-matrix.md). A successful connection to an unlisted version is not a support claim. MySQL 5.7 support is limited to the tested legacy 5.7.44 path and retains its lifecycle warning.

## Included workflow

- Local profiles with OS-vault or session-only network credentials and direct, verified TLS.
- Dedicated SQLite and MySQL/MariaDB query and table sessions with visible context, transactions, cancellation, bounded streaming, multiple results, typed values, copy, and atomic CSV/JSON export.
- Progressive schema navigation, CodeMirror SQL editing, completion, diagnostics, formatting, history, drafts, tabs, and SQL-file workflows.
- Deterministic keyed table browsing, bound structured filters, typed staged insert/update/delete plans, immutable previews, optimistic conflict checks, generated-value refresh, and atomic rollback.

## Known limitations and unsupported roadmap

The following are not included or supported in 0.1.0: Windows 10, macOS, native Linux distribution, PostgreSQL, SSH tunnelling, database provisioning or administration suites, third-party adapters, Workbench/DBeaver profile import, cloud synchronization, collaboration, telemetry, automatic updates, and signed packages. Unlisted database or runtime versions may work but are unverified and unsupported.

The product owner is the sole initial participant. Native manual interaction checks, the fixed five-day dogfood checklist, and external beta are explicit post-release validation under ADR 0010; they are not claimed as completed by this release.

PostgreSQL, remote-access parity, advanced workflow, administration features, signing, and shared Not Projects UI work are directional post-release roadmap items, not shipped promises. Failures are handled using the repository's [data-safety-first triage policy](https://github.com/not-projects/querynot/blob/v0.1.0/docs/release/failure-triage.md).
