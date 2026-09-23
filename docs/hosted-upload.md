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
| Track, episode or movie | Card shows the media type |
| Time of the update and a counter | Always (stops old or replayed updates) |

With privacy mode set to private, or for a media type you've hidden, the card only ever gets "nothing playing".

## What is never sent

- Your media server's address, your username or anyone else on the server
- Your server sign-in or API key
- Artwork or artwork links
- Discord details (Discord presence stays on your PC)
- A history of what you've played

## How it's stored

- The service keeps only the latest update for your card, and deletes it 10 minutes after the last one. Stop playing or close the app and the card goes back to "Not playing".
- Your card link uses a random ID. It can't be traced to your email, server or username.
- Your PC gets a device key the first time it connects. It's kept in Windows Credential Manager, not in `config.json`. The service only stores a hash of it.
- The service's logs and counters never contain titles, artists, usernames or keys. The only counters are totals: cards shown and devices registered.

## How often it sends

When something changes (new track, pause, skip, seek), plus a check-in every 4 minutes while playing. Not every second. If your connection drops, the app keeps only the newest state and tries again later.

## Turning it off

Disconnecting deletes your card's state and the device key on the service, and removes the key from your PC. The old card link stops showing anything.

## For developers

- Config: `hosted: { "enabled": true, "url": "https://..." }` in `config.json`. `url` is optional and must be HTTPS.
- Payload: built by `projectHostedState` in `src/hosted-projection.js`; tests in `test/hosted-projection.test.js` check that fields turned off for the card never reach the wire.
- Client: `src/hosted-uploader.js`. Service and schema: [hosted/README.md](../hosted/README.md). Design: #140.
