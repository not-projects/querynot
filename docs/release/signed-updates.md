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

## Fast release flow

### 1. Prepare one release commit

Update the synchronized application versions, move the changelog entries out of `Unreleased`, and add `docs/release/<version>-notes.md`. The versioned release notes are a packaging input, so changing them always requires full CI. Run the focused local gate before committing:

```sh
npm run test
npm run check
```

Push that single clean release-preparation commit to `master`. Its automatic `CI` run is the authoritative full frontend, browser, dependency, Rust, and desktop validation. Do not manually repeat that matrix.

### 2. Build the signed candidate once

After push CI succeeds, dispatch `Build signed release candidate` on `master`. No run ID or extra confirmation is required. The workflow automatically finds the successful push-triggered `CI` run for its exact commit, then runs only the checksum-pinned five-server gate and four signed packaging jobs.

Review the run summary and the compact `querynot-release-review` artifact. It contains the exact source/version validation, package hashes, updater manifest, checksum file, and inspection reports without the installers. The large `querynot-release-candidate` is automation input and does not need to be downloaded manually. It is retained for 14 days; the small review artifact is retained for 30 days.

The candidate must identify seven installable packages, two additional macOS updater archives, seven matching signatures, the eight-key `latest.json`, `SHA256SUMS`, four inspection reports, and passing combined manifest/checksum/candidate reports.

### 3. Publish the reviewed bytes

Dispatch `Publish reviewed signed release` from the unchanged `master` commit with the exact confirmation `publish-v<version>` and leave the candidate run ID blank. The workflow automatically selects the latest successful candidate for that exact commit. Supply a specific successful candidate run ID only as a recovery override. The workflow:

1. resolves the successful candidate and checks out its exact `master` commit;
2. downloads the combined candidate once, verifies its source, exact inventory, checksums, feed, retained reports, and every updater signature, and stages exactly 18 public assets;
3. creates an unpublished draft, or safely reuses an already complete draft for the same tag and commit;
4. compares every draft asset name, state, byte size, and GitHub-computed SHA-256 digest with the publication plan;
5. publishes the verified draft, verifies the public inventory again, and downloads only `latest.json` and `SHA256SUMS` through the stable public endpoint as a bounded propagation smoke test.

No maintainer download or package-by-package byte check is required in the normal flow. The publication workflow has no signing secret and runs no build or packaging command. It never repairs, replaces, or clobbers an asset.

### 4. Record the release

Record the candidate run, publication run, source commit, and release URL in this document and any versioned release evidence. That follow-up commit contains documentation, evidence, and traceability only, so CI runs the lightweight contracts, traceability, unit-test, and formatting path rather than the browser and desktop matrices. Any application, workflow, dependency, version, packaging, or versioned release-note change still selects full CI.

The public package matrix is Windows x86-64 NSIS/MSI, Linux x86-64 AppImage/DEB/RPM, and macOS Intel/Apple-silicon DMG, with the updater payload mapping documented in ADR 0016 and the streamlined verification boundary documented in ADR 0017.

## Retry and audit rules

- If push CI fails, fix the source and push a new commit. A candidate cannot bypass it.
- If a candidate runner or fixture mirror fails transiently, rerun the failed jobs or dispatch the candidate again for the unchanged commit. Fixture downloads retry transient transport failures and still require the pinned checksum.
- If publication fails after creating a complete draft, rerun the workflow with the same inputs; it reuses that exact draft. If the draft is incomplete or mismatched, inspect it and remove only that unpublished draft before retrying. Automation never overwrites it.
- If the post-publication endpoint smoke test fails, the release may already be public. Inspect the release and updater endpoint rather than rerunning publication blindly.
- For an incident or periodic deep audit, download all public assets once and run the retained verifier:

```sh
gh run download <publication-run-id> --name querynot-v<version>-publication-evidence --dir artifacts
gh release download v<version> --dir artifacts/release-audit
npm run release:verify-update-publication -- --directory artifacts/release-audit --tag v<version> --plan artifacts/publication-plan.json --report artifacts/deep-publication-audit.json
```

The deep audit requires `QUERYNOT_UPDATER_PUBLIC_KEY` because it rechecks every updater signature. It is deliberately optional: normal publication already verifies the candidate signatures locally and GitHub's server-computed digest for every uploaded asset.

The public candidate and publication contract is fail closed. A missing server digest, extra asset, duplicate name, hash or byte-count mismatch, wrong tag/source, invalid signature, or stale confirmation stops publication.

The current completed signed release is `v0.1.7`: candidate CI run `32846689294`, publication run `32850309155`, and source commit `3b2b05899737c875d20b2e48cdb0693bef0599e9`. The first signed-channel evidence remains under `evidence/release-updates/0.1.1`.

## Rotation and recovery

Do not rotate the updater key casually. Installed releases trust the public key compiled into them. Planned rotation requires a transition release signed by the old key and designed to establish the new trust path. If the private key is lost, existing installations cannot trust a newly generated identity automatically.
