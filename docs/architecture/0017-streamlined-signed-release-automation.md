# ADR 0017: Streamlined signed release automation

- Status: Accepted
- Date: 2026-08-25
- Decision owner: QueryNot product owner
- Supersedes: Routine full draft downloads and candidate orchestration in ADR 0016

## Context

The cross-platform release boundary already validates the exact source, package inventory, checksums, updater manifest, and all seven updater signatures before creating a draft. The publication workflow then uploaded those 18 reviewed assets and downloaded every asset again to compare the same bytes. Candidate dispatch also reran ordinary frontend, browser, Rust, and desktop CI even though the exact release commit had already passed that matrix on `master`.

Those repeated transfers and builds increased release time and introduced extra failure points without testing a distinct trust boundary. Large installer formats are already compressed, so recompressing them for short-lived workflow artifacts added CPU time with little storage benefit. Post-publication evidence and documentation commits also triggered application and desktop matrices even when no executable or release input changed.

GitHub's release API exposes the size and server-computed `sha256:` digest for every uploaded release asset. GitHub's artifact service also transports candidate artifacts between jobs; QueryNot still validates their internal hashes, signatures, source commit, and exact inventory after download. See the official [release asset response](https://docs.github.com/en/rest/releases/releases) and [workflow artifact digest behavior](https://docs.github.com/en/actions/tutorials/store-and-share-data).

## Decision

Ordinary `CI` and `Build signed release candidate` are separate workflows. Candidate dispatch is allowed only on `master` and automatically requires a successful push-triggered `CI` run for the exact candidate commit. It does not rerun the ordinary CI matrix. The candidate workflow runs the checksum-pinned five-server feasibility gate, builds and inspects the four platform targets, verifies signatures and combined metadata, retains a small human-review artifact for 30 days, and retains the unrecompressed publication candidate for 14 days. Per-platform transfer artifacts expire after one day.

Publication keeps the existing no-rebuild and least-privilege boundary. It receives no signing private key, downloads the combined candidate once because those files must be uploaded, verifies the candidate and every updater signature, stages exactly 18 public assets, and creates an unpublished draft at the exact candidate commit. Before publication it compares the draft's exact name, count, uploaded state, byte size, and GitHub-computed SHA-256 digest with the local publication plan. A missing digest, duplicate, extra asset, size change, hash change, tag change, source change, or state change fails closed.

A valid existing draft for the same tag and commit can be reused after a transient workflow failure. An incomplete or mismatched draft is never repaired or overwritten automatically. After publication, the workflow verifies the same inventory in public state and downloads only `latest.json` and `SHA256SUMS` through the stable public endpoint, retrying boundedly for propagation and matching both files to the publication plan. The previous full-package download verifier remains available as an optional deep audit for incidents or periodic assurance; it is not part of every release.

CI classifies changed paths with a checked-in, unit-tested, fail-closed script. Documentation, retained evidence, and traceability-only changes run the stable `frontend-and-policy` check with contracts, traceability, unit tests, and formatting. Application, automation, dependency, packaging, version, or versioned release-note changes run the complete existing frontend, browser, Rust, dependency, and desktop matrices. Empty, malformed, or unknown path sets always choose full CI.

## Consequences

- The release still publishes only reviewed, signed, exact-source bytes; no trust check is replaced by filename or operator judgment.
- A normal release transfers the large candidate once during publication instead of once plus a complete draft download.
- Candidate packaging reuses exact-commit CI and avoids duplicate browser and five-platform compile matrices.
- Human review uses compact reports and checksums rather than downloading installers.
- Candidate publication must happen within 14 days or the candidate is rebuilt from a newly validated commit.
- GitHub release asset digests are now a required platform capability. Their absence blocks publication and the optional full-download verifier remains the fallback audit tool.
- Documentation-only finalization is fast, while every source or release-input change still fails closed to full CI.
