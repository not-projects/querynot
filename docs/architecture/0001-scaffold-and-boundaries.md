# ADR 0001: Scaffold, targets, and native boundaries

Date: 2026-08-13
Status: Accepted for Phase 0

## Decision

QueryNot is a single-window Tauri 2 desktop application with a Svelte 5/TypeScript frontend and a Rust workspace. `src-tauri` owns the desktop process, `querynot-core` owns application/domain contracts and compiled database adapters, and the frontend owns presentation and ephemeral interaction state.

The checked-in targets are:

| Release artifact | Rust target | CI validation |
| --- | --- | --- |
| Windows x86-64 NSIS | `x86_64-pc-windows-msvc` | Native Windows runner |
| macOS Apple silicon DMG | `aarch64-apple-darwin` | Native Apple-silicon runner |
| macOS Intel DMG | `x86_64-apple-darwin` | Native Intel runner |
| Linux x86-64 AppImage and Debian package | `x86_64-unknown-linux-gnu` | Native Ubuntu 22.04 and 24.04 runners |

CI compilation establishes scaffold portability, not release compatibility. Phase 5 still requires the exact supported OS patch, runtime, installation, packaging, accessibility, and end-to-end evidence in the compatibility matrix.

## Trust boundaries

- Database, vault, local-store, SQL execution, cancellation, export, and file-writing operations remain native Rust responsibilities.
- Frontend commands use opaque identifiers and generated versioned contracts. Rust revalidates enum, length, provenance, ownership, and state transitions.
- The webview has no shell, process, environment-variable, HTTP, or unrestricted filesystem capability.
- File selection uses the native dialog plugin. A dialog grant is not authority to access a different path.
- CSP allows only packaged resources plus Tauri's local IPC/asset protocols. Inline/evaluated script and remote content are forbidden.
- No account, telemetry, updater, remote diagnostics, hosted storage, or runtime code download is present.

## Vertical-slice rule

Features remain disabled or clearly described as unavailable until their complete safety path is implemented and the owning phase gate passes. The Phase 0 shell has no database execution path and does not imply a usable client.

## Consequences

This layout allows adapters and state machines to be tested without a webview while keeping the Tauri surface small. It also means browser-only prototypes cannot bypass native ownership or secret boundaries, and platform packaging must be verified on native runners and hardware.
