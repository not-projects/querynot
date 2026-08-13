# Unsigned release-candidate installation

Status: procedure for reviewed release-candidate artifacts; no artifact is a supported release until the Phase 5 evidence gate passes.

QueryNot's initial packages are intentionally unsigned and, on macOS, unnotarized. Verify the SHA-256 digest published with the release before opening a package. The application has no self-updater and never asks you to disable an operating-system security feature.

## Verify the download

Use the filename and digest from the release's `SHA256SUMS` file. A mismatch means the package must not be installed.

### Windows PowerShell

```powershell
Get-FileHash -Algorithm SHA256 .\QueryNot_0.1.0_x64-setup.exe
```

Compare the complete 64-character `Hash` value with the matching line in `SHA256SUMS`. The comparison is case-insensitive.

### macOS

```sh
shasum -a 256 QueryNot_0.1.0_aarch64.dmg
```

Use the x86-64 DMG filename instead on an Intel Mac.

### Linux

```sh
sha256sum QueryNot_0.1.0_amd64.AppImage
sha256sum QueryNot_0.1.0_amd64.deb
```

## Windows 10 22H2 and Windows 11

The x86-64 NSIS installer is per-user and requires an already installed, supported Microsoft Edge WebView2 runtime. It does not download a runtime silently.

1. Verify the installer checksum.
2. Open the NSIS `.exe`.
3. Confirm that Windows identifies an unrecognized or unknown publisher. If Microsoft Defender SmartScreen blocks the reviewed file, choose **More info**, verify the QueryNot filename again, and then choose **Run anyway**.
4. Complete the current-user installation and launch QueryNot.
5. If the WebView2 runtime is absent, cancel, install a supported runtime through Microsoft's documented administrator-approved process, and repeat. Do not weaken SmartScreen or system security policy globally.

Uninstall QueryNot from **Settings > Apps** after completing the release-candidate procedure.

## macOS 13 or later

Use the Apple-silicon DMG on Apple silicon and the Intel DMG on Intel hardware. The app carries only an ad-hoc signature; it has no Developer ID signature and is not notarized.

1. Verify the DMG checksum.
2. Open the DMG and drag QueryNot to **Applications**.
3. Attempt to open QueryNot once and acknowledge the unsigned-developer warning without claiming the file is trusted.
4. Open **System Settings > Privacy & Security**, find the message for the blocked QueryNot launch, choose **Open Anyway**, and confirm the one-app exception.
5. Launch QueryNot from **Applications**.

Do not disable Gatekeeper globally, run `spctl --master-disable`, or remove quarantine metadata with `xattr`. Remove QueryNot from **Applications** after completing the release-candidate procedure.

## Ubuntu 22.04 LTS and 24.04 LTS

Both x86-64 formats use the system WebKitGTK runtime. Package-manager dependency prompts must remain visible and administrator controlled.

For AppImage:

```sh
chmod +x QueryNot_0.1.0_amd64.AppImage
./QueryNot_0.1.0_amd64.AppImage
```

For the Debian package:

```sh
sudo apt install ./QueryNot_0.1.0_amd64.deb
```

If the AppImage reports a missing host runtime, stop and record the exact failure in the compatibility evidence; do not add undocumented privileged workarounds. Remove the Debian package through the system package manager after the journey. Remove an AppImage by deleting the reviewed file and any explicitly created desktop entry.

## What to record

For each Phase 5 matrix row retain the exact OS patch, architecture, WebView/WebKit runtime, artifact filename and SHA-256 digest, the warning observed, installation result, core-journey result, and uninstall result. Evidence must be redacted as described in the [Phase 5 procedures](phase5-manual-procedures.md).
