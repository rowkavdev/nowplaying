# Updates and release channels

## Stable versus development builds

- **Stable releases** (marked *Latest* on the releases page) are the tested line. Pick these if you want fewer surprises.
- **Development builds** are a rolling pre-release named `dev build #N`, rebuilt on every change. They have the newest fixes and the newest bugs. Pick these if you want to help test.

The [dev-build checklist](https://github.com/rowkavdev/nowplaying/blob/main/docs/testing-dev-build.md) walks through testing a development build on a clean machine.

## How updates behave

- By default nowplaying **notifies** you when an update is available and changes nothing on its own.
- You can turn updates off, or let them install automatically.
- Every download is checked against its SHA-256 hash before installing. The install swaps in atomically and keeps the previous version for rollback.
- nowplaying never downgrades itself and never crosses between stable and development channels.

## Checking a download yourself

Every Windows download ships with a `SHA256SUMS` file:

```powershell
Get-FileHash .\nowplaying-0.1.0-windows-x64-setup.exe -Algorithm SHA256
```

Builds also carry GitHub build provenance, a signed record of which workflow and commit produced each file:

```sh
gh attestation verify nowplaying-0.1.0-windows-x64-setup.exe --repo rowkavdev/nowplaying
```

## Upgrading

- With the default **notify** policy, nowplaying tells you an update is ready; apply it from the prompt.
- With **install**, updates verify their SHA-256 hash and swap in atomically. The previous version is kept alongside as a backup during the swap.
- To move between stable and development builds, download the one you want from [releases](https://github.com/rowkavdev/nowplaying/releases) and install over the top. Check the hash the same way as a first install.

## Rolling back

If a build misbehaves:

1. Quit nowplaying from the tray.
2. Download the previous version's installer or ZIP from [releases](https://github.com/rowkavdev/nowplaying/releases) and install it over the top. Your settings and sign-ins are kept.
3. Report what broke in an [issue](https://github.com/rowkavdev/nowplaying/issues) with the build number that failed and the one you went back to.

Settings migrate forward automatically, and the file is backed up before any format change, so going back a version is safe.
