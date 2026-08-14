# Initial-release failure triage

Status: Phase 6 operating policy. This ordering applies to candidate, publication, installation, and post-release failures.

QueryNot does not collect telemetry. Reports are opt-in and must be redacted before they enter issues, release evidence, or diagnostics. Suspected vulnerabilities follow [SECURITY.md](../../SECURITY.md) privately rather than this public workflow.

## Priority order

1. **Data safety and security — release blocking.** Credential or private-key exposure; weakened TLS; unintended SQL or wrong-target execution; failed destructive confirmation; partial or mis-targeted row edits; failed rollback; corrupt or silently lost local state; export overwrite or local-file escape; fixture escape; unredacted sensitive data; or a critical/high dependency or application issue. Stop the affected gate or publication, preserve redacted evidence, and resolve and rerun the complete applicable journey before continuing.
2. **Reliability — release blocking when unresolved.** Crash, hang, cancellation/resource leak, corrupted restore, unusable installation/uninstallation, transaction-state uncertainty, cross-session leakage, migration failure without recovery, or failure of a claimed compatibility row. Reproduce with synthetic data, record the exact matrix row and state transition, fix it, and rerun the applicable automated and native gates.
3. **Workflow friction.** Confusing interaction, slow routine task, visual defect, unclear warning, or documentation gap that does not threaten data or prevent the supported journey. Record it after higher-impact failures and fix it without weakening a safety or reliability control.

Severity is based on impact, not report order, polish, or implementation effort. A workflow workaround cannot downgrade a data-safety or reliability failure. No issue is closed as unsupported merely because the failing version is unlisted until maintainers confirm that the supported boundary and warning behaved correctly.

## Intake record

Retain only the minimum safe record:

- release version, package filename and SHA-256, exact supported-matrix row, and application state;
- synthetic reproduction and expected/actual behavior;
- whether credentials, TLS, SQL targeting, transactions, row editing, exports, local files, persistence, diagnostics, or fixture isolation may be affected;
- redacted logs or screenshots only after explicit review;
- owner, priority, resolution, affected tests, and rerun evidence.

Never request or retain production credentials, connection strings, certificates, endpoints, metadata, SQL, result values, private paths, or participant identity. If a failure leaves a draft release or tag, inspect the failure and artifact digests before any deliberate cleanup; publication automation does not overwrite or delete release material automatically.
