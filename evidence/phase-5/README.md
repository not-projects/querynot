# Phase 5 release-candidate evidence

This directory intentionally contains only templates until the named human and native-platform procedures are actually performed. Copy each file from `templates/`, remove the `.example` suffix, replace every placeholder with redacted real evidence, and set `status` to `pass` only after the checked procedure passes against one exact source commit.

`npm run test:release-evidence` rejects missing files, template values, incomplete matrix rows, insufficient samples, non-consecutive dogfood dates, beta shortfalls, unresolved safety/workspace issues, unverified traceability rows, and a release manifest that is not `ready_to_publish`.

Do not retain credentials, endpoints, database/object names, SQL text with sensitive literals, result values, certificate or key paths, user file paths, private participant identity, or raw driver output. Evidence links must point to repository-safe screenshots, recordings, logs, or reports retained for the release review.

Required final files:

- `operating-system-results.json`
- `packaging-results.json`
- `accessibility-results.json`
- `performance-results.json`
- `manual-safety-review.json`
- `security-review.json`
- `dogfood-record.json`
- `beta-record.json`

Templates are planning aids and are never release evidence.

The committed `local-validation-report.json`, `dependency-review.json`, `adapter-conformance-report.json`, `linux-artifact-inspection.json`, `linux-checksums.json`, and `SHA256SUMS.linux` are partial, commit-addressed local automation evidence. They deliberately leave the Phase 5 gate incomplete and are not substitutes for any required final file above.

Expand `operating-system-results.example.json` to all eight matrix IDs. Each Windows row contains the reviewed NSIS artifact, each macOS row the reviewed architecture-specific DMG, and each Ubuntu row both reviewed Linux artifacts; every listed package needs its own install, core-journey, warning, uninstall, checksum, and retained-evidence result. Expand the dogfood day object to exactly five consecutive working days and retain only tasks applicable on each date while satisfying every frequency rule enforced by the auditor.
