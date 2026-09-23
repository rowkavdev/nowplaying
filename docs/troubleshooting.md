# Troubleshooting

Use this guide when the hosted card, Discord Rich Presence, Windows app or updater is not behaving as expected.

## Start with a health check

Open the server's `/health` endpoint first. A healthy response confirms the HTTP process is running, but it does not prove the media provider or Discord client is reachable.

Then check, in order:

1. the provider URL is reachable from the machine running nowplaying;
2. the provider credential is present and still valid;
3. the configured username matches the media-server account;
4. privacy rules are not intentionally hiding the session;
5. the server clock is correct;
6. no credential or private media data appears in copied logs.

## Windows logs

nowplaying's privacy-safe Windows log lives at `%LOCALAPPDATA%\nowplaying\logs\nowplaying.log`. Right-click the tray icon and choose **Open log folder** to open it in File Explorer. Logging is still being connected to every part of the app for v0.2, so on current development builds the folder may be empty or sparse.

- Each entry records only the time, level, component (`startup`, `provider`, `discord`, `updater`, `tray`), a status and an optional short error code. Titles, usernames, provider URLs and credentials are never written.
- When the file reaches 1 MB it rotates to `nowplaying.log.1`, and older files shift up. Three rotated files are kept, so the folder stays around 4 MB at most.
- Logs survive restarts. You can attach the folder's files to a bug report as they are.

## Card is offline or stale

- Confirm `/health` responds before testing `/card.svg`.
- Reload the card URL directly to separate GitHub image caching from a server problem.
- Check provider connectivity and credentials. The card can serve the last known good state during a short provider outage.
- Confirm the process can write its local state directory.
- If the card works directly but GitHub still shows an old image, wait for GitHub's image cache to refresh. Do not add credentials or private values as cache-busting query parameters.

## No active session appears

- Confirm the session belongs to the configured user.
- Check that the session is actively playing rather than stopped or filtered as idle.
- Verify the correct provider is selected.
- Compare the provider URL and credential with the values used by a working provider client.
- For Plex, use a token that can read sessions. For Jellyfin and Emby, use a read-only API key where possible. For Navidrome, verify the username, token and salt together.

## Discord Rich Presence is missing

- Run the Windows app in the same logged-in desktop session as Discord.
- Start the normal Discord desktop client before nowplaying.
- Check whether privacy or idle settings suppress the current activity.
- Confirm the Discord application ID and asset names match the configured application.
- Restart the tray app after changing Discord settings.

Discord Rich Presence is local. A server process running without a desktop session cannot publish activity to a Discord client on another machine.

## Windows app or tray does not start

- Use the installer on a supported 64-bit Windows system.
- If Windows warns about an unknown publisher, verify the SHA-256 checksum against the release's `SHA256SUMS` file before continuing. Private beta packages are currently unsigned.
- Try the portable ZIP to distinguish an installer problem from an application problem.
- Remove and re-enable the Start with Windows option if startup was configured under a different Windows account.
- Check Task Manager for an existing nowplaying process before launching a second copy.

## Update check fails

- Confirm the GitHub token can read the private repository and release assets.
- Check that the release includes the package and matching checksum entry.
- Verify the machine can reach GitHub over HTTPS.
- A failed install should leave the current version in place. If rollback also fails, use the portable ZIP from the release page and keep the failed logs for diagnosis.

The updater is notify-only unless install behavior has been explicitly enabled.

## Safe diagnostic information

Useful details to include in a private bug report:

- nowplaying version;
- operating system and package type (installer or portable ZIP);
- provider type, without its URL or credential;
- which output failed (card, Discord, updater or tray);
- the `/health` result;
- the exact error message with tokens, usernames, media titles, IP addresses and private URLs removed;
- steps that reproduce the problem.

Never post provider tokens, API keys, GitHub tokens, webhook secrets, private server URLs, usernames, media titles or unredacted configuration.
