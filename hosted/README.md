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
| `POST` | `/api/ingest` | `Authorization: Bearer <device token>`. Push one state update (schema below). |
| `POST` / `DELETE` | `/api/revoke` | Delete the device token and any stored state. |
| `GET` / `HEAD` | `/card/<cardId>.svg` | Public SVG. Options: `theme`, `width`, `show` (same as the local card). |
| | | Layout options, all optional: `padding` (12-48), `radius` (0-24), `titleSize` (14-30), `subtitleSize` (10-20), `progressHeight` (2-12), `textAlign` (`start`/`middle`/`end`), `fieldOrder` (`state`, `title`, `subtitle` once each, comma-separated), `progressPosition` (`bottom`/`text`), `progressWidth` (`content`/`full`), `direction` (`ltr`/`rtl`/`auto`). Out-of-range or repeated values return 400 `invalid_layout`. Set only in the URL, never sent by the app. |
| `GET` | `/healthz` | Liveness. |

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

State lives in Upstash Redis (Frankfurt, `eu-central-1`; functions run in `fra1` next to it) (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) with a TTL, so nothing depends on function memory. The only counters are aggregate totals: `np:stats:cards_rendered` and `np:stats:registrations`.

## Deploy

`.github/workflows/hosted-deploy.yml` deploys to Vercel on pushes to `main` that touch `hosted/` or `src/card.js`, and on manual dispatch. It needs repo secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` and the repo variable `HOSTED_BASE_URL`. The Vercel project uses `hosted` as its root directory; the Redis credentials are Vercel environment variables, not GitHub secrets.

To self-host, wire `hosted/lib/app.js` handlers into any Node HTTP server and give it the same two Redis variables.
