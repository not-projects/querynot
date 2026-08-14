# Disposable database fixture isolation

Database tests fail closed. They do not read generic database environment variables, scan ports, inspect local client configuration, enumerate database files, or fall back to a developer database.

## Required proof

A network database harness accepts only `--manifest /absolute/non-symlink/path.json`. The manifest must:

- identify `querynot-disposable-fixture-v1`;
- contain a generated marker token of at least 32 characters;
- list every exact target explicitly; and
- contain only short-lived credentials generated for that run.

Before any capability query, the harness reads `querynot_fixture.__querynot_fixture_marker` and compares the database value with the generated manifest token. Missing/mismatched markers stop the entire run. Committed fixture scripts use synthetic values only.

## Fixture commands

The canonical Linux and release-candidate CI path is `npm run fixtures:fetch:native` followed by `npm run test:feasibility:native`. The fetch command downloads only the HTTPS sources in `fixtures/native-feasibility-inputs.json`, verifies their pinned SHA-256 values, and stores them under `/tmp/querynot-native-fixture-cache` without installing packages. The runner verifies every input again, extracts it into a unique temporary directory, generates a two-day fixture CA, server identity, client identity, and credentials, starts each server on a random loopback port, and requires identity-verified TLS 1.2. Phase 3 additionally proves client-certificate enforcement and fail-closed system trust. Phase 4 adds a synthetic table-edit fixture and proves deterministic paging, bound hostile filters, typed validation, generated-value refresh, optimistic conflicts, and full transactional rollback. It shuts down every server and removes all data, secret, certificate, manifest, and log files in a `finally` cleanup path. Only the redacted report is retained.

`npm run test:feasibility` is a supplemental three-image Docker smoke harness. It creates a unique temporary directory, generates a random credential and marker, binds the disposable services only to random loopback ports in a project-scoped Docker network, writes an explicit mode-0600 manifest, runs the same native harness, and deletes the containers, data, credentials, certificates, manifest, and temporary directory. It is not release evidence. If an image's legacy TLS implementation cannot negotiate the required TLS floor, the smoke run fails closed; it never selects a weaker application TLS backend or protocol.

The checked Phase 0 targets are MySQL 5.7.44, MySQL 8.4.10, and MariaDB 11.4.12. Phase 3 conformance adds MySQL 8.0.46 and MariaDB 10.11.18 and runs the same common adapter assertions on all five exact archives. Phase 4 uses `npm run test:conformance:phase4` to extend that exact matrix without changing fixture provenance. SQLite feasibility and table-edit fault coverage use disposable databases under `querynot-core` tests.

## Prohibited behavior

- No test accepts `DATABASE_URL`, `MYSQL_HOST`, default ports, a home-directory configuration, or a discovered socket.
- No fixture server or test connection uses a non-loopback endpoint in local/CI automation. The native fetch command contacts only the checksum-pinned HTTPS archive URLs in its checked-in input manifest.
- No fixture output records endpoints, generated credentials, marker tokens, SQL result values, or container data volumes.
- Test failure never weakens TLS, marker validation, or cleanup assertions.
