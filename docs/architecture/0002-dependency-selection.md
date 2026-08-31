# ADR 0002: Phase 0 dependency selection

Date: 2026-08-13
Status: Accepted, subject to lockfile audit on every phase and full Phase 5 review

All runtime dependencies are compiled or bundled locally. None requires telemetry, an account, a hosted service, runtime code download, or plaintext secret persistence. Exact transitive versions are in `Cargo.lock` and `package-lock.json`.

| Capability | Selection | License | Gate result and rationale | Exit strategy |
| --- | --- | --- | --- | --- |
| Desktop shell | Tauri `2.11.5`; dialog plugin `2.7.2`; single-instance plugin `2.4.3` | Apache-2.0 OR MIT | Current Tauri 2 line; supports the required native targets, CSP, allowlisted capabilities, native dialogs, and one-window file routing without a second workspace owner | Keep domain logic in `querynot-core`; replace plugins independently or use native Tauri APIs |
| UI compiler/build | Svelte `5.56.9`, Vite `8.2.1`, TypeScript `6.0.3` | MIT; TypeScript Apache-2.0 | Svelte 5 runes and Vite are the official direct-SPA path. TypeScript 7 was rejected because `svelte-check 4.7.6` does not support it | Components use web standards and local CSS; compiler/build pins can move without changing native contracts |
| SQL editor | CodeMirror 6 packages | MIT | Maintained, accessible extension architecture; dialect and metadata completion can be supplied without remote services | Editor service boundary prevents document/session state from depending on CodeMirror classes |
| Result grid | QueryNot-owned Svelte virtualization | Apache-2.0 project code | No selected grid met fidelity, accessibility, bundle, and control requirements better than a narrow local implementation | Grid model and rendering are separate; a future library must pass the same contract tests |
| SQL parser | `sqlparser 0.62.0` plus QueryNot dialect scanners | Apache-2.0 | Extensible lexer/parser; custom boundary/safety logic is still required for tested MySQL/MariaDB/SQLite forms and uncertainty handling | Preserve a small parser facade and corpus so another parser can be substituted |
| SQL formatter | `sqlformat 0.5.0` behind a formatter facade | Apache-2.0 OR MIT | Preserves a native/offline path; acceptance still requires comment and dialect corpus tests | Formatter is advisory and replaceable; it never executes or saves |
| SQLite/MySQL/PostgreSQL drivers | SQLx `0.9.0`, bundled SQLite, Tokio `1.53.1`, rustls/native roots | Apache-2.0 OR MIT | Exact Rust 1.94 line provides async streaming, TLS, transactions, multiple-result primitives, SQLite/MySQL/PostgreSQL support, and compile-time auditing of dynamic SQL. SQLite extension loading is not enabled | Adapter traits isolate SQLx types; conformance data is the replacement gate |
| Credential vault | `keyring 4.1.6`, `secrecy 0.10.3`, `zeroize 1.9.0` | Apache-2.0 OR MIT | Native Windows Credential Manager, Apple Keychain, and Linux Secret Service backends; no file fallback is configured | Vault facade supports session-only behavior and explicit platform replacements |
| Encrypted client keys | `pkcs8 0.10.2` with PEM and encryption support | Apache-2.0 OR MIT | Decrypts an explicitly selected encrypted PKCS#8 client key only in native memory using the OS-vault or session-only passphrase; profile storage keeps only paths and an opaque secret reference | The connection-secret bundle and driver boundary isolate the decoder; another reviewed PKCS#8 implementation can replace it |
| Serialization/contracts | Serde `1.0.229`, JSON schema in `contracts/`, checked Rust/TypeScript generation | Apache-2.0 OR MIT | One reviewed source defines all public request/response/event shapes; stale bindings fail CI | The schema is format-neutral and the generator is repository-owned |
| Frontend tests | Vitest `4.1.10`, Playwright `1.62.1`, jsdom `29.1.1` | MIT; Playwright Apache-2.0 | Unit/component/browser and cross-platform end-to-end coverage without a hosted service | Tests use standard DOM/accessibility contracts and can migrate runners |
| Rust tests | built-in harness, Tokio tests, Proptest `1.11.0` | Apache-2.0 OR MIT | Unit, async, property, fixture, and fault tests run locally and in CI | Test IDs and fixture formats are project-owned |

## Security and maintenance review

- `npm audit` reported zero known vulnerabilities for the initial lockfile on 2026-08-13.
- The 2026-08-13 RustSec review covered 583 locked crates and reported zero known vulnerabilities. Informational GTK3, procedural-macro, and rust-unic maintenance notices plus one unreachable `glib::VariantStrIter` unsoundness notice are recorded with explicit paths, reachability, disposition, and Phase 5 expiry in [the dependency risk register](../security/dependency-risk-register.md).
- `deny.toml` denies new advisories, yanked crates, unknown sources, wildcard requirements, unlicensed crates, and licenses outside the reviewed Apache-2.0-compatible set. Its ignore list is limited to the risk-register IDs. Critical/high findings cannot be waived under the release severity rubric.
- SQLx's `mysql-rsa` feature is intentionally disabled. QueryNot supports `caching_sha2_password` only over the protected transport required by the PRD.
- SQLx uses bundled SQLite without the `sqlite-load-extension` feature. Initial release extension loading remains disabled.
- Tauri capabilities do not grant general networking, shell/process execution, environment access, or unrestricted filesystem access.
- Lockfiles are mandatory. Renovation requires the same compile, conformance, audit, and evidence gates.
- The Phase 4 lockfile review on 2026-08-14 covered the `pkcs8 0.10.2` encryption path, `tauri-plugin-single-instance 2.4.3`, and their locked transitives. Exact npm policy/audit and `cargo-deny 0.20.2` advisories/licenses/bans/sources checks are retained with the Phase 4 commit-addressed evidence; no new exception was added.

## Primary references reviewed

- Tauri prerequisites and releases: <https://v2.tauri.app/start/prerequisites/> and <https://v2.tauri.app/release/>
- Svelte direct Vite setup: <https://svelte.dev/docs/svelte/getting-started>
- Rust package metadata and features: the versioned crates.io/docs.rs pages referenced by `Cargo.lock`
- npm package metadata: the versioned npm registry records referenced by `package-lock.json`
