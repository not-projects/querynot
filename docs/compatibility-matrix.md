# Compatibility and conformance matrix

Status: QueryNot 0.1.5 current live cross-platform release
Selection date: 2026-08-23

Version `0.1.5` is the current live release for Windows 11 x86-64, Linux x86-64, and macOS 13 or later on Intel and Apple silicon under ADR 0016. Its dedicated QueryNot updater key, exact-candidate publication, draft round trip, public-download hashes, and Ed25519-BLAKE2b signature checks passed for every platform payload. Historical `0.1.0` and `0.1.1` evidence remains immutable.

The rows below describe the live `0.1.5` publication matrix after the exact multi-platform candidate and public-download round trip passed. Phase 5 continues to describe the historical `0.1.0` Windows-only boundary, and `evidence/release-updates/0.1.1` retains the first signed-channel records. Native hardware, vault, accessibility, performance, dogfood, and beta observations remain explicit follow-up evidence until performed.

## Prepared 0.1.6 compatibility delta

The prepared `0.1.6` source recognizes every well-formed MySQL `5.7.x` identity as the legacy 5.7 compatibility line and keeps ordinary query writes, manual transactions, destructive-statement confirmation, and safe staged row mutations enabled. Non-5.7.44 patches state that 5.7.44 remains the exact automated conformance fixture. Malformed identities and unrecognized MySQL/MariaDB lines remain query-only, and the published `0.1.5` evidence below is unchanged.

## Application platforms

| Matrix ID | Operating system | Architecture | Web runtime/package | Current status |
| --- | --- | --- | --- | --- |
| `windows-11-x64` | Windows 11 | x86-64 | Microsoft Edge WebView2; NSIS + MSI | Current live `0.1.5` distribution row |
| `windows-10-22h2-x64` | Windows 10 22H2 | x86-64 | WebView2; NSIS + MSI | Deferred; no `0.1.5` support claim |
| `macos-13-intel` | macOS 13 or later | Intel | System WebKit; x86-64 DMG; candidate built on `macos-15-intel` | Current live `0.1.5` distribution row; Apple notarization is not claimed |
| `macos-13-apple` | macOS 13 or later | Apple silicon | System WebKit; aarch64 DMG; candidate built on `macos-15` | Current live `0.1.5` distribution row; Apple notarization is not claimed |
| `linux-x64` | Linux x86-64 | x86-64 | WebKitGTK 4.1; AppImage + Debian + RPM; candidate built on Ubuntu 22.04 | Current live `0.1.5` distribution row; unlisted distro/runtime combinations are not blanket-certified |
| `ubuntu-24.04-x64` | Ubuntu 24.04 LTS | x86-64 | WebKitGTK 4.1; portable compile check | Compile coverage retained; native package observation remains follow-up evidence |

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

## Current live signed 0.1.5 release

- Release: [`v0.1.5`](https://github.com/not-projects/querynot/releases/tag/v0.1.5)
- Candidate run: [`32663343245`](https://github.com/not-projects/querynot/actions/runs/32663343245)
- Publication run: [`32665401024`](https://github.com/not-projects/querynot/actions/runs/32665401024)
- Source commit: `fb3ee515448d8131d17f677ca532940565f4c097`
- Public verification: all 18 assets are byte-identical to the reviewed candidate; all seven updater signatures pass with public key ID `FD25C4E1F33E86DD`

| Role | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows NSIS | `QueryNot_0.1.5_x64-setup.exe` | 3,385,773 | `4f312e371c7bbd4a70dae0796cde2f15cc54bd264d01a7a6af23b343fae3af58` |
| Windows MSI | `QueryNot_0.1.5_x64_en-US.msi` | 4,530,176 | `d0b1b433f23130e31029b5858cb4ef5961a1d88435e0f76f68aeec6af61cec92` |
| Linux AppImage | `QueryNot_0.1.5_amd64.AppImage` | 82,176,504 | `191db834f6c1cd70310c38c2f9a908fd83a59a36884731d5028268c6b8e637cf` |
| Linux DEB | `QueryNot_0.1.5_amd64.deb` | 4,646,892 | `e1a66da11b41badc54eb42513fda869cac4b63c6c8571a5c2564254621b0f6fa` |
| Linux RPM | `QueryNot-0.1.5-1.x86_64.rpm` | 4,647,731 | `fdfbcf141b479ea294727c8ebca8a4a8e897e996efcaf689e319519e4a8b087b` |
| macOS Intel DMG | `QueryNot_0.1.5_x64.dmg` | 4,284,814 | `325c5e339add029bd93a02add6641f38ecd75437ea508960f48485c8aa089f98` |
| macOS Apple-silicon DMG | `QueryNot_0.1.5_aarch64.dmg` | 3,938,038 | `ecb5751793512e5d32db617a4eb9b13f035361e646986291699ee01039cee5db` |
| macOS Intel updater | `QueryNot_x64.app.tar.gz` | 4,262,317 | `818c90d7468e4ef11111180b27da551a1589ec9c7e3a64d409c8602ecfcbb384` |
| macOS Apple-silicon updater | `QueryNot_aarch64.app.tar.gz` | 3,961,918 | `e0f6056b0d3909e06b51c77724cd6bbf58cbbd37327358fd6ada9792a4fd8d01` |

- `latest.json`: 6,687 bytes; SHA-256 `effe8c04f57772cc692a2e01864566c6376c3fd59d6b3051f2e7bdc8ed5ca9d8`; exact keys `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`, `linux-x86_64-appimage`, `linux-x86_64-deb`, `linux-x86_64-rpm`, `windows-x86_64`, and `windows-x86_64-nsis`.
- `SHA256SUMS`: 653 bytes; SHA-256 `79ddef44aa1d5bf385fe59582132b0c99bb983e8f82f3eb7bdc4d6cd89491599`; all seven installable-package checks pass.

## Previous 0.1.4 signed Windows artifact

- Release: [`v0.1.4`](https://github.com/not-projects/querynot/releases/tag/v0.1.4)
- Candidate run: `32590531115`
- Publication run: `32591104372`
- Source commit: `3aad76c0214b93f0432fec9ee223f32badea2869`
- Installer: `QueryNot_0.1.4_x64-setup.exe`
- Size: 3,386,329 bytes
- SHA-256: `e77efb4fc59c36d8294e7ed544ddaeb167db94d1302e21dbe56161fc1aa17a48`
- Updater signature: Ed25519-BLAKE2b verification passed with public key ID `FD25C4E1F33E86DD`

## Historical 0.1.0 Windows artifact

- Candidate run: `31815252436`
- Source commit: `e241ee0973f17906ead8b32d868f76a01685baba`
- Installer: `QueryNot_0.1.0_x64-setup.exe`
- Size: 3,120,243 bytes
- SHA-256: `80753f765bcae143750b2de1b765405b710ad858fb637c1cfb80c9a06090058c`
- Updater artifacts: none

The historical WSL2 Debian and AppImage packages remain development evidence only. The public `0.1.5` Linux packages came from the native Ubuntu candidate job and passed the combined release contract. Native hardware observations remain follow-up evidence, and cross-platform compilation alone is still not a support claim.
