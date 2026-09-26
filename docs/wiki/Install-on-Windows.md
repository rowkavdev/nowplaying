# Install on Windows

Two ways to run nowplaying on Windows. The installer is the easy path; the portable ZIP is for running it without installing.

## Installer (recommended)

1. For the current development build, open the [rolling dev release](https://github.com/rowkavdev/nowplaying/releases/tag/dev) and download `nowplaying-dev-windows-x64-setup.exe` and `SHA256SUMS`. This prerelease is still being tested.
2. Check the download in PowerShell:

   ```powershell
   Get-FileHash .\nowplaying-dev-windows-x64-setup.exe -Algorithm SHA256
   ```

   The hash must match the file's line in `SHA256SUMS`.
3. Run the installer. It is not code-signed, so Windows may show a SmartScreen warning. Only continue after checking the hash and trusting the release source.
4. On the Startup step, tick **Start nowplaying when I sign in** if you want it always on.
5. It installs for your user only, no admin prompt, usually to `%LOCALAPPDATA%\Programs\nowplaying`.

## Portable ZIP

1. Download the portable ZIP and `SHA256SUMS`, and check the hash the same way.
2. Extract it and **keep the files together** - the artwork libraries sit beside `nowplaying.exe` and it won't work without them.
3. Run `nowplaying.exe`.

## After install

The first launch with no saved settings opens WebUI Settings in your browser, not a native setup wizard. Continue with the [Quick start](Quick-Start) from step 2.

## Uninstall

Uninstall from **Settings > Apps**. The sign-in startup shortcut is removed too, so nowplaying won't start at the next sign-in.
