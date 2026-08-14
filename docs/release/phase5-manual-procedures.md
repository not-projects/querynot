# Phase 5 release-candidate procedures

Status: executable procedures; results have not passed until the corresponding committed evidence record says `pass` for one exact candidate commit.

These procedures close the native-machine and human-review portions of the approved PRD. They use only synthetic SQLite files and explicitly provisioned disposable MySQL/MariaDB fixtures. Never use production credentials, endpoints, metadata, SQL, result values, certificate paths, participant identities, or user file paths in retained evidence.

## Candidate lock and evidence rules

Before any run:

1. Select one clean 40-character source commit and build all artifacts from it.
2. Run the complete local gate with `npm run verify:phase5:local` and retain its reports.
3. Produce the four platform builds from a single manually dispatched `release-candidate-packages` CI run. Download the packages, inspection reports, and aggregate checksum manifest without renaming files.
4. Record every package in `evidence/phase-5/packaging-results.json`, including the exact byte count, SHA-256 digest, unsigned state, and inspection evidence link.
5. Copy each remaining `.example.json` template from `evidence/phase-5/templates/`, remove `.example`, and replace every placeholder. A reviewer may set `status` to `pass` only after every check in that record passes.

Raw evidence must live under `evidence/phase-5/`, be nonempty and nonsymlinked, and be referenced by repository-relative path. Screenshots must be cropped or redacted before they enter Git. Each rerun replaces the entire candidate evidence set; do not combine results from different source commits.

Traceability may append a colon and a subcase label to a procedure ID—for example, `P5-MAN-OS-CORE:CONNECTION-PROFILE-JOURNEY`. The prefix names the procedure below and the suffix names the requirement-specific observation that must be retained during that procedure; it does not create a separate or narrower pass rule.

## P5-MAN-OS-CORE — installation and core journey

Run on all eight rows in `docs/compatibility-matrix.md`: Windows 10 22H2 x86-64, the selected Windows 11 patch x86-64, macOS 13 on Intel and Apple silicon, the selected current macOS on Intel and Apple silicon, and Ubuntu 22.04/24.04 x86-64. Record the exact OS patch and exact WebView/WebKit runtime.

For each row and each package format applicable to that row:

1. Start from a machine or VM without QueryNot application data. Verify the package digest, follow `unsigned-installation.md`, record the expected unsigned warning, and launch the installed app.
2. Confirm the first-run shell is keyboard reachable and makes no network request before an explicit connection action.
3. Create an application-owned synthetic SQLite file profile, test it, connect, navigate progressive schema metadata, open a connection-bound query tab, and confirm visible engine/profile/context/transaction/job state.
4. Exercise selection, current-statement, and explicit Run all targeting. Run scalar, empty, large, failing, multi-statement, Unicode, null, binary, decimal, date/time, and large-value fixture queries. Cancel a deliberately long-running disposable-fixture query and record the adapter-reported outcome.
5. Inspect multiple results and messages; copy a cell/row, sort and filter loaded rows, load another tranche, and export received rows to new CSV and JSON files through the native chooser. Confirm overwrite requires a separate decision and interrupted export preserves the previous destination.
6. Browse a keyed synthetic table. Exercise deterministic paging and bound filters; stage typed insert/update/delete operations; compare the immutable preview; apply one batch; then inject a conflict or operation failure and confirm full rollback. Confirm unstable paging is labelled read-only.
7. Exercise destructive confirmations for `DROP`, `TRUNCATE`, and missing/ineffective/uncertain `DELETE` and `UPDATE` predicates. Change SQL or context and confirm approval invalidation.
8. Exercise history enable/pause/retention/clear/disable, local draft restore, SQL-file open/save/save-as/external-change review, tab duplication/rename/pin/reorder, a manual transaction close warning, connection loss, and frontend reload. Confirm no SQL or open transaction replays automatically and no results, staged edits, or credentials persist.
9. On each OS family, repeat profile/vault/session-only credential ownership, TLS modes, MariaDB identity, MySQL legacy indicator, multiple simultaneous connections/tabs, and clean profile/vault/cache deletion with an explicitly provisioned network fixture. The exact five database versions remain governed by the Phase 5 adapter-conformance report.
10. Close QueryNot, relaunch to inspect restoration, uninstall it through the documented OS path, and record the uninstall result. Verify user data is handled according to the explicit delete/reset actions exercised; an uninstaller must not silently destroy unrelated user files. Repeat the complete journey for both the AppImage and Debian package on each Ubuntu row; a passing journey for one format cannot cover the other.

Record the row in `operating-system-results.json`. Any unplanned privilege escalation, undocumented prompt bypass, crash, cross-profile leakage, secret disclosure, unintended mutation, failed rollback, corrupted restore, or fixture escape fails the row.

## P5-MAN-A11Y — accessibility and visual review

On every OS matrix row, inspect light, dark, and forest themes at 1280px, 960px, and 720px workspace widths and at 80%, 100%, and 200% UI scale. Exercise the entire P5-MAN-OS-CORE journey by keyboard, including tablist arrow/Home/End behavior, schema tree navigation, editor escape paths, grids, drawers, native file dialogs, confirmations, destructive dialogs, table preview, and close blockers.

