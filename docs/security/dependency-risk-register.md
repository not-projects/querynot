# Dependency risk register

Review date: 2026-11-06 (0.1.17 CI dependency remediation)

Owner: QueryNot product owner
Required re-review: every phase lockfile change and before the Phase 5 release-candidate gate

This register records informational or unreachable RustSec findings that remain in the locked dependency graph. It does not permit a vulnerability, a critical/high finding under the QueryNot severity rubric, or a weakened product safeguard. Any finding that becomes reachable or receives a vulnerability classification immediately reopens the dependency gate.

| Risk | Advisories | Dependency path | Reachability and impact review | Disposition | Expiry |
| --- | --- | --- | --- | --- | --- |
| RISK-DEP-001 | RUSTSEC-2024-0411 through 0420, excluding 0429 | Tauri/Wry/Tao → GTK3 bindings on Linux | Informational maintenance status. GTK3/WebKitGTK remains Tauri 2's supported Linux webview stack; no safe compatible upgrade exists. The app grants no general shell, network, environment, or filesystem capability. | Accept for development while tracking the maintained Tauri/Wry migration path. Re-evaluate on every Tauri upgrade and at RC. | Phase 5 RC gate |
| RISK-DEP-002 | RUSTSEC-2024-0370 | GTK3 macro dependencies → `proc-macro-error` | Informational maintenance status in a compile-time procedural-macro dependency. It is not shipped as an independently invokable runtime facility. | Accept while the GTK3 transitive path remains required; remove with the upstream stack. | Phase 5 RC gate |
| RISK-DEP-003 | RUSTSEC-2024-0429 | Tauri Linux stack → `glib 0.18.5` | RustSec describes unsound `next`, `last`, and `nth` implementations for `glib::VariantStrIter`. A locked-source symbol scan finds `VariantStrIter` only in `glib`'s own definition/re-export/constructor files; QueryNot and its downstream Tauri/Wry/GTK users do not name the affected type. QueryNot does not call this API. | Treat as unreachable in the current source graph. Re-run the source scan after lockfile changes; any call site or broader advisory reopens the gate. | Phase 5 RC gate |
| RISK-DEP-004 | RUSTSEC-2025-0075, 0080, 0081, 0098, 0100 | Tauri utils → `urlpattern` → rust-unic crates | Informational maintenance status. The crates parse URL-pattern identifiers inside the desktop framework; QueryNot exposes no runtime code download or arbitrary URL navigation surface. | Resolved by the 0.1.17 Tauri/urlpattern update; the affected crates and their advisory exceptions are removed. | Resolved 2026-11-06 |
| RISK-DEP-005 | RUSTSEC-2026-0370, 0371, 0372 | `tauri-plugin-single-instance` and keyring Secret Service backend -> `zbus 5` -> `zbus_names`, `zvariant`, `zvariant_derive` | Informational maintenance notices for crates folded into `zbus 6`; no vulnerability or unsoundness is reported by these three advisories. The current stable single-instance plugin and stable Secret Service/keyring backend still require `zbus 5`, including their latest published releases. QueryNot uses these paths for desktop instance coordination and the system vault, without exposing raw D-Bus calls to the WebView. | Retain only these three informational IDs while the stable upstream stack requires them. Do not substitute an alpha framework or change vault backends to silence the notices; any vulnerability classification reopens the gate. | Next Tauri/keyring update or the 0.1.17 release-candidate gate, whichever occurs first. |

The checked-in `deny.toml` contains only the advisory IDs in this register. `cargo deny check` must fail for every new advisory, yanked crate, unapproved license, wildcard dependency, or unknown source.

The Phase 4 review added `pkcs8 0.10.2` with its encryption transitives and `tauri-plugin-single-instance 2.4.3`. The exact npm source/integrity/version/license policy, npm high-severity audit, and pinned `cargo-deny 0.20.2` advisories/licenses/bans/sources checks pass with no new ignored advisory or risk-register entry. Target-platform keychain and single-instance interaction review remains part of the Phase 5 release-candidate gate.

## 0.1.17 dependency remediation

The 2026-11-06 CI review found new advisories in the historical 0.1.16 lockfile. The development source now selects stable Tauri 2.12.5 and pins updater 2.14.1, replacing ZIP 4 with ZIP 9. The resolver also updates Rustls/WebPKI, Tokio, constant-time utilities, and the yanked async-executor/chacha20 versions. No vulnerability, unsoundness, or yanked-version exception is added.

Tauri's updated urlpattern dependency removes the rust-unic path, resolving RISK-DEP-004 and removing its five advisory exceptions. RISK-DEP-005 records only the three upstream informational D-Bus maintenance notices. The older Phase 4 validation paragraph above is historical evidence, not a claim for this lockfile; the current PR checks establish validation of the updated graph.

Frontend remediation pins patched Vite and Vitest releases and refreshes their affected devalue, source-map-js, and Undici transitives. The high-severity npm gate and all native advisory/license/source gates remain enabled.
