# Updates and release channels

## Stable versus development builds

- **Stable releases** (marked *Latest* on the releases page) are the tested line. Pick these if you want fewer surprises.
- **Development builds** are a rolling pre-release named `dev build #N`, rebuilt on every change. They have the newest fixes and the newest bugs. Pick these if you want to help test.

The [dev-build checklist](https://github.com/rowkavdev/nowplaying/blob/main/docs/testing-dev-build.md) walks through testing a development build on a clean machine.

## How updates behave

The desktop app does not run the automatic updater yet. Quit it, download the newer installer or portable ZIP, verify its checksum and install it as described below.

Source deployments can integrate the updater library with explicit `off`, `notify` or `install` policies. That library verifies downloads, keeps a backup during replacement and stays within its configured release channel. See the [updater API and policies](https://github.com/rowkavdev/nowplaying/blob/main/docs/updates.md).

## Checking a download yourself

Every Windows download ships with a `SHA256SUMS` file:

```powershell
Get-FileHash .\nowplaying-v0.2.1-windows-x64-setup.exe -Algorithm SHA256
```

Builds also carry GitHub build provenance, a signed record of which workflow and commit produced each file:

```sh
gh attestation verify nowplaying-v0.2.1-windows-x64-setup.exe --repo rowkavdev/nowplaying
```

## Upgrading

- Quit nowplaying from the tray, download the newer installer or portable ZIP from [releases](https://github.com/rowkavdev/nowplaying/releases), and verify its checksum.
- Run the installer over the existing installation. Portable users should replace the application files together and keep their existing settings directory.
- To move between stable and development builds, download the one you want from [releases](https://github.com/rowkavdev/nowplaying/releases) and install over the top. Check the hash the same way as a first install.

## Rolling back

If a build misbehaves:

1. Quit nowplaying from the tray.
2. Download the previous version's installer or ZIP from [releases](https://github.com/rowkavdev/nowplaying/releases) and install it over the top. Your settings and sign-ins are kept.
3. Report what broke in an [issue](https://github.com/rowkavdev/nowplaying/issues) with the build number that failed and the one you went back to.

Settings migrate forward automatically, with a backup before a format change. An older version may need that earlier configuration backup; check its compatibility notes before rolling back.
