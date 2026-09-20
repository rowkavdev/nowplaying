# Provider configuration

Each adapter returns the same normalized presence shape. Provider details stay at the edge so cards and Discord output do not need server-specific branches.

## Common behavior

- Constructors validate required options and remove trailing slashes from `baseUrl`.
- Every provider accepts an optional `fetchImpl` for tests, proxies or custom networking.
- `getPresence(query)` returns a normalized presence or throws a provider error.
- `query.username` or `query.userId` narrows the selected session where the provider exposes that identity.
- Transport and authentication failures are surfaced. They are not silently converted to idle state.

Use HTTPS between the process and media server where possible. Never expose provider credentials to browser code or put them in an SVG URL.

## Plex

```js
import { createPlexProvider } from "nowplaying/providers/plex";

const plex = createPlexProvider({
  baseUrl: process.env.PLEX_URL,
  token: process.env.PLEX_TOKEN,
});

const presence = await plex.getPresence({ username: "rowan" });
```

### Options

| Option | Required | Meaning |
| --- | --- | --- |
| `baseUrl` | Yes | Plex server origin, for example `https://plex.example.com` |
| `token` | Yes | Plex authentication token |
| `fetchImpl` | No | Fetch-compatible function; defaults to global `fetch` |

The adapter requests `/status/sessions` with `X-Plex-Token`. It supports movie, episode and track sessions. Paused sessions remain visible with state `paused`.

The session-polling logic is adapted from DRPP. See [NOTICE](../NOTICE) for the pinned upstream source and licensing.

## Jellyfin

```js
import { createJellyfinProvider } from "nowplaying/providers/jellyfin";

const jellyfin = createJellyfinProvider({
  baseUrl: process.env.JELLYFIN_URL,
  apiKey: process.env.JELLYFIN_API_KEY,
});

const presence = await jellyfin.getPresence({ username: "rowan" });
```

### Options

| Option | Required | Meaning |
| --- | --- | --- |
| `baseUrl` | Yes | Jellyfin server origin |
| `apiKey` | Yes | Jellyfin API key |
| `fetchImpl` | No | Fetch-compatible function |

The adapter requests `/Sessions` with `X-Emby-Token`. Jellyfin reports position and duration in 10,000,000 ticks per second; the adapter converts both to milliseconds. Sessions without `NowPlayingItem` are ignored.

## Navidrome

```js
import { createNavidromeProvider } from "nowplaying/providers/navidrome";

const navidrome = createNavidromeProvider({
  baseUrl: process.env.NAVIDROME_URL,
  username: process.env.NAVIDROME_USERNAME,
  token: process.env.NAVIDROME_TOKEN,
  salt: process.env.NAVIDROME_SALT,
});

const presence = await navidrome.getPresence();
```

### Options

| Option | Required | Meaning |
| --- | --- | --- |
| `baseUrl` | Yes | Navidrome server origin |
| `username` | Yes | Subsonic API username |
| `token` | Yes | MD5 token derived from password and salt |
| `salt` | Yes | Salt paired with the token |
| `client` | No | Subsonic client name; defaults to `nowplaying` |
| `apiVersion` | No | Subsonic API version; defaults to `1.16.1` |
| `fetchImpl` | No | Fetch-compatible function |

The adapter calls `/rest/getNowPlaying.view` with `f=json`. Navidrome exposes elapsed seconds but no paused flag in this response, so returned entries are treated as playing. A username query is matched case-insensitively.

Create the Subsonic token as `md5(password + salt)`. Store the password only long enough to derive the token; do not add either value to source control.

## Emby

```js
import { createEmbyProvider } from "nowplaying/providers/emby";

const emby = createEmbyProvider({
  baseUrl: process.env.EMBY_URL,
  apiKey: process.env.EMBY_API_KEY,
});

const presence = await emby.getPresence({ userId: process.env.EMBY_USER_ID });
```

### Options

| Option | Required | Meaning |
| --- | --- | --- |
| `baseUrl` | Yes | Emby server origin |
| `apiKey` | Yes | Emby API key |
| `fetchImpl` | No | Fetch-compatible function |

The adapter requests `/Sessions` with `X-Emby-Token`, ignores sessions without a current item and converts ticks to milliseconds. It supports movie, episode and audio item types.

## Normalized result

All adapters return an immutable presence object with these output-facing fields:

| Field | Meaning |
| --- | --- |
| `state` | `playing`, `paused` or `idle` |
| `mediaType` | `movie`, `episode`, `track` or `unknown` |
| `title` | Primary title |
| `subtitle` | Show, artist or other secondary context |
| `album` | Album name when available |
| `year` | Release year when available |
| `positionMs` | Current playback position |
| `durationMs` | Media duration |
| `artworkUrl` | Provider artwork reference when available |
| `provider` | Provider name |
| `updatedAt` | Observation timestamp |

Provider payloads are not passed through. This boundary keeps credentials, server-only fields and incompatible provider shapes away from renderers.
