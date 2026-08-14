# Phase 5 release evidence

Revision 2 uses a Windows 11 x86-64 release envelope and never treats unperformed manual work as passing.

Release-blocking final records:

- `local-validation-report.json`
- `dependency-review.json`
- `adapter-conformance-report.json`
- `ui-layout-report.json`
- `windows-artifact-inspection.json`
- `windows-checksums.json`
- `SHA256SUMS`
- `packaging-results.json`
- `product-owner-scope.json`

The Linux inspection/checksum files remain commit-addressed WSL2 engineering evidence and are not release artifacts. Templates for accessibility, performance, manual safety, dogfood, beta, and the older eight-row operating-system matrix remain planning aids for post-release or future matrix expansion. They are never evidence that those procedures ran.

`npm run test:release-evidence` rejects missing/stale release-blocking records, extra or substituted package bytes, a scope record that labels post-release work as passed, unsupported compatibility claims, unverified traceability rows, and a release manifest that is not `ready_to_publish`.

Evidence must be redacted. Never retain credentials, endpoints, database/object names, sensitive SQL or result values, certificate/key paths, private participant identity, user paths, or raw driver output.
