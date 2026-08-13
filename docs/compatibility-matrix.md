# Compatibility and conformance matrix

Status: Phase 4 locally conformant development matrix; not a support claim
Selection date: 2026-08-13; Phase 4 conformance rerun 2026-08-14

No row becomes supported until Phase 5 retains native packaging, installation, end-to-end, accessibility, and applicable adapter conformance evidence for the exact patch/runtime combination.

## Application platforms

| Matrix ID | Operating system | Architecture | Web runtime/package | Current status |
| --- | --- | --- | --- | --- |
| `windows-10-22h2-x64` | Windows 10 22H2, final applicable patch | x86-64 | Supported WebView2, NSIS | Planned |
| `windows-11-x64` | Windows 11, exact RC patch | x86-64 | Supported WebView2, NSIS | Planned |
| `macos-13-intel` | macOS 13, exact RC patch | Intel | System WebKit, unsigned DMG | Planned |
| `macos-13-apple` | macOS 13, exact RC patch | Apple silicon | System WebKit, unsigned DMG | Planned |
| `macos-current-intel` | Latest selected macOS at RC | Intel | System WebKit, unsigned DMG | Planned |
| `macos-current-apple` | Latest selected macOS at RC | Apple silicon | System WebKit, unsigned DMG | Planned |
| `ubuntu-22.04-x64` | Ubuntu 22.04 LTS, exact RC patch | x86-64 | WebKitGTK 4.1, AppImage + Debian | Scaffold compile only |
| `ubuntu-24.04-x64` | Ubuntu 24.04 LTS, exact RC patch | x86-64 | WebKitGTK 4.1, AppImage + Debian | Planned |

## Database fixtures

| Matrix ID | Exact selected patch | Authentication | TLS | Lifecycle | Current evidence |
| --- | --- | --- | --- | --- | --- |
| `sqlite-bundled` | 3.51.3 through SQLx/libsqlite3-sys in the local build | File permissions | Not applicable | Current bundled library | Phase 2 query journey and Phase 4 keyed browsing, staged mutations, generated-value refresh, conflict, and rollback tests pass locally; target-platform release conformance pending |
| `mysql-5.7.44` | 5.7.44 | `mysql_native_password` | Custom-CA identity verification and client certificate at TLS 1.2 pass; system trust rejects the private fixture CA | Legacy/EOL; persistent warning required | Phase 4 local common-adapter and table-editing conformance pass |
| `mysql-8.0.46` | 8.0.46 | `caching_sha2_password` over protected transport | Custom-CA identity verification and client certificate at TLS 1.2 pass; system trust rejects the private fixture CA | Legacy line at selection date | Phase 4 local common-adapter and table-editing conformance pass |
| `mysql-8.4.10` | 8.4.10 LTS | `caching_sha2_password` over protected transport | Custom-CA identity verification and client certificate at TLS 1.2 pass; system trust rejects the private fixture CA | Maintained LTS | Phase 4 local common-adapter and table-editing conformance pass |
| `mariadb-10.11.18` | 10.11.18 LTS | `mysql_native_password` over protected transport | Custom-CA identity verification and client certificate at TLS 1.2 pass; system trust rejects the private fixture CA | Maintained LTS | Phase 4 local common-adapter and table-editing conformance pass |
| `mariadb-11.4.12` | 11.4.12 LTS | `mysql_native_password` over protected transport | Custom-CA identity verification and client certificate at TLS 1.2 pass; system trust rejects the private fixture CA | Maintained LTS | Phase 4 local common-adapter and table-editing conformance pass |

MySQL 8.0 reached the lifecycle date identified by the vendor before this selection date; it is treated like a legacy compatibility line in UI/release notes even though the approved PRD separately calls out the mandatory 5.7 indicator. No safety control is weakened for either line.

The retained Phase 4 reports cover the full Phase 3 contract plus deterministic keyset paging, labelled read-only fallbacks in the local planner, bound hostile structured filters, typed validation, insert/update/delete, generated-value refresh, optimistic conflicts, and atomic rollback. Positive system-trust validation against a publicly trusted target and native target-platform trust-store behavior remain Phase 5 procedures; fixture automation intentionally never contacts a non-fixture database.
