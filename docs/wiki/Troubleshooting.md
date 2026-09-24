# Troubleshooting

Find the symptom you see. Keep server addresses, usernames and tokens out of anything you share.

## First checks for anything odd

1. Open `http://127.0.0.1:47832/healthz`. It should answer `ok`. If not, nowplaying isn't running - start it from the Start Menu.
2. Check your media server is reachable in a browser on the same PC.
3. Look at recent events on the **Logs** page, or the log file at `%LOCALAPPDATA%\nowplaying\logs\nowplaying.log` (tray icon, **Open log folder**). Logs never contain titles, usernames or tokens, so they're safe to attach to a bug report.

## Discord shows nothing

- In setup, the Discord step has a **Test Discord** button: it sends a short test status and tells you if Discord refused it, isn't open, or didn't answer.
- Make sure the **Discord desktop app** is open; a browser tab doesn't work.
- In Discord settings, check **Activity Privacy** and turn activity sharing on.
- Play something and wait a few seconds.

## Discord or the card shows a stuck track

nowplaying clears sessions that sit at the same position too long. If Discord itself looks stuck, quit and reopen Discord; nowplaying reconnects on its own.

## The README card is stale or offline

- Open your card link directly. Fresh there but stale in the README means GitHub's image cache is behind; it catches up on its own.
- If the media server is down, the card shows the last good state for a while, then goes idle. nowplaying retries with growing gaps up to 2 minutes and recovers on its own.
- Stop playing or close the app and the card returns to "Not playing" within about ten minutes.

## The media server connection failed in setup

- **Couldn't find a server with that name:** check the address is spelled right, or use the server's IP address instead.
- **Certificate isn't trusted:** the server's security certificate is self-signed or out of date. Give the server a certificate Windows trusts, or use its local `http://` address. Setup never offers to skip certificate checks.
- **Timed out or unreachable:** the server address must open in a browser on the same PC. Check the port, that the server is running, and that it's `http://` or `https://` with no extra path.
- **YouTube extension not reporting:** check the pairing code and port in the extension's options match the settings page, and that you're not watching a Short. After **Make a new code**, paste the new code into the extension.
- **Authentication failed:** check the sign-in on the server's own web interface, then try again. See your provider's page: [Plex](Connect-Plex) · [Jellyfin](Connect-Jellyfin) · [Navidrome](Connect-Navidrome) · [Emby](Connect-Emby) · [Spotify](Connect-Spotify).

## Still stuck

Open an [issue](https://github.com/rowkavdev/nowplaying/issues) with the build number, your Windows version, the step that failed and what you saw. The status page's **Reporting a problem** copies a short report - expand **See exactly what's in the report** to check it first. Attach log files if you can. Leave out server addresses, usernames and tokens.
