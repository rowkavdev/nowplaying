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

- The service keeps only the latest update from each of your PCs, and deletes it 10 minutes after the last one. Stop playing or close the app and the card goes back to "Not playing".
- The service's logs and counters never contain titles, artists, usernames or keys. The only counters are totals: cards shown, PCs registered and people signed in.

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

- Config: `hosted: { "enabled": true, "url": "https://..." }` in `config.json`. `url` is optional and must be HTTPS.
- Payload: built by `projectHostedState` in `src/hosted-projection.js`; tests in `test/hosted-projection.test.js` check that fields turned off for the card never reach the wire.
- Client: `src/hosted-uploader.js`; GitHub sign-in (device flow): `src/hosted-signin.js`. Service and schema: [hosted/README.md](../hosted/README.md). Design: #140.
