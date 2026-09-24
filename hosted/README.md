# Hosted card service

The public card endpoint for people who can't expose their own server. The desktop app pushes privacy-filtered playback state here; this service renders it as an SVG for a GitHub README. See #140 for the design, and [what leaves your PC](../docs/hosted-upload.md) for the plain-language version.

What it never does:

- connect to anyone's Plex, Jellyfin, Navidrome, Emby, browser or Discord
- store provider credentials, raw provider responses or listening history
- log titles, artists, usernames or tokens

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/register` | Create an opaque card ID, device ID and device token. Rate limited per client. |
| `POST` | `/api/auth/github` | Body `{ githubToken, deviceName?, legacyToken? }`. Signs this PC in to the GitHub user's card. The GitHub token is checked once with `api.github.com/user` and never stored. Returns `{ login, deviceId, token, cardPath }`. Passing an old per-PC `legacyToken` makes that old card link show the user's card. Rate limited per client. |
| `GET` / `POST` | `/api/devices` | `Authorization: Bearer <device token>` of a signed-in PC. `GET` lists the user's PCs; `POST { action: "rename", deviceId?, name }`, `{ action: "remove", deviceId }` or `{ action: "remove-all" }`. |
| `POST` | `/api/ingest` | `Authorization: Bearer <device token>`. Push one state update (schema below). |
| `POST` / `DELETE` | `/api/revoke` | Delete the device token and any stored state. |
| `GET` / `HEAD` | `/card/<cardId>.svg` | Public SVG. Options: `theme`, `width`, `show` (same as the local card). |
| | | Layout options, all optional: `padding` (12-48), `radius` (0-24), `titleSize` (14-30), `subtitleSize` (10-20), `progressHeight` (2-12), `textAlign` (`start`/`middle`/`end`), `fieldOrder` (`state`, `title`, `subtitle` once each, comma-separated), `progressPosition` (`bottom`/`text`), `progressWidth` (`content`/`full`), `direction` (`ltr`/`rtl`/`auto`). Out-of-range or repeated values return 400 `invalid_layout`. Set only in the URL, never sent by the app. |
| `GET` / `HEAD` | `/u/<github-login>.svg` | The signed-in user's card, same options as above. |
| `GET` | `/healthz` | Liveness. |

### One card, several PCs

A GitHub user has one card, and up to 10 PCs can update it. Each PC's state is kept separately and expires on its own. The card shows:

1. A PC that is playing over one that is paused. Paused never replaces a PC that is playing.
2. Of several PCs playing, the one that started playing most recently. Heartbeats and track changes don't count as a new start, so two PCs playing at once don't flip back and forth.
3. Clearing (idle) on one PC removes only that PC's state; the card falls back to the next PC.

Ordering uses the server's clock, not the PC's. Signing in on an 11th PC removes the one that has been quiet for longest. The service stores the GitHub user ID and login, and the names of the signed-in PCs; never the GitHub token.

The device token is only stored as a SHA-256 hash. The card ID is random and can't be traced to an email, server or username.

## Ingest schema (v1)

```json
{ "v": 1, "seq": 42, "observedAt": 1790000000000, "state": "playing", "kind": "track",
  "title": "Blue Monday", "subtitle": "New Order", "positionMs": 61000, "durationMs": 447000 }
```

- Unknown fields are rejected, so a client bug can't upload extra data.
- Body limit 2 KB, text fields 200 characters.
- `seq` must go up for each device; replays and out-of-order updates get `409`.
- Each device can send 30 updates a minute; more get `429`. The app sends on change plus a 4-minute heartbeat, so this only stops runaway clients.
- `observedAt` must be within 2 minutes of server time.
- `state: "idle"` clears the card. Any other state expires after 10 minutes without an update, and the card falls back to "Not playing".
- Only send fields the user enabled for the card. Discord presence stays local and never goes through this service.

## Storage and counters

State lives in Upstash Redis (Frankfurt, `eu-central-1`; functions run in `fra1` next to it) (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) with a TTL, so nothing depends on function memory. The counters are aggregate only. Totals: `np:stats:cards_rendered` and `np:stats:registrations`. Per UTC day, for the private usage dashboard (#218): `np:stats:day:<date>:renders` and `np:stats:day:<date>:registrations` (plain counts), `np:stats:day:<date>:devices`, a HyperLogLog of hashed device IDs, and `np:stats:day:<date>:active_devices`, a counter that goes up when that HyperLogLog sees a new device. Together they estimate how many devices sent updates that day, never which ones. The per-day keys expire after 400 days. A failing stats write never fails a request.

`GET /badges/requests.json` publishes the `np:stats:cards_rendered` total as a [Shields endpoint badge](https://shields.io/badges/endpoint-badge) (label "card requests", cached for 5 minutes). It's a single public number with nothing per card or device. The README shows it with `https://img.shields.io/endpoint?url=https://nowplaying-hosted.vercel.app/badges/requests.json`.

## Deploy

`.github/workflows/hosted-deploy.yml` deploys to Vercel on pushes to `main` that touch `hosted/` or `src/card.js`, and on manual dispatch. It needs repo secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` and the repo variable `HOSTED_BASE_URL`. The Vercel project uses `hosted` as its root directory; the Redis credentials are Vercel environment variables, not GitHub secrets.

To self-host, wire `hosted/lib/app.js` handlers into any Node HTTP server and give it the same two Redis variables.
