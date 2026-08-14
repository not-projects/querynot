# Unsigned QueryNot 0.1.0 installation

Status: reviewed Windows 11 x86-64 release artifact.

QueryNot's initial Windows package is intentionally unsigned. Verify the SHA-256 digest published with the release before opening it. The application has no self-updater and never asks you to disable an operating-system security feature.

## Verify the download

Use the filename and digest from the release's `SHA256SUMS` file. A mismatch means the package must not be installed.

The reviewed `0.1.0` installer is `QueryNot_0.1.0_x64-setup.exe`, 3,120,800 bytes, with SHA-256 `3a0b5cf5eecd74ccba7668f0ad6ed59a5de8b927b78d2943dc3dabd7f286b84d`.

### Windows PowerShell

```powershell
Get-FileHash -Algorithm SHA256 .\QueryNot_0.1.0_x64-setup.exe
```

Compare the complete 64-character `Hash` value with the matching line in `SHA256SUMS`. The comparison is case-insensitive.

## Windows 11

The x86-64 NSIS installer is per-user and requires an already installed, supported Microsoft Edge WebView2 runtime. It does not download a runtime silently.

1. Verify the installer checksum.
2. Open the NSIS `.exe`.
3. Confirm that Windows identifies an unrecognized or unknown publisher. If Microsoft Defender SmartScreen blocks the reviewed file, choose **More info**, verify the QueryNot filename again, and then choose **Run anyway**.
4. Complete the current-user installation and launch QueryNot.
5. If the WebView2 runtime is absent, cancel, install a supported runtime through Microsoft's documented administrator-approved process, and repeat. Do not weaken SmartScreen or system security policy globally.

Uninstall QueryNot from **Settings > Apps** when it is no longer needed.

Windows 10, macOS, AppImage, and Debian packages are not distributed or supported in `0.1.0`. WSL2/Linux package builds in the repository are engineering outputs only.

## What to record

The release bundle retains the exact Windows patch, architecture, WebView2 runtime, artifact filename, byte count, SHA-256 digest, and automated inspection result. Native warning, installation, interaction, and uninstall observations are post-release owner validation under [ADR 0010](../architecture/0010-windows-first-release-validation-boundary.md) and must remain labelled unperformed until the owner records them.
