# Dependency risk register

Review date: 2026-08-14 (Phase 4 lockfile change)

Owner: QueryNot product owner
Required re-review: every phase lockfile change and before the Phase 5 release-candidate gate

This register records informational or unreachable RustSec findings that remain in the locked dependency graph. It does not permit a vulnerability, a critical/high finding under the QueryNot severity rubric, or a weakened product safeguard. Any finding that becomes reachable or receives a vulnerability classification immediately reopens the dependency gate.

| Risk | Advisories | Dependency path | Reachability and impact review | Disposition | Expiry |
| --- | --- | --- | --- | --- | --- |
| RISK-DEP-001 | RUSTSEC-2024-0411 through 0420, excluding 0429 | Tauri/Wry/Tao → GTK3 bindings on Linux | Informational maintenance status. GTK3/WebKitGTK remains Tauri 2's supported Linux webview stack; no safe compatible upgrade exists. The app grants no general shell, network, environment, or filesystem capability. | Accept for development while tracking the maintained Tauri/Wry migration path. Re-evaluate on every Tauri upgrade and at RC. | Phase 5 RC gate |
| RISK-DEP-002 | RUSTSEC-2024-0370 | GTK3 macro dependencies → `proc-macro-error` | Informational maintenance status in a compile-time procedural-macro dependency. It is not shipped as an independently invokable runtime facility. | Accept while the GTK3 transitive path remains required; remove with the upstream stack. | Phase 5 RC gate |
| RISK-DEP-003 | RUSTSEC-2024-0429 | Tauri Linux stack → `glib 0.18.5` | RustSec describes unsound `next`, `last`, and `nth` implementations for `glib::VariantStrIter`. A locked-source symbol scan finds `VariantStrIter` only in `glib`'s own definition/re-export/constructor files; QueryNot and its downstream Tauri/Wry/GTK users do not name the affected type. QueryNot does not call this API. | Treat as unreachable in the current source graph. Re-run the source scan after lockfile changes; any call site or broader advisory reopens the gate. | Phase 5 RC gate |
| RISK-DEP-004 | RUSTSEC-2025-0075, 0080, 0081, 0098, 0100 | Tauri utils → `urlpattern` → rust-unic crates | Informational maintenance status. The crates parse URL-pattern identifiers inside the desktop framework; QueryNot exposes no runtime code download or arbitrary URL navigation surface. | Accept the transitive dependency while tracking Tauri's replacement. | Phase 5 RC gate |

The checked-in `deny.toml` contains only the advisory IDs in this register. `cargo deny check` must fail for every new advisory, yanked crate, unapproved license, wildcard dependency, or unknown source.

The Phase 4 review added `pkcs8 0.10.2` with its encryption transitives and `tauri-plugin-single-instance 2.4.3`. The exact npm source/integrity/version/license policy, npm high-severity audit, and pinned `cargo-deny 0.20.2` advisories/licenses/bans/sources checks pass with no new ignored advisory or risk-register entry. Target-platform keychain and single-instance interaction review remains part of the Phase 5 release-candidate gate.
