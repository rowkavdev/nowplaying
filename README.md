# nowplaying

Live README cards and Discord Rich Presence for Plex, Jellyfin, Navidrome and Emby.

> Private early build. The provider core and first SVG renderer work; the hosted endpoint, Discord output and production deployment flow are still being built.

## What it is

`nowplaying` reads the active session from your self-hosted media server, normalizes it into one provider-neutral model, then sends it to portable outputs. The same core is designed to feed:

- an SVG card that can be embedded in a GitHub README
- Discord Rich Presence

Supported providers:

| Provider | Session polling | Notes |
| --- | --- | --- |
| Plex | Yes | Polls `/status/sessions`; polling logic is adapted from DRPP with attribution |
| Jellyfin | Yes | Polls `/Sessions` and converts playback ticks |
| Navidrome | Yes | Uses the supported Subsonic `getNowPlaying` API |
| Emby | Yes | Polls `/Sessions` and converts playback ticks |

## Current status

- [x] Provider-neutral presence model
- [x] Plex, Jellyfin, Navidrome and Emby adapters
- [x] Accessible, XML-safe SVG renderer
- [x] Node 22/24 tests, coverage and build artifacts in CI
- [ ] Deep output settings and themes
- [ ] Privacy controls
- [ ] Hosted README-card endpoint
- [ ] Discord Rich Presence publisher
- [ ] Versioned releases and packaged builds

Follow the work in [Issues](https://github.com/rowkav09/nowplaying/issues).

## Requirements

- Node.js 22 or newer
- A media-server base URL reachable from the process running `nowplaying`
- A provider token or API key with the least access needed to read sessions

Do not expose media-server tokens in README URLs, browser code, logs or public configuration. The hosted endpoint will use server-side secrets.

## Install for development

```bash
git clone https://github.com/rowkav09/nowplaying.git
cd nowplaying
npm install
npm test
npm run build
```

No runtime packages are required yet. The build writes a smoke-test artifact to `dist/`.

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

Equivalent factories are exported for Plex, Navidrome and Emby.

## Provider credentials

| Provider | Required values | Authentication |
| --- | --- | --- |
| Plex | `baseUrl`, `token` | `X-Plex-Token` header |
| Jellyfin | `baseUrl`, `apiKey` | `X-Emby-Token` header |
| Navidrome | `baseUrl`, `username`, `token`, `salt` | Subsonic token authentication |
| Emby | `baseUrl`, `apiKey` | `X-Emby-Token` header |

Provider constructors accept an optional `fetchImpl`, which keeps tests deterministic and allows custom networking without changing provider logic.

## Outputs and customization

The first card renderer supports playing, paused and idle states, bounded widths, progress, safe XML escaping and accessible `<title>`/`<desc>` text. Its default dark palette uses a blue accent chosen to remain distinct for deuteranopia.

The settings layer is being designed as shared presentation configuration rather than provider-specific flags. Planned controls include:

- title, detail and state formats
- per-field visibility
- artwork source and fallback behavior
- progress and timestamp behavior
- idle/recently-played behavior
- privacy redaction
- named card themes and custom colors
- Discord activity text, buttons, assets and timestamps

See [customization issue #25](https://github.com/rowkav09/nowplaying/issues/25).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run check` | Parse-check source, providers and tests |
| `npm test` | Run the Node test suite |
| `npm run test:coverage` | Run tests with Node's coverage report |
| `npm run build` | Produce a smoke-tested build artifact and sample SVG |

CI runs validation on Node 22 and 24, coverage, a build smoke test and artifact upload. Pull requests stay small and focused.

## Security and privacy

Now-playing data can reveal titles, users, artwork and server activity. Treat it as personal data.

- Keep credentials in environment variables or a secret store.
- Use a read-only API token where the server supports one.
- Do not put tokens in card URLs.
- Put self-hosted deployments behind access controls until the public endpoint and privacy modes are ready.
- Rotate a token if it appears in logs, screenshots, commits or issue text.

Please report security problems privately rather than opening a public issue. A dedicated security policy is planned in the docs pass.

## Project structure

```text
src/presence.js          normalized playback model
src/provider.js          provider adapter contract
src/providers/           Plex, Jellyfin, Navidrome, Emby
src/card.js              SVG renderer
src/index.js             public module exports
test/                    contract and provider tests
scripts/build.js         reproducible smoke build
```

## License and attribution

Licensed under the [GNU Affero General Public License v3](LICENSE).

The Plex adapter adapts session-polling logic from [phin05/discord-rich-presence-plex](https://github.com/phin05/discord-rich-presence-plex), also licensed under AGPL-3.0. The derived file retains the pinned source URL, copyright and license notice. See [NOTICE](NOTICE).
