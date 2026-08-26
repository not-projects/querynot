# ADR 0016: Cross-platform signed distribution

> [ADR 0017](0017-streamlined-signed-release-automation.md) supersedes only the routine post-upload full-download verification and candidate-workflow orchestration described below. The platform, signing, inventory, and no-rebuild boundaries remain authoritative.

- Status: Accepted for `0.1.5`
- Date: 2026-08-23
- Decision owner: QueryNot product owner
- Supersedes: The Windows-only platform boundary in ADR 0010 and ADR 0011 for `0.1.5` and later releases

## Context

QueryNot `0.1.4` is the current live Windows 11 x86-64 release. The Rust, Tauri, Svelte, database-adapter, file-grant, and OS-vault boundaries already compile on Windows, macOS, and Linux, while the original publication contract deliberately limited public artifacts and updater metadata to Windows.

The product owner has now approved the deferred platform expansion and selected PostNot's live desktop release matrix as the reference for runners, packages, updater payloads, and `latest.json` keys. QueryNot must retain its own updater identity and its stricter reviewed-candidate publication boundary rather than publishing directly from independent matrix jobs.

## Decision

QueryNot `0.1.5` prepares these desktop targets:

| Target | Candidate runner | Installable packages | Signed updater payload |
| --- | --- | --- | --- |
| Windows x86-64 | `windows-2022` | NSIS and MSI | Each installer is signed and directly reusable by the updater |
| Linux x86-64 | `ubuntu-22.04` | AppImage, Debian, and RPM | Each package is signed; the generic Linux updater key selects AppImage |
| macOS Intel | `macos-15-intel` | x86-64 DMG | Signed x86-64 `.app.tar.gz` archive |
| macOS Apple silicon | `macos-15` | aarch64 DMG | Signed aarch64 `.app.tar.gz` archive |

Every candidate job receives the dedicated QueryNot Minisign key environment, builds into an isolated target directory, and inspects its native binary, installable packages, updater payloads, signatures, CSP, and Tauri capability boundary. Linux continues to use the checksum-pinned Tauri AppImage helper inputs.

After all four jobs pass, one Linux aggregation job downloads their exact outputs and creates:

- one `SHA256SUMS` covering exactly the seven installable packages;
- one deterministic `latest.json` with the PostNot-compatible keys `windows-x86_64-nsis`, `windows-x86_64`, `linux-x86_64-appimage`, `linux-x86_64`, `linux-x86_64-deb`, `linux-x86_64-rpm`, `darwin-x86_64`, and `darwin-aarch64`;
- combined source-, version-, byte-, hash-, signature-, and platform-addressed candidate evidence; and
- one `querynot-release-candidate` workflow artifact consumed by publication.

The generic Windows key selects MSI, while the NSIS-specific key selects NSIS. The generic Linux key selects AppImage. macOS update entries select Tauri's architecture-specific application archives rather than the DMGs. All seven unique updater payload signatures are independently verified with QueryNot's compiled public key before the candidate is retained, before draft creation, and after the draft is downloaded.

Publication still receives no private signing key and performs no build. It stages exactly the seven installable packages, two additional macOS updater archives, seven matching updater signatures, `latest.json`, and `SHA256SUMS`; rejects missing, substituted, duplicate, or extra public assets; creates an unpublished draft at the candidate commit; round-trip verifies all 18 assets; and only then marks the release stable.

Application shortcuts use the native primary modifier: Command on macOS and Control on Windows and Linux. Labels, accessibility metadata, the global handler, and the CodeMirror execution keymap must describe and route the same platform-specific binding.

Updater signing is not Windows Authenticode, Apple Developer ID signing/notarization, Debian repository signing, or RPM repository signing. The release documentation must state the expected operating-system trust prompts and must not suggest bypassing security controls globally. Package availability is a supported distribution claim only after the exact candidate passes; native hardware, screen-reader, vault, performance, dogfood, and external-beta observations remain explicit follow-up evidence until performed.

## Consequences

- `0.1.4` remains the immutable current Windows-only release record; the expanded contract starts with `0.1.5`.
- Windows 11 x86-64, Linux x86-64, macOS Intel, and macOS Apple silicon receive public installable artifacts and signed in-app update metadata from one release.
- Windows 10 and Linux ARM remain outside this release matrix.
- The dedicated QueryNot updater key continues across every platform; PostNot key material is never reused.
- macOS and Linux package installation can still present platform trust or repository-origin warnings because OS vendor code signing and notarization are not introduced by this decision.
- ADR 0010 and ADR 0011 remain authoritative historical records for `0.1.0` through `0.1.4` where this decision does not supersede them.
