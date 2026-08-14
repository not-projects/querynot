# Signed update release procedure

QueryNot `0.1.1` introduces the signed Windows updater channel described by [ADR 0011](../architecture/0011-signed-windows-auto-updates.md). The first updater-enabled release is a manual install; later releases can be installed from Settings.

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

The candidate job validates presence and document shape without printing any key material. Publication independently verifies the installer and Minisign trusted comment against the configured public key without receiving the private key. Missing, malformed, or mismatched configuration fails closed.

## Candidate and publication

1. Push the clean release-preparation commit to `master`.
2. Manually dispatch `CI` on `master`.
3. Review all jobs and the `querynot-windows-x64` artifact. The artifact must contain one NSIS `.exe`, its `.exe.sig`, `latest.json`, `SHA256SUMS`, and the three candidate reports.
4. Manually dispatch `Publish reviewed signed release` with that successful CI run ID and the exact confirmation `publish-v0.1.1`.
5. The workflow resolves and checks out the candidate run's exact commit, validates and cryptographically verifies the four public assets, creates a draft, downloads and re-verifies it, then publishes it as the stable release.

The publication workflow has no signing secrets and runs no build or packaging command. A failed run can leave a draft release for inspection; automation does not overwrite an existing tag or asset.

The first completed signed release is `v0.1.1`: candidate CI run `31843628362`, publication run `31844465799`, and source commit `cf14accab85d88cafcccb14a3ddffd6a700b7ada`. Retained reports are under `evidence/release-updates/0.1.1`.

## Rotation and recovery

Do not rotate the updater key casually. Installed releases trust the public key compiled into them. Planned rotation requires a transition release signed by the old key and designed to establish the new trust path. If the private key is lost, existing installations cannot trust a newly generated identity automatically.
