# QueryNot 0.1.1 signed-update evidence

This directory retains the repository-side evidence for the first updater-enabled QueryNot release. It does not rewrite or supersede the immutable `0.1.0` Phase 5/6 bundle.

- `local-readiness.json` records the clean, commit-addressed WSL2/frontend/Rust/policy verification for the updater implementation and unchanged 101-requirement/20-acceptance-criterion traceability matrix.
- `ci-readiness.json` records the successful cross-platform push CI for the evidence-bearing implementation commit, while keeping manual feasibility, signed-candidate, and publication gates explicitly unperformed.
- The manually dispatched `CI` run retains the Windows installer, matching updater signature, stable manifest, checksum, and candidate reports as the `querynot-windows-x64` artifact.
- The manual publication workflow retains its exact-candidate staging and draft round-trip reports as `querynot-v0.1.1-publication-evidence`.

The latter two records remain `pending_external_configuration` until the dedicated QueryNot updater key is generated, backed up, and configured through the repository variable/secrets described in `docs/release/signed-updates.md`. No missing Windows signature, candidate run, or publication result may be represented as passed.
