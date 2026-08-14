# Phase 5 and post-release validation procedures

Status: revision-2 release procedure plus retained post-release owner checks.

These procedures use only synthetic SQLite files and explicitly provisioned disposable MySQL/MariaDB fixtures. Never retain production credentials, endpoints, metadata, SQL, result values, certificate paths, participant identities, or user file paths.

## Release-blocking candidate lock

1. Select one clean 40-character source commit.
2. Run `npm run verify:phase5:local` in the approved WSL2 environment. Retain the resulting local validation, dependency, five-server conformance, and UI-layout reports. WSL2 does not produce a release artifact.
3. Produce one Windows x86-64 NSIS package from that source with the manually dispatched `release-candidate-packages` CI job. Do not build macOS or public Linux artifacts for `0.1.0`.
4. Download the Windows artifact without renaming it. Inspect its package/binary material and generate the sole release `SHA256SUMS` record.
5. Freeze the exact Windows 11 patch, WebView2 version, package name, byte count, and digest in the compatibility matrix and release manifest.
6. Retain `evidence/phase-5/product-owner-scope.json`. It must identify Windows 11 x86-64 as the only release row and list every native interaction, manual, dogfood, and beta procedure below as unperformed or deferred post-release work, never `pass`.
7. Set every traceability row to `verified` only when its revised release-blocking automated mappings passed against the source commit and retained evidence exists.
8. From a clean evidence commit, run `npm run test:release-evidence`. Missing or substituted Windows bytes, extra packages, stale commits, incomplete automated gates, unsupported platform claims, fabricated manual results, or an incomplete traceability row fail closed.

## Automated UI-layout procedure

`npm run test:ui-layout` launches the repository app in pinned Chromium and checks 2048px, 1280px, 960px, and 720px widths at a 1068px viewport height. It requires a content-height status bar at the viewport bottom, no page-level horizontal overflow, an opaque settings dialog under System/Light/Dark/Forest, and the exact PostNot theme names. The report and representative screenshot are generated under ignored `artifacts/` output and the pass is included in the commit-addressed Phase 5 local report.

## Post-release native Windows owner journey

After `0.1.0` is published, the product owner uses the exact released installer and records redacted results for:

1. SHA-256 verification, the expected per-application SmartScreen warning, current-user install, launch, close, relaunch, and uninstall.
2. First-run keyboard reachability and absence of unsolicited network access.
3. Open and create SQLite file flows, read-only mode, schema navigation, connection-bound tabs, visible engine/context/transaction/job state, and profile deletion.
4. MySQL/MariaDB profile, OS-vault and session-only credentials, every TLS mode, MariaDB identity, MySQL legacy indicators, simultaneous connections/tabs, and clean vault/cache deletion against disposable fixtures.
5. Selection/current-statement/Run-all execution, scalar/empty/large/failing/multiple results, cancellation, copy, filter/sort, Load more, and received-row CSV/JSON export.
6. Keyed table paging and filters, staged insert/update/delete preview, successful apply, injected conflict/failure, generated-value refresh, and full rollback.
7. Destructive confirmation and invalidation, history controls, drafts, SQL-file open/save/save-as/external-change handling, tab workflows, connection loss, reload, transaction close, and non-executing restoration.
8. System/Light/Dark/Forest, keyboard/focus/roles, 80%–200% UI scale, reduced motion, bounded scrolling, and representative assistive-technology checks.
9. Native interaction performance, resident memory, and cleanup behavior on the documented reference fixture.
10. Credential persistence, diagnostic redaction, fixture isolation, CSP/capabilities, local-file boundaries, and the security severity rubric.

Any secret disclosure, TLS downgrade, unintended mutation, failed rollback, fixture escape, corrupted recovery, or workspace loss is handled as a safety finding before distribution expands.

## Post-release fixed dogfood

Follow PRD section 14.3 over five consecutive working days. DOG-1, DOG-2, DOG-3, DOG-4, DOG-6, and DOG-9 run daily; DOG-8 runs on days two through five; DOG-5 runs at least once; DOG-7 includes one successful apply and one rollback or injected-conflict path. Retain redacted timings and record every fallback or defect. This procedure is not claimed as performed before `0.1.0`.

## Post-release opt-in beta

When participants exist, obtain explicit opt-in from at least five external developers and use private pseudonymous IDs. Each participant attempts the scripted core journey with synthetic data. At least four should complete without maintainer intervention, and every participant must finish without an unresolved data-safety issue or workspace loss before a broader platform announcement. This procedure is not claimed as performed before participants are acquired.

## Phase 6 publication

After the release-blocking audit passes, manually dispatch `.github/workflows/release.yml` from the evidence commit with the successful Windows candidate run ID and literal `publish-v0.1.0` confirmation. The workflow downloads rather than rebuilds the candidate, stages only the reviewed NSIS file and checksum, creates an unpublished draft at the audited evidence commit, round-trip verifies the draft bytes, and publishes only after exact verification.
