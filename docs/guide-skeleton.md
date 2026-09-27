# User guide: tested example paths

Every claim on this page is executable. The harness in
`scripts/guide-paths.js` runs each path against the current tree and the
drift gate re-checks the page nightly, so the examples below describe what is
actually shipped. Where a step needs manual verification (a real installer, a
real Discord client), the harness asserts the checklist coverage instead.

Run the checks locally:

```sh
node scripts/guide-paths.js run --all     # JSONL pass/fail per step
node scripts/guide-paths.js check-docs    # verify this page against a fresh run
```

## Windows install and first launch
<!-- guide-path: windows-install -->
Harness status: **pass** — verified by `node scripts/guide-paths.js run windows-install`.

**1. Download and verify.** From the release page, download
`nowplaying-v<version>-windows-x64-setup.exe` and the `SHA256SUMS` file next
to it (harness step: checksums-published). In PowerShell, in your Downloads
folder:

```powershell
Get-FileHash .\nowplaying-v0.2.0-windows-x64-setup.exe -Algorithm SHA256
```

Expected output: a hash identical to the setup exe's line in `SHA256SUMS`.
If it differs, delete the file and download again — do not install.

**2. Run the installer.** Double-click the setup exe. Stable releases are the
recommended build; unsigned development builds make Windows SmartScreen show
"Windows protected your PC" — only after the hash matches, choose **More
info → Run anyway** (harness step: unsigned-build-guidance). The installer
offers "Start nowplaying when I sign in" (off by default) and always installs
for your user only (harness step: installer-artifacts).

**3. First launch.** When installation finishes, the setup wizard opens in
your browser (harness step: first-run-wizard). It walks through provider,
Discord and hosted card in order; the next sections cover each one.

**Undo:** Settings → Apps → nowplaying → Uninstall removes the app and the
sign-in shortcut.

Beyond the static checks above, `scripts/windows-installer-e2e.js`
silent-installs the real setup exe, proves the installed layout and sign-in
shortcut, launches the installed app, then silent-uninstalls and proves
removal (same JSONL step shape). **Pending:** it joins the guide-drift
nightly gate when the arbiter's workflow push lands; until then the four
harness steps above are the active gate.

## Connect Plex
<!-- guide-path: provider-connect -->
Harness status: **pass** — verified by `node scripts/guide-paths.js run provider-connect`.

**1. Server URL.** Enter your Plex server's address, for example
`http://192.168.1.20:32400`. A trailing slash is fine either way (harness step: server-url-shape).

**2. Token.** In Plex Web, open any media item → **Get Info** → **View XML**,
then copy the `X-Plex-Token=` value from the address bar. Treat the token
like a password: Plex tokens are account-scoped, so use yours only against
your own server. nowplaying stores it in the operating system's credential
store, never in plain files.

**3. Connect.** The wizard polls the server and shows what is playing for
your user (harness step: probe-connect). Nothing playing simply shows idle —
that is normal.

**Common errors.** A 401 means the token is wrong or expired; copy a fresh
one from Plex Web and try again (harness step: bad-token-rejected).

**Undo:** remove the server in Settings; its credential is deleted from the
OS credential store.

Jellyfin, Navidrome and Emby walkthroughs follow the same shape and join this
page when their guide paths land.

## Discord Rich Presence
<!-- guide-path: discord-rich-presence -->
Harness status: **pass** — verified by `node scripts/guide-paths.js run discord-rich-presence`.

**1. Use Discord desktop.** Rich Presence works through the Discord desktop
app's local socket; browser Discord cannot do this. Start Discord first, then
nowplaying, which handshakes with its own application ID — no Discord
developer setup is needed (harness step: ipc-handshake).

**2. Play something.** A playing track shows as listening, with title, artist
and elapsed time — "Holocene — Bon Iver" (harness step: music-visibility).
TV episodes and movies show as watching — "Lost S4E5 · The Constant",
"Spirited Away" (harness step: episode-and-movie-visibility).

**Troubleshooting.** If the app reports "Discord is not running", start the
Discord desktop app and restart nowplaying (harness step: not-running-guidance).
Presence clears automatically when playback stops.

## Hosted SVG card
<!-- guide-path: hosted-card -->
Harness status: **pass** — verified by `node scripts/guide-paths.js run hosted-card`.

**1. Connect.** In Settings → hosted card, connect: the app registers a card
and receives an upload token (harness step: register-and-ingest).

**2. Pick your fields.** The app pushes only the privacy-filtered playback
fields you enable. Music, paused, TV episode and movie states all render on
the card (harness step: render-states-over-http).

**3. Use the card.** The app shows your card URL, which serves an SVG — for
example in a README:

```md
![now playing](https://<your-hosted-card>/card/<your-card-id>.svg)
```

**Cache and stale behavior.** An unchanged card answers 304 to a conditional
request, so embedding is cheap (harness step: cache-behavior). Uploads expire
after 10 minutes without a fresh one, and replayed or tokenless uploads are
rejected (harness step: stale-and-anonymous-rejected), so a card never shows
stale media as current.

**Disconnect.** Settings → hosted card → disconnect deletes the uploaded
state immediately; the card stops serving media (harness step: disconnect-delete).

Self-hosted and Vercel deployment notes are in [deployment.md](deployment.md)
and [hosted-card.md](hosted-card.md).
