# Quick start

Goal: see what's playing on one media server in Discord, in about ten minutes. You need a Windows PC and one of Plex, Jellyfin, Navidrome or Emby already running.

## 1. Download and check the installer

1. Open the [latest release](https://github.com/rowkavdev/nowplaying/releases/latest) and download `nowplaying-...-setup.exe` and the `SHA256SUMS` file.
2. In PowerShell, in your Downloads folder, run:

   ```powershell
   Get-FileHash .\nowplaying-0.1.0-windows-x64-setup.exe -Algorithm SHA256
   ```

   Success looks like: the long hash matches the line for the same file name in `SHA256SUMS`. If it doesn't match, delete the file and download again.
3. Run the installer. Windows may show a SmartScreen warning because the app isn't code-signed yet. Choose **More info**, then **Run anyway**.

## 2. Set up nowplaying

The first time nowplaying starts with no saved settings, it opens a setup page in your web browser. There is no console window and nothing to type in a terminal.

1. **Connect your media server.** Paste your server's address and sign in. The provider pages show exactly where to find each sign-in: [Plex](Connect-Plex) · [Jellyfin](Connect-Jellyfin) · [Navidrome](Connect-Navidrome) · [Emby](Connect-Emby) · [Spotify](Connect-Spotify). Use the connection test on the page; success means nowplaying can see your sessions. Running more than one server? Use **Add another server** to sign in to each of them (up to eight). If several are playing at once, the one that started or changed most recently shows; playing beats paused.
2. **Turn on Discord.** Keep the Discord desktop app open, enable Discord in setup, and use the preview to check how your status will look.
3. Finish setup. Your settings are saved on your PC and hold no password or token; sign-ins live in Windows Credential Manager.

## 3. Check it's working

- The nowplaying icon sits in the system tray near the clock.
- Open `http://127.0.0.1:47832/healthz` in a browser. It answers `ok`.
- Play something on your media server. Within a few seconds your Discord status shows it.
- Stop playback. The status follows the idle behaviour you picked in setup.

Something off? Go to [Troubleshooting](Troubleshooting) and find the symptom you see.

## Next steps

- [Add a README card](Add-a-README-card) to show the same thing on your GitHub profile
- [Privacy and safe configuration](Privacy-and-safe-configuration) to hide titles, artwork or progress
- [Updates and release channels](Updates-and-release-channels) to decide between stable and development builds