The named reviewer records WCAG 2.2 AA results, visible and restored focus, roles/names/states for tabs/tree/dialogs, non-color status cues, reduced-motion behavior, bounded editor/grid scrolling, and absence of page-level horizontal scrolling. Retain redacted screen-reader output and representative screenshots or recordings in `accessibility-results.json`; an automated semantic check alone cannot pass this procedure.

## P5-MAN-PERF — native performance

Use an otherwise idle native machine with at least four modern CPU cores, 16 GiB RAM, and SSD storage. Record OS/runtime, CPU, memory, storage, power mode, display scale, build commit, and commands. Use the PRD ordinary 10,000-row/12-column fixture and large 100-namespace/10,000-object schema fixture.

Discard one setup run, then retain at least 30 independent samples for each measurement. Measure cold launch to interactive restored shell, local typing/tab/tree response, first-driver-row to first-visible-batch overhead, editor typing FPS, result-scroll FPS, settled idle resident memory, and the ratio between pre-query memory and memory ten seconds after closing the ordinary result. Confirm progressive cancellable schema loading and the documented rendered-row bound. Record raw samples and calculation method in files referenced by `performance-results.json`.

The limits are strict: cold launch p95 at most 3000ms; local response and first-visible-batch p95 at most 100ms; typing and scrolling p95 at least 55 FPS; idle memory below 250 MiB; cleanup ratio at most 1.15; progressive schema and bounded rendered rows must pass.

## P5-MAN-SAFETY — manual safety review

A named reviewer performs and retains redacted evidence for all nine IDs in `manual-safety-review.json`: credential persistence, every TLS mode and failure category, diagnostic redaction, immediate history clearing, destructive confirmations, transaction-close decisions, export overwrite/interruption, unsigned installation guidance, and proof that test harnesses cannot discover or reach a non-fixture database. Any credential, private key, endpoint, sensitive SQL/result, arbitrary filesystem access, silent TLS downgrade, ambiguous mutation, or unrelated-state corruption fails the review.

## P5-MAN-SECURITY — release security review

A named reviewer applies `docs/security/severity-rubric.md` to credential handling, TLS, SQL targeting, transactions, row editing, exports, local-file access, and secret redaction. Re-run exact npm and Rust dependency/advisory/license/source gates, inspect CSP and Tauri capabilities, examine the built-artifact inspection reports, and review every finding and accepted dependency note. `known_critical` and `known_high` must both be zero; the approved baseline permits no release exception.

## P5-MAN-DOGFOOD — fixed five working days

The project owner follows PRD section 14.3 without changing its tasks or pass rule. Record exactly five consecutive working dates. DOG-1, 2, 3, 4, 6, and 9 pass every day; DOG-8 passes on days two through five; DOG-5 passes at least once; DOG-7 includes one successful apply and one rollback or injected-conflict path. Across the period, DOG-1 includes a created/edited and tested profile, DOG-4 includes selection/current-statement/Run all, and DOG-6 includes copy, filter or sort, Load more, and CSV or JSON export.

Retain at least five redacted timings for profile-to-editable-tab and table-to-known-row-copy. Their medians must be under 5000ms and 10000ms respectively. No in-scope fallback client or unrecoverable workspace loss is allowed. Every observed failure must be resolved and rerun successfully before the record can pass.

## P5-MAN-BETA — opt-in beta

Obtain explicit opt-in from at least five external developers and assign private pseudonymous IDs. Each participant attempts the scripted P5-MAN-OS-CORE journey with synthetic data. At least four complete without maintainer intervention, and every participant must finish with no unresolved data-safety issue or workspace loss. Retain only consent-safe, redacted result evidence; do not commit identity or contact information.

## P5-MAN-EVIDENCE — final Phase 5 gate

After all candidate evidence is committed, update every traceability row to `verified` with exact evidence links, freeze exact OS/runtime/package/database combinations in the compatibility matrix, and update `evidence/release/manifest.json` with the exact source commit, application version and release tag, five reviewed artifact filenames/byte counts/digests, the sole retained checksum path, Phase 5 reports, and zero exceptions. Set `release_status` to `ready_to_publish` only then. From a clean checkout at that exact commit, run:

```sh
npm run test:release-evidence
```

The command must pass with all 101 requirements and all 20 acceptance criteria verified. A missing file, stale commit, unsupported claim, placeholder, evidence link outside the Phase 5 bundle, incomplete dogfood/beta record, or unverified must row blocks Phase 6.

After it passes, manually dispatch `.github/workflows/release.yml` from the evidence commit with the successful candidate packaging run ID and the literal `publish-v0.1.0` confirmation. The workflow downloads rather than rebuilds the candidate, reruns this evidence gate, matches all package bytes to the manifest and `SHA256SUMS`, creates an unpublished draft tagged at the audited evidence commit, round-trip verifies the draft assets, and publishes only after that verification. The manifest and audit retain the distinct reviewed binary source commit, while the tag exposes the frozen matrix and evidence closure. A failed run may leave a draft and tag for deliberate inspection; do not overwrite or delete them without resolving the failure.
