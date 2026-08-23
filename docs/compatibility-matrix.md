# Compatibility and conformance matrix

Status: QueryNot 0.1.5 cross-platform candidate matrix; `0.1.4` is the current live release
Selection date: 2026-08-23

Version `0.1.4` is the current live Windows 11 x86-64 release. Version `0.1.5` prepares the approved cross-platform package and signed-updater matrix under ADR 0016. The dedicated QueryNot updater key, exact-candidate publication, draft round trip, public-download hashes, and Ed25519-BLAKE2b signature checks remain mandatory for every platform payload. Historical `0.1.0` and `0.1.1` evidence remains immutable.

The rows below describe the `0.1.5` publication targets. They become live support claims only after the exact multi-platform candidate and public-download round trip pass. Phase 5 continues to describe the historical `0.1.0` Windows-only boundary, and `evidence/release-updates/0.1.1` retains the first signed-channel records. Native hardware, vault, accessibility, performance, dogfood, and beta observations remain explicit follow-up evidence until performed.

## Application platforms

| Matrix ID | Operating system | Architecture | Web runtime/package | Current status |
| --- | --- | --- | --- | --- |
| `windows-11-x64` | Windows 11 | x86-64 | Microsoft Edge WebView2; NSIS + MSI | Current `0.1.4` NSIS support row; NSIS/MSI `0.1.5` candidate target |
| `windows-10-22h2-x64` | Windows 10 22H2 | x86-64 | WebView2; NSIS + MSI | Deferred; no `0.1.5` support claim |
| `macos-13-intel` | macOS 13 or later | Intel | System WebKit; x86-64 DMG; candidate built on `macos-15-intel` | `0.1.5` candidate target; Apple notarization is not claimed |
| `macos-13-apple` | macOS 13 or later | Apple silicon | System WebKit; aarch64 DMG; candidate built on `macos-15` | `0.1.5` candidate target; Apple notarization is not claimed |
| `linux-x64` | Linux x86-64 | x86-64 | WebKitGTK 4.1; AppImage + Debian + RPM; candidate built on Ubuntu 22.04 | `0.1.5` candidate target; unlisted distro/runtime combinations are not blanket-certified |
| `ubuntu-24.04-x64` | Ubuntu 24.04 LTS | x86-64 | WebKitGTK 4.1; portable compile check | Compile coverage retained; package acceptance remains part of candidate/post-release observation |

## Database fixtures

| Matrix ID | Exact selected patch | Authentication | TLS | Lifecycle | Current evidence |
| --- | --- | --- | --- | --- | --- |
| `sqlite-bundled` | 3.51.3 through SQLx/libsqlite3-sys in the release build | File permissions | Not applicable | Current bundled library | Phase 2 query journey, Phase 4 keyed editing contract, and the Windows release build pass |
| `mysql-5.7.44` | 5.7.44 | `mysql_native_password` | Custom-CA identity verification and client certificate at TLS 1.2 pass; system trust rejects the private fixture CA | Legacy/EOL; persistent warning required | Phase 5 local candidate conformance passes the full adapter/table contract |
| `mysql-8.0.46` | 8.0.46 | `caching_sha2_password` over protected transport | Custom-CA identity verification and client certificate at TLS 1.2 pass; system trust rejects the private fixture CA | Legacy line at selection date | Phase 5 local candidate conformance passes the full adapter/table contract |
| `mysql-8.4.10` | 8.4.10 LTS | `caching_sha2_password` over protected transport | Custom-CA identity verification and client certificate at TLS 1.2 pass; system trust rejects the private fixture CA | Maintained LTS | Phase 5 local candidate conformance passes the full adapter/table contract |
| `mariadb-10.11.18` | 10.11.18 LTS | `mysql_native_password` over protected transport | Custom-CA identity verification and client certificate at TLS 1.2 pass; system trust rejects the private fixture CA | Maintained LTS | Phase 5 local candidate conformance passes the full adapter/table contract |
| `mariadb-11.4.12` | 11.4.12 LTS | `mysql_native_password` over protected transport | Custom-CA identity verification and client certificate at TLS 1.2 pass; system trust rejects the private fixture CA | Maintained LTS | Phase 5 local candidate conformance passes the full adapter/table contract |

MySQL 8.0 reached the lifecycle date identified by the vendor before this selection date; it is treated like a legacy compatibility line in UI/release notes even though the approved PRD separately calls out the mandatory 5.7 indicator. No safety control is weakened for either line.

The retained Phase 4 reports cover the full Phase 3 contract plus deterministic keyset paging, labelled read-only fallbacks in the local planner, bound hostile structured filters, typed validation, insert/update/delete, generated-value refresh, optimistic conflicts, and atomic rollback. Positive system-trust validation against a publicly trusted target and native Windows trust-store behavior remain post-release owner observations; fixture automation intentionally never contacts a non-fixture database.

## Current live signed Windows artifact

- Release: [`v0.1.4`](https://github.com/not-projects/querynot/releases/tag/v0.1.4)
- Candidate run: `32590531115`
- Publication run: `32591104372`
- Source commit: `3aad76c0214b93f0432fec9ee223f32badea2869`
- Installer: `QueryNot_0.1.4_x64-setup.exe`
- Size: 3,386,329 bytes
- SHA-256: `e77efb4fc59c36d8294e7ed544ddaeb167db94d1302e21dbe56161fc1aa17a48`
- Updater signature: Ed25519-BLAKE2b verification passed with public key ID `FD25C4E1F33E86DD`

## Prepared 0.1.5 public artifact set

- Windows x86-64: NSIS and MSI, each with its updater signature.
- Linux x86-64: AppImage, Debian, and RPM, each with its updater signature.
- macOS Intel and Apple silicon: architecture-specific DMGs plus signed `.app.tar.gz` updater payloads.
- Shared assets: one seven-package `SHA256SUMS` and one eight-key `latest.json`.

Exact filenames, byte counts, hashes, runner images, and the combined source commit are populated by candidate CI and are not claimed before that run succeeds.

## Historical 0.1.0 Windows artifact

- Candidate run: `31815252436`
- Source commit: `e241ee0973f17906ead8b32d868f76a01685baba`
- Installer: `QueryNot_0.1.0_x64-setup.exe`
- Size: 3,120,243 bytes
- SHA-256: `80753f765bcae143750b2de1b765405b710ad858fb637c1cfb80c9a06090058c`
- Updater artifacts: none

The historical WSL2 Debian and AppImage packages remain development evidence only. The `0.1.5` public Linux packages must come from the new native Ubuntu candidate job and pass the combined release contract; cross-platform compilation alone is still not a support claim.
