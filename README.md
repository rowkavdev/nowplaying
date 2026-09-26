# nowplaying

[![CI](https://github.com/rowkavdev/nowplaying/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/rowkavdev/nowplaying/actions/workflows/ci.yml)
[![Dev build](https://github.com/rowkavdev/nowplaying/actions/workflows/beta.yml/badge.svg?branch=main)](https://github.com/rowkavdev/nowplaying/releases/tag/dev)
[![Coverage](https://codecov.io/gh/rowkavdev/nowplaying/graph/badge.svg?branch=main)](https://app.codecov.io/gh/rowkavdev/nowplaying)
[![License](https://img.shields.io/github/license/rowkavdev/nowplaying)](LICENSE)

Show what you are playing from Plex, Jellyfin, Navidrome or Emby in a GitHub README card and Discord Rich Presence. Spotify and a paired YouTube browser extension can feed the card; Spotify does not feed Discord.

> **Development build:** The Windows app is in testing. The moving [`dev` prerelease](https://github.com/rowkavdev/nowplaying/releases/tag/dev) may change or break; verify it on your machine before depending on it. Downloads are not code-signed.

## Get started on Windows

1. Download the installer or portable ZIP and `SHA256SUMS` from the [`dev` release](https://github.com/rowkavdev/nowplaying/releases/tag/dev). Compare the downloaded file's hash with its entry in `SHA256SUMS`:

   ```powershell
   Get-FileHash .\nowplaying-dev-windows-x64-setup.exe -Algorithm SHA256
   ```

2. Run the installer, or extract the ZIP and run `nowplaying.exe` without separating it from the other extracted files. On first launch, WebUI Settings opens in your browser instead of a native setup wizard. Connect a discovered media server, or enter its address. You can add more than one server.
3. Turn on Discord in Settings if you want Rich Presence. Keep the Discord desktop app open. Play something and check the app's local status page (`http://127.0.0.1:47832/`). The local card is at [`/card.svg`](http://127.0.0.1:47832/card.svg); [`/healthz`](http://127.0.0.1:47832/healthz) checks only whether the app responds.
4. To put a card in a README, enable the hosted card in Settings and copy the generated Markdown snippet. You can optionally sign in with GitHub to use one card across your PCs. Your media server does not need a public port.

Start with the [step-by-step guide](docs/wiki/Quick-Start.md) if you need provider sign-in instructions. [Plex](docs/wiki/Connect-Plex.md) · [Jellyfin](docs/wiki/Connect-Jellyfin.md) · [Navidrome](docs/wiki/Connect-Navidrome.md) · [Emby](docs/wiki/Connect-Emby.md) · [Spotify](docs/wiki/Connect-Spotify.md) · [YouTube extension](docs/wiki/Connect-YouTube.md).

## What runs where

| Output | Where it runs | What to know |
| --- | --- | --- |
| Local card | On your PC at `127.0.0.1:47832/card.svg` | Shows the selected playback state without hosting anything. |
| Hosted README card | On the hosted service, from updates pushed by your PC | Public card URL. Enable it in Settings; the service cannot connect to your media server. |
| Discord Rich Presence | Between the Windows app and the Discord desktop app | Does not use the hosted card service. Spotify does not appear here. |

The hosted card is opt-in. It receives the fields you have allowed for the card, not your media-server credentials or artwork. It keeps the latest state rather than a listening history; an update expires after ten minutes. See [what leaves your PC](docs/hosted-upload.md) and [privacy settings](docs/wiki/Privacy-and-safe-configuration.md) before making a card public.

## Settings and problems

Use the tray icon to open Settings, change privacy and card appearance, or manage servers there. Settings, connection state and logs are served locally on `127.0.0.1` by default. See [customization](docs/customization.md) for supported controls and [troubleshooting](docs/wiki/Troubleshooting.md) for connection, card and Discord problems. GitHub caches README images, so compare a stale README card with the card URL opened directly.

## Develop

Node.js 22 or newer is required to build from source:

```sh
git clone https://github.com/rowkavdev/nowplaying.git
cd nowplaying
npm ci
npm test
npm run build
```

The package exports `createJellyfinProvider`, the other provider adapters and `renderCard` from `src/index.js`. See [provider options](docs/providers.md), [card examples](docs/card-examples.md), [architecture](docs/architecture.md) and [contributing](CONTRIBUTING.md). Running the polling app on macOS or Linux is not supported yet.

## License

AGPL-3.0. The Plex adapter adapts session-polling logic from `phin05/discord-rich-presence-plex`; see [NOTICE](NOTICE) for attribution.
