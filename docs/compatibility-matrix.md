# Compatibility and conformance matrix

Status: Revision-2 Windows release candidate in progress; not a support claim until the final gate passes
Selection date: 2026-08-14

Only the `windows-11-x64` row is eligible for the `0.1.0` support claim. It becomes supported only after Phase 5 retains the exact Windows package, inspection, checksum, complete WSL2/browser automation, and applicable adapter conformance evidence. Native owner checks follow the release under ADR 0010 and are not represented as already performed.

## Application platforms

| Matrix ID | Operating system | Architecture | Web runtime/package | Current status |
| --- | --- | --- | --- | --- |
| `windows-11-x64` | Windows 11 25H2, build 26200.8655 | x86-64 | Microsoft Edge WebView2 151.0.4129.78, unsigned NSIS | Selected `0.1.0` row; package and final audit pending |
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
| `sqlite-bundled` | 3.51.3 through SQLx/libsqlite3-sys in the local build | File permissions | Not applicable | Current bundled library | Phase 2 query journey and Phase 4 keyed browsing, staged mutations, generated-value refresh, conflict, and rollback tests pass locally; target-platform release conformance pending |
| `mysql-5.7.44` | 5.7.44 | `mysql_native_password` | Custom-CA identity verification and client certificate at TLS 1.2 pass; system trust rejects the private fixture CA | Legacy/EOL; persistent warning required | Phase 5 local candidate conformance passes the full adapter/table contract |
| `mysql-8.0.46` | 8.0.46 | `caching_sha2_password` over protected transport | Custom-CA identity verification and client certificate at TLS 1.2 pass; system trust rejects the private fixture CA | Legacy line at selection date | Phase 5 local candidate conformance passes the full adapter/table contract |
| `mysql-8.4.10` | 8.4.10 LTS | `caching_sha2_password` over protected transport | Custom-CA identity verification and client certificate at TLS 1.2 pass; system trust rejects the private fixture CA | Maintained LTS | Phase 5 local candidate conformance passes the full adapter/table contract |
| `mariadb-10.11.18` | 10.11.18 LTS | `mysql_native_password` over protected transport | Custom-CA identity verification and client certificate at TLS 1.2 pass; system trust rejects the private fixture CA | Maintained LTS | Phase 5 local candidate conformance passes the full adapter/table contract |
| `mariadb-11.4.12` | 11.4.12 LTS | `mysql_native_password` over protected transport | Custom-CA identity verification and client certificate at TLS 1.2 pass; system trust rejects the private fixture CA | Maintained LTS | Phase 5 local candidate conformance passes the full adapter/table contract |

MySQL 8.0 reached the lifecycle date identified by the vendor before this selection date; it is treated like a legacy compatibility line in UI/release notes even though the approved PRD separately calls out the mandatory 5.7 indicator. No safety control is weakened for either line.

The retained Phase 4 reports cover the full Phase 3 contract plus deterministic keyset paging, labelled read-only fallbacks in the local planner, bound hostile structured filters, typed validation, insert/update/delete, generated-value refresh, optimistic conflicts, and atomic rollback. Positive system-trust validation against a publicly trusted target and native target-platform trust-store behavior remain Phase 5 procedures; fixture automation intentionally never contacts a non-fixture database.

The unpublished `0.1.0` engineering configuration has produced nonempty Debian and AppImage packages in WSL2 and passed binary/package/checksum inspection. Under ADR 0010, those bytes are development evidence only and are excluded from publication. Cross-platform CI compilation is likewise portability evidence, not a support claim.
