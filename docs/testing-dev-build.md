# Testing a dev build

Every merge to `main` updates one moving pre-release, [`dev`](https://github.com/rowkavdev/nowplaying/releases/tag/dev). Use this checklist to test it on a clean Windows machine (a fresh VM or Windows Sandbox works) before a release.

Write down the build number and version from the release title, for example `dev build #77 (0.1.1-dev+c2a6b9e)`.

## 1. Download and check

- [ ] Download `nowplaying-dev-windows-x64-setup.exe` and `SHA256SUMS`.
- [ ] In PowerShell, run `Get-FileHash .\nowplaying-dev-windows-x64-setup.exe`. The hash matches the line in `SHA256SUMS`.
- [ ] Dev builds are unsigned, so SmartScreen may warn. Choose More info, then Run anyway.

## 2. Install

- [ ] Run the installer. On the Startup step, tick "Start nowplaying when I sign in".
- [ ] It installs for your user only (no admin prompt), usually to `%LOCALAPPDATA%\Programs\nowplaying`, and finishes without errors.

## 3. First launch

- [ ] Starting nowplaying with no saved config opens WebUI Settings in your default browser, with no console window. After connecting a media server, nowplaying starts. Later launches do not open the browser automatically.
- [ ] In **Media servers**, connect your server and sign in. Add a second server if available; both remain listed after nowplaying starts.
- [ ] Optional Spotify: in **Spotify and hosted card**, paste a Client ID from your own app in the Spotify developer dashboard (redirect URI `http://127.0.0.1/spotify/callback`) and choose **Sign in with Spotify**. You can do this before the first server. After you approve, Settings shows **Connected as** your account and `config.json` holds no token. Connect a server and confirm the Spotify account remains connected after restart.
- [ ] `%LOCALAPPDATA%\nowplaying\config.json` now exists and holds no password or token. In configured Settings, turn on Discord and pick an idle behaviour; the Card preview shows a made-up example.
- [ ] A made-up server name fails with "Couldn't find a server with that name", a self-signed https server with a certificate message, and a dead address with a timeout or unreachable message - never an offer to skip certificate checks.
- [ ] With Discord closed, Settings shows its disconnected state rather than claiming Rich Presence is active.

## 4. Running

- [ ] The nowplaying icon shows in the tray.
- [ ] `http://127.0.0.1:47832/healthz` returns `ok`.
- [ ] Play something. `http://127.0.0.1:47832/card.svg` shows it.
- [ ] With the Discord desktop app open, your status shows NowPlaying with what's playing.
- [ ] With Spotify signed in, play music or a podcast in any Spotify app: the card and hosted card show it and Discord does not. **Disconnect Spotify** in Settings unlinks it; if token deletion fails, Settings says so instead of claiming the token is gone.
- [ ] With a media server and Spotify both playing, the card shows whichever started most recently, and Discord keeps showing the media server.
- [ ] Play a TV episode: the card shows the series name with the episode code and title, like `Lost` / `S04E05 · The Constant`. Play a film: the card shows `Title (year)`.
- [ ] Stop playback. The status follows the idle behaviour you picked (clear, clear after a short wait, "Nothing playing", or the last item).
- [ ] Quit and reopen Discord. The status comes back without restarting nowplaying.

## 5. Tray

- [ ] "Settings" in the tray menu opens the settings page in your browser.
- [ ] Settings > Privacy > "Hide titles": within about 15 seconds Discord and the card show "Private media", with no show name or episode code.
- [ ] "Hide album art": Discord shows the NowPlaying icon instead of the cover.
- [ ] "Hide progress and timer": no progress bar on the card and no timer on Discord.
- [ ] "Don't show" Music (or Movies / TV episodes): playing that kind clears Discord and the card shows nothing playing. Untick it and it comes back.
- [ ] Settings > Discord > "When nothing is playing": pick "Show what I played last", Save, stop playback. Discord keeps the last item instead of clearing.
- [ ] Settings > Card: move Corners, Padding and Width, and switch Style. The preview redraws within a second each time. With nothing playing it shows "Sample track".
- [ ] Untick "Show progress bar". Bar thickness greys out and the bar goes from the preview. Pick Compact: the bar box unticks on its own.
- [ ] Type 90 in Width. A message says 280 to 800 and Save is greyed out. Put 520 back.
- [ ] Pick Light, 520 px, press Save. Open the card link from the Status page: the card is light and wider. Nothing restarted.
- [ ] Quit and reopen nowplaying. Settings > Card still shows Light and 520, and the card still looks the same.
- [ ] With the hosted card on, the README snippet under Hosted card ends in `?theme=paper&width=520`. Open that link and check it matches.
- [ ] Before or after the first server, **Settings > Spotify and hosted card > Hosted card** has **Sign in with GitHub**. Open the link and enter the code. The card link becomes `/u/<your-username>.svg`. Settings > Hosted card devices lists this PC; rename works and **Sign out** stops it updating.
- [ ] On an existing installation that has never used GitHub sign-in, open configured Settings and confirm the same button is visible without rerunning setup.
- [ ] "Back to defaults", then Save. The card goes back to dark, 440 px, and the hosted link has no `?` part.
- [ ] With artwork showing, the card background picks up the cover's colour. Set `card.artworkTint` to `false` in `config.json`: the background goes back to the plain theme colour.
- [ ] The status page lists every connected server, each with its own connection state.
- [ ] Settings > Media servers lists every server. Remove one there (not the last one); nowplaying restarts with the other servers still feeding the card and Discord.
- [ ] Restart nowplaying: the servers, Spotify sign-in and card, privacy and hosted settings survive.
- [ ] Settings shows a YouTube section with a pairing code and port. "Make a new code" warns the old code stops working.
- [ ] With the YouTube extension paired, playing a YouTube video shows it on the card and in Discord. A Short shows nothing.
- [ ] Status page > Reporting a problem: "See exactly what's in the report" shows the redacted report before it is copied.
- [ ] Open Settings again from the tray and save a change; it takes effect.
- [ ] Quit closes nowplaying. The icon goes, and Discord clears your status.

## 6. Start with Windows

- [ ] Sign out and back in (or restart). nowplaying starts on its own and the tray icon shows.
- [ ] `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\nowplaying.lnk` exists.
- [ ] Turn **Start NowPlaying when I sign in to Windows** off in Settings and sign in again. nowplaying doesn't start.

## 7. Uninstall

- [ ] Uninstall from Settings > Apps.
- [ ] The Startup shortcut is gone, even if you turned Start with Windows on in Settings rather than in the installer. nowplaying doesn't start at the next sign-in.

## Reporting a problem

Open an issue with the build number, your Windows version, the step that failed and what you saw. Leave out server addresses, usernames and tokens.
