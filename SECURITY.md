# Security Policy

## Supported Versions

QueryNot `0.1.6` is the current public release for Windows 11 x86-64, Linux x86-64, macOS Intel, and macOS Apple silicon under one signed updater contract. The source tree is prepared as `0.1.7` pending signed candidate validation and publication. Security fixes are applied on a best-effort basis to the current `master` branch and supported release line.

| Version | Supported |
| --- | --- |
| `master` | Yes |
| `0.1.x` | Yes |

## Reporting a Vulnerability

Please report suspected vulnerabilities privately.

- Preferred: use GitHub private vulnerability reporting from the repository's **Security** tab when available.
- Fallback: contact the repository owner privately through a non-public method listed on the maintainer's GitHub profile.
- Do not open a public issue, discussion, or pull request for a suspected vulnerability.

Include what you safely can:

- affected commit or branch
- impact and likely attacker capabilities
- redacted reproduction steps or proof of concept
- operating system and database engine involved
- whether credentials, TLS, SQL execution, local files, history, exports, or logs are affected
- suggested mitigation, if known

Never include live credentials, production connection strings, private certificates, or sensitive database contents.

## Priority Areas

Reports in these areas are especially important:

- connection-string and database-credential storage
- TLS verification and transport configuration
- unintended, altered, or insufficiently confirmed SQL execution
- unsafe table targeting, identifier/value interpolation, optimistic-conflict checks, or partial mutation rollback
- secret leakage through logs, history, exports, screenshots, diagnostics, or crash reports
- local persistence permissions and database-file exposure
- import, export, and local-file handling
- isolation of test fixtures from real databases
- release signing, updater-key custody, manifest integrity, and update handoff

## Response and Disclosure

Security work is handled on a best-effort basis while QueryNot is pre-alpha. Maintainers will acknowledge, investigate, and coordinate disclosure as capacity allows.

Please allow reasonable time for investigation and mitigation before public disclosure. Reporters who want attribution will be credited when a fix or mitigation is announced.
