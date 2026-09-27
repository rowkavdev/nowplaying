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

Scope: static artifact and workflow checks only. The harness does not run the installer or any Windows E2E; the manual GUI steps are asserted as checklist coverage of shipped artifacts and release-workflow behavior.

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

Scope: local renderer and committed-gallery checks only. The harness renders through `src/card.js` and compares `docs/assets/cards/`; it does not exercise the hosted HTTP service (`hosted/`).

Walkthrough outline (each entry is asserted by the named harness step):

1. Every documented card state renders with its media title (harness step: render-all-states).
2. The same playback state renders byte-identical output (harness step: deterministic-output).
3. The committed gallery in `docs/assets/cards/` always matches the shipped renderer (harness step: gallery-in-sync).
4. Card markup never embeds credentials (harness step: no-secrets-in-markup).

_Phase 2 prose pending: privacy field selection, Vercel-hosted and self-hosted setup, README Markdown, cache/stale behavior, disconnect/delete._
