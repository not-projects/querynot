# Retained release evidence

This directory retains redacted, repository-safe evidence for the release gates in the product requirements. Evidence records never contain credentials, connection endpoints, SQL text with sensitive literals, database metadata, result values, certificate paths, or user file paths.

Every evidence record identifies:

- the exact source commit;
- tested operating system, architecture, runtime, and database/library versions;
- a synthetic or disposable fixture identifier;
- the checked-in command or manual procedure;
- pass, fail, blocked, or not-run status; and
- links to any report, screenshot, recording, benchmark, checksum, or review artifact retained in this directory.

Automated output is evidence only when produced by the checked-in command on the stated commit. Human-only gates such as multi-day dogfood, opt-in beta, installation review, and manual safety review remain incomplete until a named reviewer records a redacted result; they are never inferred from unit tests.

Phase 2 retains both a full local validation report and the raw 30-sample release-build SQLite benchmark report. The benchmark is development evidence for the first-batch processing target only; its recorded limitations keep native WebView FPS, memory return, cold launch, and target-platform interaction performance open for Phase 5.

Phase 3 retains a full local validation report and the raw five-server adapter conformance report. The latter records only exact versions, published archive checksums, selected authentication mechanisms, TLS/capability assertions, and pass/fail booleans; generated endpoints, credentials, fixture markers, certificate paths, SQL values, and server data are never retained.

Phase 4 retains a full local validation report, a refreshed dependency/license/vulnerability review, and the raw five-server table-conformance report. Table evidence adds only deterministic-paging, bound-filter, typed-validation, mutation, generated-refresh, conflict, and rollback booleans. Ephemeral staged values, mutation SQL, parameter values, identifiers from generated databases, and native file paths are never retained.

Phase 5 contains a procedure README and eight `not_run` templates until real native/human results are recorded. Candidate package builds or CI configuration alone are not release evidence. The final auditor requires retained files under `evidence/phase-5/`, exact commit continuity, five reviewed package digests, the eight-row OS matrix, named accessibility/performance/safety/security results, the fixed dogfood period, the opt-in beta threshold, verified traceability, and a ready release manifest.
