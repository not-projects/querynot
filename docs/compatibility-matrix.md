# Compatibility and conformance matrix

Status: Phase 2 development matrix; not a support claim
Selection date: 2026-08-13

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
| `sqlite-bundled` | 3.51.3 through SQLx/libsqlite3-sys in the Phase 2 local build | File permissions | Not applicable | Current bundled library | Phase 2 real-file metadata, read-only execution, transactions, cancellation, streaming, fidelity, and export journey pass locally; target-platform release conformance pending |
| `mysql-5.7.44` | 5.7.44 | `mysql_native_password` | Verified TLS 1.2 required for protected connections | Legacy/EOL; persistent warning required | Disposable feasibility target |
| `mysql-8.0.46` | 8.0.46 | `caching_sha2_password` over protected transport | System trust/custom CA/client certificate matrix pending | Legacy line at selection date | Phase 3 conformance pending |
| `mysql-8.4.10` | 8.4.10 LTS | `caching_sha2_password` over protected transport | Phase 0 generated-CA identity verification at TLS 1.2 passes; system trust/custom CA/client certificate matrix pending | Maintained LTS | Disposable feasibility target passes |
| `mariadb-10.11.18` | 10.11.18 LTS | Validated native password mechanism | Direct TCP and verified TLS matrix pending | Maintained LTS | Phase 3 conformance pending |
| `mariadb-11.4.12` | 11.4.12 LTS | `mysql_native_password` over protected transport | Phase 0 generated-CA identity verification at TLS 1.2 passes; system trust/custom CA/client certificate matrix pending | Maintained LTS | Disposable feasibility target passes |

MySQL 8.0 reached the lifecycle date identified by the vendor before this selection date; it is treated like a legacy compatibility line in UI/release notes even though the approved PRD separately calls out the mandatory 5.7 indicator. No safety control is weakened for either line.
