# Signed update release procedure

QueryNot `0.1.1` introduced the signed Windows updater channel described by [ADR 0011](../architecture/0011-signed-windows-auto-updates.md). ADR 0016 expands the same dedicated QueryNot trust identity to Windows, Linux, and macOS beginning with the live `0.1.5` release. The first updater-enabled installation on each platform is manual; later releases can be installed from Settings.

## One-time signing identity setup

Generate a dedicated QueryNot updater key in a secure location outside the repository:

```sh
npm run tauri -- signer generate --write-keys <secure-querynot-key-path>
```

Back up the private key and its password in durable maintainer-controlled storage before enabling release CI. Do not put either value in Git, an issue, a task transcript, a build artifact, or application logs. Do not reuse the PostNot private key.

Configure the `not-projects/querynot` repository:

- secret `TAURI_SIGNING_PRIVATE_KEY`: the complete generated private-key value;
- secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the password, when one was selected; and
- variable `QUERYNOT_UPDATER_PUBLIC_KEY`: one-line base64 encoding of the complete generated public-key document.

For example, GNU `base64 -w 0 <public-key-file>` produces the public repository-variable value. The public key is not secret, but it must match the retained private key exactly.

Every platform candidate job validates presence and document shape without printing any key material. Aggregation and publication independently verify every updater payload and Minisign trusted comment against the configured public key without receiving the private key. Missing, malformed, or mismatched configuration fails closed.

## Candidate and publication

1. Push the clean release-preparation commit to `master`.
2. Manually dispatch `CI` on `master`.
3. Review all jobs, the four platform artifacts, and the combined `querynot-release-candidate` artifact. The combined candidate must contain seven installable packages, two additional macOS updater archives, seven matching signatures, the eight-key `latest.json`, `SHA256SUMS`, four inspection reports, and the combined manifest/checksum/candidate reports.
4. Manually dispatch `Publish reviewed signed release` with that successful CI run ID and the exact confirmation `publish-v0.1.7`.
5. The workflow resolves and checks out the candidate run's exact commit, validates and cryptographically verifies all 18 public assets, creates a draft, downloads it, byte-compares every asset with the pre-draft publication plan, re-verifies the checksums, feed, and signatures, then publishes it as the stable release.

The publication workflow has no signing secrets and runs no build or packaging command. A failed run can leave a draft release for inspection; automation does not overwrite an existing tag or asset. The public package matrix is Windows x86-64 NSIS/MSI, Linux x86-64 AppImage/DEB/RPM, and macOS Intel/Apple-silicon DMG, with the updater payload mapping documented in ADR 0016.

The current completed signed release is `v0.1.7`: candidate CI run `32846689294`, publication run `32850309155`, and source commit `3b2b05899737c875d20b2e48cdb0693bef0599e9`. The first signed-channel evidence remains under `evidence/release-updates/0.1.1`.

## Rotation and recovery

Do not rotate the updater key casually. Installed releases trust the public key compiled into them. Planned rotation requires a transition release signed by the old key and designed to establish the new trust path. If the private key is lost, existing installations cannot trust a newly generated identity automatically.
