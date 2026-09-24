# Troubleshooting

Use this guide when the hosted card, Discord Rich Presence, Windows app or updater is not behaving as expected.

## Start with a health check

Open the server's `/healthz` endpoint first. A healthy response confirms the HTTP process is running, but it does not prove the media provider or Discord client is reachable.

Then check, in order:

1. the provider URL is reachable from the machine running nowplaying;
2. the provider credential is present and still valid;
3. the configured username matches the media-server account;
4. privacy rules are not intentionally hiding the session;
5. the server clock is correct;
6. no credential or private media data appears in copied logs.

## Windows logs

nowplaying's privacy-safe Windows log lives at `%LOCALAPPDATA%\nowplaying\logs\nowplaying.log`. Right-click the tray icon and choose **Open log folder** to open it in File Explorer. `nowplaying.exe start` records startup, successful start, stop and startup failures (with a short code such as `CONFIG_LOAD_FAILED` or `CONFIG_INVALID`). Provider and updater events are still being connected for v0.2.

- Each entry records only the time, level, component (`startup`, `provider`, `discord`, `updater`, `tray`), a status and an optional short error code. Titles, usernames, provider URLs and credentials are never written.
- When the file reaches 1 MB it rotates to `nowplaying.log.1`, and older files shift up. Three rotated files are kept, so the folder stays around 4 MB at most.
- Logs survive restarts. You can attach the folder's files to a bug report as they are.

## Card is offline or stale

- Confirm `/healthz` responds before testing `/card.svg`.
- Open the card URL directly. A fresh card there means the origin is working, even if a README still shows an older image.
- Check provider connectivity and credentials. The card can serve the last known good state during a short provider outage.
- Confirm the process can write its local state directory.
- Inspect the card response without saving private data:

```sh
curl --head 'https://cards.example/card.svg'
```

The current response includes `ETag` and `Cache-Control`. A `304 Not Modified` response means the client revalidated the same card. A `200 OK` with a new `ETag` means the origin changed. GitHub fetches README images through its Camo proxy, so an origin change may still take time to appear in a README.

Do not add tokens, usernames, media titles, private URLs or random cache-busting values to a public card URL. Query strings are logged by browsers, proxies and hosting platforms. Keep the documented card URL stable and wait for GitHub's cache to revalidate. Planned privacy-safe cache-state and data-age headers are tracked in [#118](https://github.com/rowkav09/nowplaying/issues/118).

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

## Safe mode after repeated failed starts

If nowplaying fails to start three times in a row (or crashes within a minute of starting), the next start is in safe mode. The local card and status page still run, but Discord presence and hosted card uploads stay off. The log records `SAFE_MODE_<PART>`, where the part is whatever failed last, for example `SAFE_MODE_CONFIGURATION`.

To leave safe mode, right-click the tray icon and choose **Run setup again**. The next start is a normal one. If it keeps failing, export diagnostics from the status page and include them when you report the problem.

## Update check fails

- Confirm the GitHub token can read the private repository and release assets.
- Check that the release includes the package and matching checksum entry.
- Verify the machine can reach GitHub over HTTPS.
- A failed install should leave the current version in place. If rollback also fails, use the portable ZIP from the release page and keep the failed logs for diagnosis.

The updater is notify-only unless install behavior has been explicitly enabled.

## Config backups and recovery

NowPlaying keeps its settings in `config.json` (on Windows: `%LOCALAPPDATA%\nowplaying\config.json`). When a new version changes the config format, NowPlaying upgrades the file at start-up. Before it changes anything, it saves a copy next to it as `config.json.backup-<date and time>`. The new file only replaces the old one after it has been checked.

- If the upgrade fails, the original file is left exactly as it was.
- If the config was saved by a newer NowPlaying (for example after going back to an older version), the app won't start and says so, and the file is not changed. Update NowPlaying, or run `nowplaying.exe setup` to start again.
- To go back to a backup: close NowPlaying, delete `config.json`, rename the backup you want to `config.json`, then start NowPlaying again.

Backups never contain your sign-in. That stays in Windows Credential Manager.

## Safe diagnostic information

The status page (the app's local address in your browser, ending in `/status`) has a **Copy diagnostics** button and a **Download** link under "Reporting a problem". The report has exactly these fields and nothing else:

| Field | What it holds |
| --- | --- |
| `schemaVersion` | Format version of the report (currently 1) |
| `version` | nowplaying version, for example `0.1.1-dev+227abab` |
| `platform` | Operating system, for example `win32` |
| `packageType` | Installer or portable, when known |
| `enabledOutputs` | `card`, plus `discord` when Discord is on |
| `provider` | Server type (`jellyfin`, `plex`, ...) and connection state (`connected`, `unreachable`, `authentication_failed`, ...) |
| `health` | `healthy`, `starting` or `degraded` |
| `updater`, `tray` | Updater and tray state, or `null` when not reported |
| `errors` | Short error codes only, with URLs, IP addresses, tokens, user names and track names removed |

Your server address, user name, what you're playing and any sign-in details are never included. The report is safe to attach to a bug report.

Useful details to include in a private bug report:

- nowplaying version;
- operating system and package type (installer or portable ZIP);
- provider type, without its URL or credential;
- which output failed (card, Discord, updater or tray);
- the `/healthz` result;
- the exact error message with tokens, usernames, media titles, IP addresses and private URLs removed;
- steps that reproduce the problem.

Never post provider tokens, API keys, GitHub tokens, webhook secrets, private server URLs, usernames, media titles or unredacted configuration.
