# Hosted card: what leaves your PC

The hosted card lets you put a now-playing card in a GitHub README without opening your media server to the internet. The app on your PC reads what's playing, then sends a small update to the card service at https://nowplaying-hosted.vercel.app. The service never connects to your PC or your server.

It's off until you turn it on.

## What is sent

Only these fields, and only the ones your card shows:

| Field | Sent when |
| --- | --- |
| Playing, paused or nothing playing | Always (this is what the card is) |
| Title | Always, unless privacy mode hides it. With "redact titles" on, the card gets "Private media" instead |
| Artist / show | Card shows the subtitle and titles aren't redacted |
| Position and length | Card shows progress and privacy doesn't hide it |
| Small cover image | Only with **Include cover art** enabled, artwork visible, and titles unredacted |
| Track, episode or movie | Card shows the media type |
| Time of the update and a counter | Always (stops old or replayed updates) |

With privacy mode set to private, or for a media type you've hidden, the card only ever gets "nothing playing".

## What is never sent

- Your media server's address, your username or anyone else on the server
- Your server sign-in or API key
- Artwork links (optional uploads contain image pixels only)
- Discord details (Discord presence stays on your PC)
- A full playback history (the most recent item per media type is retained as described below)

## Cover art

Enable **Settings → Hosted Card Settings → Include cover art** to share album covers and posters. It is off by default, including after upgrades. The app fetches artwork locally, strips metadata, resizes it to fit within 256 × 256 pixels, and uploads a PNG of at most 48 KiB. The image is public with the card and expires with the playback state. The service never fetches an artwork URL or contacts your media server. **Hide artwork**, **Hide titles**, private mode and hidden media types prevent cover uploads. Compact cards remain text-only. Turning cover sharing off replaces the stored image on the next successful update; CDN copies can remain for the normal 30-second cache lifetime.

Deploy the updated hosted service before enabling cover sharing in the updated desktop app; older service versions reject the new optional image field.

## How it's stored

- The service keeps the latest live update from each of your PCs, and deletes it 10 minutes after the last one. Stop playing or close the app and the card goes back to "Not playing".
- For the last-played badge, the service also keeps one record per media type for up to 7 days: its title, subtitle, type, last playback state and update time. The title and subtitle remain public in last-played badges after playback stops or privacy settings change. Signing out everywhere, or revoking a legacy per-PC card, deletes those records right away; otherwise they expire on their own.
- The service's logs and counters never contain titles, artists, usernames or keys. The only counters are totals: cards shown, PCs registered and people signed in. Each total is also published as a public badge; see [Usage badges](#usage-badges).

## Usage badges

The service publishes three aggregate totals as [Shields endpoint badges](https://shields.io/badges/endpoint-badge), cached for five minutes:

| Badge | URL |
| --- | --- |
| Cards shown | `https://nowplaying-hosted.vercel.app/badges/requests.json` |
| PCs registered | `https://nowplaying-hosted.vercel.app/badges/pcs.json` |
| People signed in | `https://nowplaying-hosted.vercel.app/badges/users.json` |

Point a Shields endpoint badge at one of them, for example:

```md
![Cards shown](https://img.shields.io/endpoint?url=https%3A%2F%2Fnowplaying-hosted.vercel.app%2Fbadges%2Frequests.json)
```

Each badge is a single number with nothing per card, per PC or per person. If the counter is unavailable the endpoint answers `503`, so Shields shows its error state instead of a number. Self-hosted deployments can wire the same handlers and serve the same badges from their own domain.

### Content badges

Two more badges show what a card is playing instead of a total. Both take the same card address as a card link (`?user=<your-github-username>` or `?id=<cardId>`) and an optional `kind` filter: `track`, `episode`, `movie`, `show` or `unknown` (default `any`).

| Badge | Shows |
| --- | --- |
| `https://nowplaying-hosted.vercel.app/badges/now.json` | The live playback of that kind, or "not playing" when idle or the kind doesn't match |
| `https://nowplaying-hosted.vercel.app/badges/last.json` | The same, falling back to the most recent playback of that kind whenever nothing of that kind is playing |

For example, a badge that shows the film you last watched:

```md
![Last watched](https://img.shields.io/endpoint?url=https%3A%2F%2Fnowplaying-hosted.vercel.app%2Fbadges%2Flast.json%3Fuser%3Dyour-github-username%26kind%3Dmovie)
```

The label follows the kind: "listening to" for tracks, "watching" for films, episodes and shows, and "now playing" for anything else; the fallback badges say "last listened", "last watched" or "last played". Paused playback says so. A content badge shows only the title and subtitle your card already shows publicly — never artwork, timestamps, positions or anything about your PCs. It refreshes every minute.

### Signed in with GitHub (one card for all your PCs)

- In WebUI **Settings > Spotify and hosted card > Hosted card**, check the service address and choose **Sign in with GitHub**. Open the GitHub link displayed there and enter its code. You can do this on first run or later, after connecting a media server; you do not need to start setup again. The app asks GitHub for no permissions beyond your public profile.
- The app hands GitHub's sign-in to the card service once. The service asks GitHub who you are, then throws it away. Neither your PC nor the service keeps it.
- The service stores your GitHub user ID and username, and the names of the PCs you've signed in (you can rename them). That's all it knows about you.
- Your card link is `https://nowplaying-hosted.vercel.app/u/<your-github-username>.svg`. It's public, like the README it sits in, so anyone can see that you have a card. Only your signed-in PCs can change it.
- If you rename your GitHub account, sign in again and the link moves to the new name.
- Several PCs can update the same card, up to 10. The card shows the PC that's playing; if two are playing, the one that started most recently. A paused PC never replaces one that's playing.

### Without signing in

- Your card link uses a random ID. It can't be traced to your email, server or username. Each PC gets its own card.
- To sign in later, open **Settings > Spotify and hosted card > Hosted card** and choose **Sign in with GitHub**. The old random link keeps working and shows your new card.

In both cases, each PC gets its own device key. It's kept in the system's credential store (Windows Credential Manager on Windows), not in `config.json`, and the service only stores a hash of it.

## How often it sends

When something changes (new track, pause, skip, seek), plus a check-in every 4 minutes while playing. Not every second. If your connection drops, the app keeps only the newest state and tries again later.

## Turning it off

Disconnecting a PC deletes that PC's state and device key on the service, and removes the key from the PC. With GitHub sign-in, your other PCs keep updating the card; "sign out everywhere" removes every PC. Without sign-in, the card link stops showing anything.

## For developers

- Config: `hosted: { "enabled": true, "artwork": false, "url": "https://..." }` in `config.json`. `url` is optional and must be HTTPS.
- Payload: built by `projectHostedState` in `src/hosted-projection.js`; tests in `test/hosted-projection.test.js` check that fields turned off for the card never reach the wire.
- Client: `src/hosted-uploader.js`; GitHub sign-in (device flow): `src/hosted-signin.js`. Service and schema: [hosted/README.md](../hosted/README.md). Design: #140.

## Hosted credential destination

New device credentials record the service URL that issued them, including its base path. Uploads, device management and revocation reject a credential bound to another destination before sending it. Old credentials without that field require sign-in again; the app does not guess their issuing service.

If switching services fails while saving Settings, the new credential stays bound to the new service and cannot be sent to the old one. Polling the completed sign-in again retries the Settings save without repeating registration. After a restart, sign in to the intended service again if the destination change did not save.
