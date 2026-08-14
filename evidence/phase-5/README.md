# Phase 5 release-candidate evidence

This directory intentionally contains only templates until the named human and native-platform procedures are actually performed. Copy each file from `templates/`, remove the `.example` suffix, replace every placeholder with redacted real evidence, and set `status` to `pass` only after the checked procedure passes against one exact source commit. `performance-raw.json` is a supporting record referenced by `performance-results.json`; the other eight files are the final gate records listed below.

`npm run test:release-evidence` rejects missing files, template values, incomplete matrix rows, insufficient samples, non-consecutive dogfood dates, beta shortfalls, unresolved safety/workspace issues, unverified traceability rows, and a release manifest that is not `ready_to_publish`.

Do not retain credentials, endpoints, database/object names, SQL text with sensitive literals, result values, certificate or key paths, user file paths, private participant identity, or raw driver output. Evidence links must point to repository-safe supporting screenshots, recordings, logs, or reports retained for the release review. A template or one of the eight final record files cannot cite itself as supporting evidence.

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

`operating-system-results.example.json` is already expanded to all eight matrix IDs and the three required OS-family network journeys. Each Windows row contains the reviewed NSIS artifact, each macOS row the reviewed architecture-specific DMG, and each Ubuntu row both reviewed Linux artifacts; every listed package needs its own install, structured core-journey, warning, uninstall, checksum, and retained-evidence result. Expand the dogfood day object to exactly five consecutive working days and retain only tasks applicable on each date while satisfying every frequency rule enforced by the auditor. Populate `performance-raw.json` with every retained native sample; the auditor recomputes the declared percentiles and maxima rather than trusting summary counts.
