# ADR 0010: Windows-first release and post-release owner validation

- Status: Accepted
- Date: 2026-08-14
- Decision owner: QueryNot product owner
- Supersedes: the platform-count, native-manual, dogfood, beta, and artifact-count release assumptions in ADR 0008 and ADR 0009

## Context

The full SQLite/MySQL/MariaDB everyday workflow is implemented, but the project currently has one participant and one available native end-user platform: Windows 11 x86-64. Development and disposable-database validation run in WSL2. The product owner directed the project to finish what can be established in WSL2 and the current Windows 11 environment, defer or deny unsupported-platform work, move manual checks to the end user after the first release, and defer multi-person beta until participants exist.

Treating unperformed human or unavailable-platform procedures as passing would make the evidence bundle misleading. Continuing to require those procedures would contradict the approved release boundary. The release gate therefore needs a narrower support claim and an explicit distinction between verified release evidence and retained post-release validation work.

## Decision

QueryNot `0.1.0` publishes and supports one package: an unsigned Windows 11 x86-64 NSIS installer. The exact Windows patch and WebView2 runtime are frozen in the compatibility matrix. Windows 10, macOS, and native Linux distribution are deferred and make no `0.1.0` support claim. WSL2/Linux builds remain useful engineering evidence but are not public release artifacts.

The complete database and workflow scope remains unchanged. Release-blocking evidence is limited to:

- clean, commit-addressed WSL2 application, Rust, policy, dependency, security, benchmark, and disposable five-server conformance gates;
- automated Chromium checks for large/narrow layout, opaque themed dialogs, exact PostNot theme names, and applicable accessibility semantics;
- real Windows CI construction of the exact NSIS package, followed by artifact inspection, SHA-256 verification, and exact-byte publication controls;
- one product-owner scope record that lists native interaction, manual safety/accessibility/performance review, fixed five-day dogfood, and external beta as unperformed post-release work.

An unperformed result is recorded as `post_release`, never `pass`. The product-owner scope record is a release-scope decision, not evidence that a deferred check occurred. Traceability rows may become verified when every release-blocking automated mapping for the revised PRD passes and the row has retained commit-addressed evidence. Post-release procedure mappings remain visible but do not block `0.1.0`.

The release workflow downloads rather than rebuilds the reviewed Windows artifact, rejects any extra package, round-trip verifies the draft asset and checksum file, and publishes only after the revised Phase 5 audit passes. Cross-platform compile jobs may remain in CI as portability checks, but they do not create support claims.

## Consequences

- The first release remains a full everyday-workflow product, not a reduced feature MVP.
- Only Windows 11 x86-64 is supported or published for `0.1.0`.
- Native interaction checks, dogfood, and beta can discover post-release defects; safety findings are triaged before expanding distribution.
- Future Windows 10, macOS, Linux, signing, native-performance, dogfood, or beta claims require new retained evidence and a separately approved compatibility-matrix revision.
- ADR 0008 and ADR 0009 remain historical descriptions of the earlier five-artifact gate; this decision controls where they conflict.
