# nowplaying

[![CI](https://github.com/rowkavdev/nowplaying/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/rowkavdev/nowplaying/actions/workflows/ci.yml)
[![Dev build](https://github.com/rowkavdev/nowplaying/actions/workflows/beta.yml/badge.svg?branch=main)](https://github.com/rowkavdev/nowplaying/releases/tag/dev)
[![Latest release](https://img.shields.io/github/v/release/rowkavdev/nowplaying?label=release)](https://github.com/rowkavdev/nowplaying/releases/latest)
[![Last commit](https://img.shields.io/github/last-commit/rowkavdev/nowplaying)](https://github.com/rowkavdev/nowplaying/commits/main)
[![Coverage](https://codecov.io/gh/rowkavdev/nowplaying/graph/badge.svg?branch=main)](https://app.codecov.io/gh/rowkavdev/nowplaying)
[![Downloads](https://img.shields.io/github/downloads/rowkavdev/nowplaying/total)](https://github.com/rowkavdev/nowplaying/releases)
[![License](https://img.shields.io/github/license/rowkavdev/nowplaying)](LICENSE)

Live README cards and Discord Rich Presence for Plex, Jellyfin, Navidrome and Emby.

> Private beta. Provider polling, privacy controls, self-contained artwork cards, Discord Rich Presence, hosted HTTP runtime, aggregate analytics, auto-updates and protected releases are implemented.

## What it is

`nowplaying` reads active sessions from a self-hosted media server, normalizes them into one provider-neutral model, then feeds:

- an SVG card for GitHub READMEs;
- local Discord Rich Presence.

| Provider | Session polling | Notes |
| --- | --- | --- |
| Plex | Yes | `/status/sessions`; DRPP-derived logic with attribution |
| Jellyfin | Yes | `/Sessions` with playback-tick conversion |
| Navidrome | Yes | Subsonic `getNowPlaying` |
| Emby | Yes | `/Sessions` with playback-tick conversion |

## Current status

- Provider-neutral presence and privacy model
- Four provider adapters
- Accessible, XML-safe SVG renderer with self-contained sanitized artwork
- Deep shared and output-specific settings with deuteranopia-safe themes
- Discord formatting, buttons, timestamps, IPC lifecycle and throttling
- Hosted `/card.svg`, health checks, ETags, last-good fallback and graceful shutdown
- Private aggregate analytics with opt-in anonymous Discord counts
- Private-release auto-updater with SHA-256 verification and atomic rollback
- Protected tag-driven packaged releases
- Node 22/24 tests, coverage, build smoke tests and artifacts

## Requirements

- Node.js 22 or newer
- A media-server URL reachable from the process
- A least-privilege provider token or API key

Never expose media-server credentials in README URLs, browser code, logs or public configuration. The hosted endpoint keeps them server-side.

## Development

```sh
git clone https://github.com/rowkav09/nowplaying.git
cd nowplaying
npm ci
npm test
npm run build
```

The Sharp runtime decodes, bounds and re-encodes artwork without source metadata. The build emits a smoke-tested `dist/` artifact.

## Library usage

```js
import { createJellyfinProvider, renderCard } from "nowplaying";

const provider = createJellyfinProvider({
  baseUrl: process.env.JELLYFIN_URL,
  apiKey: process.env.JELLYFIN_API_KEY,
});

const presence = await provider.getPresence({ username: "rowan" });
const svg = renderCard(presence);
```

Equivalent factories exist for Plex, Navidrome and Emby.

| Provider | Required values | Authentication |
| --- | --- | --- |
| Plex | `baseUrl`, `token` | `X-Plex-Token` |
| Jellyfin | `baseUrl`, `apiKey` | `X-Emby-Token` |
| Navidrome | `baseUrl`, `username`, `token`, `salt` | Subsonic token auth |
| Emby | `baseUrl`, `apiKey` | `X-Emby-Token` |

Provider factories accept `fetchImpl` for deterministic tests and custom networking.

## Outputs and customization

The shared presentation layer is separate from provider polling. Shipped controls cover templates, labels, field visibility, privacy, artwork, progress, timestamps, idle behavior, themes, custom colors, Discord assets, buttons and update intervals. See [Customization](docs/customization.md).

Operational references:

- [Hosted card deployment](docs/hosted-card.md)
- [Updates](docs/updates.md)
- [Aggregate analytics](docs/analytics.md)

## Commands

| Command | Purpose |
| --- | --- |
| `npm run check` | Parse-check source, providers and tests |
| `npm test` | Run the Node test suite |
| `npm run test:coverage` | Run tests with Node coverage |
| `npm run build` | Produce the build artifact and sample SVG |

CI validates Node 22 and 24, coverage, build output and artifacts. Changes land through small PRs.

## Security and privacy

Now-playing data can reveal titles, users, artwork and server activity. Treat it as personal data.

- Keep credentials in environment variables or a secret store.
- Use read-only API access where available.
- Never place tokens in card URLs.
- Keep analytics aggregate-only; Discord analytics is off by default.
- Rotate any token exposed in logs, screenshots, commits or issues.

Report security problems privately rather than opening a public issue.

## Verifying downloads

Every Windows download comes with a `SHA256SUMS` file. Check that the hash of the file you downloaded matches its line:

```powershell
Get-FileHash .\nowplaying-dev-windows-x64-setup.exe -Algorithm SHA256
```

Once the repository is public, builds also get GitHub build provenance, a signed record of which workflow and commit produced each file. Check it with the [GitHub CLI](https://cli.github.com/):

```sh
gh attestation verify nowplaying-dev-windows-x64-setup.exe --repo rowkav09/nowplaying
```

The builds are not code-signed yet, so Windows may still show a SmartScreen warning.

## Project structure

```text
src/presence.js          normalized playback model
src/provider.js          provider adapter contract
src/providers/           Plex, Jellyfin, Navidrome and Emby
src/card.js              SVG renderer
src/http-*.js            hosted endpoint and Node adapter
src/discord*.js          Discord formatting, lifecycle and IPC
src/update-*.js          update discovery, verification and install
src/analytics*.js        aggregate analytics
src/index.js             public exports
test/                    unit, contract, integration and E2E tests
scripts/build.js         reproducible smoke build
```

## License and attribution

Licensed under the GNU Affero General Public License v3.

The Plex adapter adapts session-polling logic from `phin05/discord-rich-presence-plex`, also AGPL-3.0. The derived file retains the pinned source URL, copyright and license notice. See [NOTICE](NOTICE).
