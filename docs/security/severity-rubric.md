# Release security severity rubric

This rubric applies to code defects, dependency findings, manual review observations, and unsupported assumptions. The highest applicable impact wins; generic package scores do not lower a product-specific classification.

## Critical

- credential, reusable secret, client-key, or unredacted connection-string disclosure;
- arbitrary native command, shell, process, filesystem, or network access across the webview boundary;
- automatic TLS verification downgrade or a protected mode silently becoming unverified/plaintext;
- cross-profile/session resource access that can read or alter another connection's data;
- generated or user-authorized mutation targeting unintended rows without an immutable preview/confirmation boundary; or
- an automated fixture escaping to a non-disposable database.

## High

- incorrect transaction state causing an unintended commit, replay, or loss of a rollback boundary;
- multi-row mutation where exactly one row was authorized;
- secrets or sensitive result/query/file metadata entering persisted logs, diagnostics, history, drafts, screenshots, or release artifacts contrary to policy;
- export/SQL-file overwrite without the required explicit decision or recovery path;
- hostile database/file content reaching executable HTML/script, commands, or unconfirmed path opening; or
- a local-store migration destroying/replacing the last valid store.

## Medium

A bounded failure can lose non-transactional workspace state, misreport a capability without executing it, weaken an accessibility requirement, or leak non-secret local product metadata, with no credential disclosure or unintended database mutation.

## Low

Cosmetic, documentation, minor performance, or low-impact workflow defects with no safety-boundary consequence.

## Release rules

Known critical/high issues block every phase exit that exposes the path and block release. False positives and unreachable findings require retained proof. Critical/high exceptions are forbidden. Medium/low exceptions require owner, rationale, mitigation, affected matrix entries, and expiry in the evidence bundle.
