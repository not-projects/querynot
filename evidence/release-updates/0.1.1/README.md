# QueryNot 0.1.1 signed-update evidence

This directory retains the repository-side evidence for the first updater-enabled QueryNot release. It does not rewrite or supersede the immutable `0.1.0` Phase 5/6 bundle.

- `local-readiness.json` and `ci-readiness.json` are immutable earlier snapshots. They correctly record that external key configuration, signed candidate packaging, and publication had not yet occurred at those source commits.
- `candidate-inspection.json`, `candidate-checksums.json`, and `candidate-updater-manifest-report.json` retain the passing records from manually dispatched CI run `31843628362` at source `cf14accab85d88cafcccb14a3ddffd6a700b7ada`.
- `publication-plan.json` and `publication-verification.json` retain the exact-candidate staging and draft round-trip records from publication run `31844465799`.
- `public-release-verification.json` records an independent download and verification of the four public assets, including Ed25519-BLAKE2b verification with public key ID `FD25C4E1F33E86DD`.
- `signed-release.json` is the release-level index linking the candidate, publication, public release, exact digests, and two rejected pre-publication attempts.

The stable release is [QueryNot v0.1.1](https://github.com/not-projects/querynot/releases/tag/v0.1.1). No native owner check, dogfood duration, or external beta result is represented as performed.
