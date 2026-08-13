# ADR 0008: Release-candidate packaging and evidence gate

- Status: Accepted for implementation
- Date: 2026-08-14

## Context

The approved initial release is unsigned and unnotarized, has no self-updater, and requires five exact package artifacts plus native-platform, accessibility, performance, safety, dogfood, beta, and traceability evidence. Earlier phase reports prove local implementation slices but cannot establish a release support claim.

## Decision

The unpublished engineering candidate embeds the intended initial-release application version `0.1.0` so Phase 6 can publish the exact artifacts reviewed in Phase 5 without a digest-invalidating rebuild. Tauri bundling produces a current-user x86-64 Windows NSIS installer, architecture-specific macOS DMGs with ad-hoc signing and hardened runtime, and x86-64 Linux AppImage and Debian packages. Default bundle targets are empty so every package build must select its reviewed formats explicitly; updater artifacts remain disabled. Windows packaging does not silently download WebView2; the documented procedure requires a supported runtime.

Packaging CI runs only through manual dispatch and uploads candidate artifacts plus inspection and SHA-256 records. It does not create a public release. A local verifier reruns policy, application, native, dependency, exact five-server conformance, Linux package, artifact-inspection, and checksum gates against a clean source commit.

The packaging matrix uses GitHub's documented hosted-runner architecture labels: [`macos-15-intel` for Intel and `macos-15` for arm64](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). These builds create architecture-specific inputs for review; they do not substitute for the native macOS 13/current compatibility rows. Linux packaging downloads Tauri's five on-demand AppImage helpers only through `scripts/fetch-release-tools.mjs`, which requires the selected byte counts and SHA-256 digests in `fixtures/release-tool-inputs.json`. Every build copies the immutable reviewed inputs into a disposable repository-local Tauri work cache because the bundler patches one helper while it runs.

Human/native results use versioned JSON records under `evidence/phase-5/`. The release-evidence auditor requires one exact clean source commit, all eight OS rows, all five artifacts, native performance samples, named manual reviews, the fixed five-working-day checklist, the opt-in beta threshold, 101 verified requirements, 20 verified acceptance criteria, and zero exceptions. Evidence links must resolve to retained nonempty files inside the Phase 5 bundle.

Phase 6 may publish only the five artifact names and digests recorded in the ready release manifest. No workflow creates updater material, bypasses OS prompts, weakens TLS, uploads diagnostics, or introduces a network service.

## Consequences

- Building a package is development evidence, not compatibility evidence.
- A CI-hosted runner does not substitute for the exact native OS/runtime journey.
- Dogfood and beta elapsed time cannot be compressed or inferred from automated tests.
- Any candidate change invalidates commit-addressed evidence and requires a complete candidate rerun.
- Unsigned installation friction is explicit and retained; signing remains a future product decision.
