# User guide skeleton (tested example paths)

Status of this document: **phase 1 skeleton** (#142). Each section below is a
documented guide path whose claims are executable: the harness in
`scripts/guide-paths.js` runs every path against the current tree and the
drift gate re-checks this page nightly. Phase 2 writes the prose into these
sections; it must not change a heading, marker, status line or step reference
without the harness still passing.

Run the harness locally:

```sh
node scripts/guide-paths.js run --all     # JSONL pass/fail per step
node scripts/guide-paths.js check-docs    # verify this page against a fresh run
```

## Windows install and first launch
<!-- guide-path: windows-install -->
Harness status: **pass** — verified by `node scripts/guide-paths.js run windows-install`.

Beyond the static checks, `scripts/windows-installer-e2e.js` silent-installs the real setup exe, proves the installed layout and sign-in shortcut, launches the installed app, then silent-uninstalls and proves removal (same JSONL step shape). **Pending:** it joins the guide-drift nightly gate when the arbiter's workflow push lands alongside this change; until then the four harness steps above are the active gate.

Checklist (each entry is asserted by the named harness step):

1. Download the release or dev build and verify the download against the published SHA256SUMS (harness step: checksums-published).
2. Unsigned dev builds: expect the SmartScreen prompt and confirm what to check before proceeding (harness step: unsigned-build-guidance).
3. Run the installer; it offers "Start nowplaying when I sign in" and pins the app identity (harness step: installer-artifacts).
4. First launch opens the setup wizard rather than tray-only start (harness step: first-run-wizard).

_Phase 2 prose pending: screenshots, per-edition notes, rollback._

## Provider connect (Plex)
<!-- guide-path: provider-connect -->
Harness status: **pass** — verified by `node scripts/guide-paths.js run provider-connect`.

Walkthrough outline (each entry is asserted by the named harness step against a local probe server):

1. Enter the server URL and token; the app polls the server's sessions endpoint (harness step: probe-connect).
2. Server URLs work with or without a trailing slash (harness step: server-url-shape).
3. A wrong token surfaces the server's 401, not a generic failure (harness step: bad-token-rejected).

_Phase 2 prose pending: least-privilege token location, user/player choice; Jellyfin, Navidrome and Emby walkthroughs join this page family._

## Discord Rich Presence visibility
<!-- guide-path: discord-rich-presence -->
Harness status: **pass** — verified by `node scripts/guide-paths.js run discord-rich-presence`.

Walkthrough outline (each entry is asserted by the named harness step against a fake Discord desktop client):

1. Discord desktop must be running; the app handshakes with its application ID (harness step: ipc-handshake).
2. A playing track shows title, artist and elapsed time (harness step: music-visibility).
3. TV episodes and movies show as watching activity (harness step: episode-and-movie-visibility).
4. When Discord is not running the app reports exactly that (harness step: not-running-guidance).

_Phase 2 prose pending: application/client setup screenshots, buttons, troubleshooting._

## Hosted SVG card render
<!-- guide-path: hosted-card -->
Harness status: **pass** — verified by `node scripts/guide-paths.js run hosted-card`.

Walkthrough outline (each entry is asserted by the named harness step over real HTTP against the hosted service):

1. Register a card, then push privacy-filtered playback state with the upload token (harness step: register-and-ingest).
2. Music, paused, TV episode and movie states all render through `GET /card/<id>.svg` (harness step: render-states-over-http).
3. Unchanged cards answer 304 to a matching ETag (harness step: cache-behavior).
4. Replayed sequences and tokenless uploads are rejected (harness step: stale-and-anonymous-rejected).
5. Disconnect deletes the uploaded state; the card stops serving media (harness step: disconnect-delete).

_Phase 2 prose pending: privacy field selection, Vercel-hosted and self-hosted setup, README Markdown, stale/expiry timing._
