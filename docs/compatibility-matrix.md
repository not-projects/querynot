# Compatibility and conformance matrix

Status: QueryNot 0.1.1 release matrix; signed release evidence complete
Selection date: 2026-08-14

Version `0.1.1` was published against this unchanged Windows/database support matrix with signed updater artifacts under ADR 0011. The dedicated key, complete manually dispatched CI matrix, exact-candidate publication, draft round trip, public-download hashes, and Ed25519-BLAKE2b signature verification passed. The historical `0.1.0` artifact remains an immutable release record.

Only the `windows-11-x64` row is supported and published. Phase 5 retains the initial `0.1.0` package boundary; `evidence/release-updates/0.1.1` retains the exact signed `0.1.1` candidate and publication records. Native owner checks follow the release under ADR 0010 and are not represented as already performed.

## Application platforms

| Matrix ID | Operating system | Architecture | Web runtime/package | Current status |
| --- | --- | --- | --- | --- |
| `windows-11-x64` | Windows 11 25H2, build 26200.8655 | x86-64 | Microsoft Edge WebView2 151.0.4129.78, signed-updater NSIS (not Authenticode) | Sole supported and published 0.1.1 row |
| `windows-10-22h2-x64` | Windows 10 22H2 | x86-64 | WebView2, NSIS | Deferred; no `0.1.0` support or artifact claim |
| `macos-13-intel` | macOS 13 | Intel | System WebKit, DMG | Deferred; no `0.1.0` support or artifact claim |
| `macos-13-apple` | macOS 13 | Apple silicon | System WebKit, DMG | Deferred; no `0.1.0` support or artifact claim |
| `macos-current-intel` | Current macOS | Intel | System WebKit, DMG | Deferred; no `0.1.0` support or artifact claim |
| `macos-current-apple` | Current macOS | Apple silicon | System WebKit, DMG | Deferred; no `0.1.0` support or artifact claim |
| `ubuntu-22.04-x64` | Ubuntu 22.04 LTS | x86-64 | WebKitGTK 4.1, AppImage + Debian | WSL2 engineering packages only; no `0.1.0` support or publication claim |
| `ubuntu-24.04-x64` | Ubuntu 24.04 LTS | x86-64 | WebKitGTK 4.1, AppImage + Debian | Deferred; no `0.1.0` support or artifact claim |

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

## Reviewed signed Windows artifact

- Release: [`v0.1.1`](https://github.com/not-projects/querynot/releases/tag/v0.1.1)
- Candidate run: `31843628362`
- Publication run: `31844465799`
- Source commit: `cf14accab85d88cafcccb14a3ddffd6a700b7ada`
- Installer: `QueryNot_0.1.1_x64-setup.exe`
- Size: 3,375,223 bytes
- SHA-256: `44a7c01c8a751380c9535c066d6a41a8cac469e278070417b83ffb0b14b2cf55`
- Updater signature: Ed25519-BLAKE2b verification passed with public key ID `FD25C4E1F33E86DD`

## Historical 0.1.0 Windows artifact

- Candidate run: `31815252436`
- Source commit: `e241ee0973f17906ead8b32d868f76a01685baba`
- Installer: `QueryNot_0.1.0_x64-setup.exe`
- Size: 3,120,243 bytes
- SHA-256: `80753f765bcae143750b2de1b765405b710ad858fb637c1cfb80c9a06090058c`
- Updater artifacts: none

WSL2 Debian and AppImage packages are development evidence only and are excluded from publication. Cross-platform CI compilation is likewise portability evidence, not a support claim.
