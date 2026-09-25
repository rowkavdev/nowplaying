# Quick start

Use a Windows PC and a running Plex, Jellyfin, Navidrome or Emby server. This guide uses the rolling development build, which is still being tested.

## 1. Download and check the development build

1. Open the [rolling dev release](https://github.com/rowkavdev/nowplaying/releases/tag/dev) and download `nowplaying-dev-windows-x64-setup.exe` and `SHA256SUMS`.
2. In PowerShell, in your Downloads folder, run:

   ```powershell
   Get-FileHash .\nowplaying-dev-windows-x64-setup.exe -Algorithm SHA256
   ```

   Success looks like: the long hash matches the line for the same file name in `SHA256SUMS`. If it doesn't match, delete the file and download again.
3. Run the installer. It is not code-signed, so Windows may show a SmartScreen warning. Only continue after you have checked the download and trust the release source.

## 2. Set up nowplaying

The first time nowplaying starts with no saved settings, it opens WebUI Settings in your web browser. There is no console window and nothing to type in a terminal.

1. **Connect your media server.** Choose a discovered server or enter its address, then follow the sign-in guide for [Plex](Connect-Plex), [Jellyfin](Connect-Jellyfin), [Navidrome](Connect-Navidrome) or [Emby](Connect-Emby). The server appears in Settings after sign-in; add or remove servers there later. **Spotify and hosted card** sign-ins are optional and available on this same first-run page and in Settings later. [Spotify](Connect-Spotify) does not appear in Discord. The [YouTube extension](Connect-YouTube) is another optional source.

2. **Turn on Discord.** Keep the Discord desktop app open, enable Discord in Settings after connecting your server, and use the card preview to check how it looks.
3. Once a server is connected, the app starts. Your settings are saved on your PC. Sign-ins live in Windows Credential Manager, not in the settings file.

## 3. Check it's working

- The nowplaying icon sits in the system tray near the clock.
- Open `http://127.0.0.1:47832/healthz` in a browser. It answers `ok`, which checks the process, not the server connection.
- Play something on your media server. Open `http://127.0.0.1:47832/card.svg` to check the local card. If Discord is on, check your profile status in the desktop app.
- Stop playback. The status follows the idle behaviour you picked in Settings.

Something off? Go to [Troubleshooting](Troubleshooting) and find the symptom you see.

## Next steps

- [Add a README card](Add-a-README-card) to show the same thing on your GitHub profile
- [Privacy and safe configuration](Privacy-and-safe-configuration) to hide titles, artwork or progress
- [Updates and release channels](Updates-and-release-channels) to decide between stable and development builds
