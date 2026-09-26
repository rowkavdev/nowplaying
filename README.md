# nowplaying

[![CI](https://github.com/rowkavdev/nowplaying/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/rowkavdev/nowplaying/actions/workflows/ci.yml)
[![Windows dev build](https://github.com/rowkavdev/nowplaying/actions/workflows/beta.yml/badge.svg?branch=main)](https://github.com/rowkavdev/nowplaying/releases/tag/dev)
[![Coverage](https://codecov.io/gh/rowkavdev/nowplaying/graph/badge.svg?branch=main)](https://app.codecov.io/gh/rowkavdev/nowplaying)
[![License: AGPL-3.0](https://img.shields.io/github/license/rowkavdev/nowplaying)](LICENSE)

Your media server knows what you are playing. nowplaying turns that into a card for your GitHub README and a status in Discord, without exposing your server to the internet. It runs on your Windows PC and reads playback from Plex, Jellyfin, Emby or Navidrome. Spotify and a paired YouTube extension can also feed the card.

| Music | Film | TV |
| :---: | :---: | :---: |
| ![Example card showing Holocene by Bon Iver](docs/assets/cards/music-playing.svg) | ![Example card showing Spirited Away](docs/assets/cards/movie-playing.svg) | ![Example card showing Lost, S04E05](docs/assets/cards/episode-playing.svg) |

*Example cards, not live playback. [More states and styles](docs/card-examples.md).*

> **Windows development build:** The [`dev` prerelease](https://github.com/rowkavdev/nowplaying/releases/tag/dev) is a moving test build, not an accepted stable release. It can break. Downloads are not code-signed; verify the checksum before running one. macOS and Linux desktop apps are not supported yet.

## Get it running

1. Download `nowplaying-dev-windows-x64-setup.exe` and `SHA256SUMS` from the [dev release](https://github.com/rowkavdev/nowplaying/releases/tag/dev). The [portable ZIP](docs/wiki/Install-on-Windows.md#portable-zip) is an alternative. In PowerShell, compare the installer hash with its line in `SHA256SUMS`:

   ```powershell
   Get-FileHash .\nowplaying-dev-windows-x64-setup.exe -Algorithm SHA256
   ```

2. Install it for your Windows user. On first launch, **Settings opens in your browser**. Find a media server or enter its address, then sign in. A full subnet scan only runs when you enter that subnet yourself. You can connect more than one server.
3. Play something. Open the tray icon's status page, or visit [`http://127.0.0.1:47832/card.svg`](http://127.0.0.1:47832/card.svg) on that PC. The page at [`/healthz`](http://127.0.0.1:47832/healthz) says only that the configured app is responding, not that your server is connected.
4. If you want a public README card, turn on **Hosted card** in Settings and copy its Markdown snippet. If you want Discord Rich Presence, turn it on separately in **Settings > Discord** and keep the Discord desktop app open.

Provider sign-in: [Plex](docs/wiki/Connect-Plex.md) · [Jellyfin](docs/wiki/Connect-Jellyfin.md) · [Emby](docs/wiki/Connect-Emby.md) · [Navidrome](docs/wiki/Connect-Navidrome.md). For the full installation path, see [Quick start](docs/wiki/Quick-Start.md) and the [dev-build test checklist](docs/testing-dev-build.md).

## Choose where it shows up

| Output | Source | How it works |
| --- | --- | --- |
| **Local card** | Media servers, Spotify, paired YouTube extension | An SVG on your PC. Choose a theme, width and visible fields in Settings. |
| **Hosted README card** | The same card state | Opt-in. Your PC pushes filtered playback fields to the card service; it never calls your media server. Copy the public link from Settings. Optional GitHub sign-in joins up to 10 PCs under one card. |
| **Discord Rich Presence** | Media servers and paired YouTube extension | Opt-in. Your PC talks directly to the Discord desktop app. Music, films and episodes get fitting statuses. **Spotify never goes to Discord.** |

[Connect Spotify](docs/wiki/Connect-Spotify.md) with your own Spotify app Client ID, or [pair the YouTube extension](docs/wiki/Connect-YouTube.md). Spotify music and podcasts can appear on the card; the YouTube extension is loaded manually and skips Shorts and ads. These are optional, not needed for a media-server card.

## Privacy is set on your PC

- **Hosted cards are off until you turn them on.** The public service receives the card's filtered state, not your server address, username, password, token, artwork or listening history. Its latest update expires after ten minutes. [See exactly what leaves your PC](docs/hosted-upload.md).
- **Sign-ins stay in Windows Credential Manager.** `%LOCALAPPDATA%\nowplaying\config.json` holds settings and server addresses, not passwords or tokens. Don't post that file without checking it.
- **Settings > Privacy** can hide titles, artwork, progress or whole media types before they reach the card or Discord. A hidden type looks like nothing playing. [Privacy guide](docs/wiki/Privacy-and-safe-configuration.md).
- **Local Settings binds to `127.0.0.1`.** The hosted card doesn't require a public port or inbound access to your PC. A public README card is visible to anyone who opens it; [GitHub may cache its image](docs/wiki/Add-a-README-card.md#if-the-readme-looks-stale).

## Settings, updates and problems

Open **Settings** from the tray icon to manage servers, Discord, hosted cards, privacy and the card's appearance. The local status page shows connections and logs. [Customization](docs/customization.md) · [Updates and release channels](docs/wiki/Updates-and-release-channels.md) · [Troubleshooting](docs/wiki/Troubleshooting.md).

If something fails on a dev build, [open an issue](https://github.com/rowkavdev/nowplaying/issues/new) with the build number, Windows version, what you tried and what happened. Leave out server addresses and tokens.

## Develop

Node.js 22 or newer is required to work from source:

```sh
git clone https://github.com/rowkavdev/nowplaying.git
cd nowplaying
npm ci
npm test
npm run build
```

The source exports provider adapters and the card renderer for other deployments. [Provider API](docs/providers.md) · [Architecture](docs/architecture.md) · [Contributing](CONTRIBUTING.md). The Windows app is the supported desktop path; running the polling app on macOS or Linux is not supported yet.

## License

AGPL-3.0. The Plex adapter adapts session-polling logic from `phin05/discord-rich-presence-plex`; see [NOTICE](NOTICE).
