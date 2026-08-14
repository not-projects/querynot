# ADR 0009: Exact reviewed-artifact publication

- Status: Accepted for implementation
- Date: 2026-08-14

## Context

Phase 5 can prove that one exact source commit and five exact unsigned packages meet the approved release gates. Phase 6 must not rebuild those packages, substitute same-named files, publish before the gate, or let a partial upload become a public release. Release notes must preserve the tested support boundary and distinguish post-release roadmap ideas from shipped behavior.

## Decision

`scripts/release-publication.mjs` is the publication boundary. It first runs the complete Phase 5 evidence auditor against a clean evidence commit. It then requires the release manifest's `0.1.0` version and `v0.1.0` tag, exact source commit, five artifact IDs, filenames, byte counts, SHA-256 digests, and sole retained `SHA256SUMS` link to agree with the passing packaging evidence. Downloaded files are regular, nonempty, non-symlink files; extra packages, duplicate names, path traversal, digest changes, byte-count changes, updater material, or a checksum-file byte change fail closed.

The manual `release.yml` workflow receives only a reviewed candidate workflow-run ID and the literal `publish-v0.1.0` confirmation. It downloads the four immutable candidate artifact archives without running a build or package command. The verifier copies only the five reviewed packages and retained checksum file into an isolated staging directory. GitHub CLI creates an unpublished draft targeted at the audited evidence commit. The workflow fetches the created tag, requires it to resolve to that evidence commit, downloads the draft assets, and reruns the same byte-level contract before changing the draft to public. The evidence auditor separately proves that only evidence, traceability, and the approved public closure documents differ from the manifest's reviewed binary source commit. This lets versioned documentation expose the frozen support matrix without attributing a rebuilt binary to it. The workflow never uses asset clobbering or automatic note generation.

The checked-in release notes describe the unsigned warnings, checksum procedure, exact compatibility-matrix boundary, local-only behavior, and unsupported roadmap. The Phase 6 failure policy orders data-safety/security failures before reliability and workflow friction. It does not collect telemetry or invite sensitive reports into public evidence.

## Consequences

- Publication remains impossible until every Phase 5 record, all 101 requirements, all 20 acceptance criteria, and the ready manifest pass the authoritative auditor.
- A publication run consumes reviewed bytes from an earlier candidate run; it cannot repair or rebuild them.
- A failure after draft creation deliberately leaves an unpublished draft and tag for human inspection. Automation does not overwrite or delete release state.
- Publication is a material external action and therefore remains manual even after the gate passes.
- The GitHub release and uploaded publication verification report provide the Phase 6 handoff evidence; repository evidence can record their redacted identifiers after success.
