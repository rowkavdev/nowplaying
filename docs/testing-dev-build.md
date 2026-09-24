# Testing a dev build

Every merge to `main` updates one moving pre-release, [`dev`](https://github.com/rowkav09/nowplaying/releases/tag/dev). Use this checklist to test it on a clean Windows machine (a fresh VM or Windows Sandbox works) before a release.

Write down the build number and version from the release title, for example `dev build #77 (0.1.1-dev+c2a6b9e)`.

## 1. Download and check

- [ ] Download `nowplaying-dev-windows-x64-setup.exe` and `SHA256SUMS`.
- [ ] In PowerShell, run `Get-FileHash .\nowplaying-dev-windows-x64-setup.exe`. The hash matches the line in `SHA256SUMS`.
- [ ] Dev builds are unsigned, so SmartScreen may warn. Choose More info, then Run anyway.

## 2. Install

- [ ] Run the installer. On the Startup step, tick "Start nowplaying when I sign in".
- [ ] It installs for your user only (no admin prompt), usually to `%LOCALAPPDATA%\Programs\nowplaying`, and finishes without errors.

## 3. First launch

- [ ] Starting nowplaying with no saved config opens the setup page in your default browser, with no console window. After you finish setup, nowplaying starts. Later launches do not open the browser.
- [ ] Connect your media server and sign in.
- [ ] Turn on Discord and pick an idle behaviour.
- [ ] Finish setup. `%LOCALAPPDATA%\nowplaying\config.json` now exists and holds no password or token.

## 4. Running

- [ ] The nowplaying icon shows in the tray.
- [ ] `http://127.0.0.1:47832/healthz` returns `ok`.
- [ ] Play something. `http://127.0.0.1:47832/card.svg` shows it.
- [ ] With the Discord desktop app open, your status shows NowPlaying with what's playing.
- [ ] Stop playback. The status follows the idle behaviour you picked (clear, clear after a short wait, "Nothing playing", or the last item).
- [ ] Quit and reopen Discord. The status comes back without restarting nowplaying.

## 5. Tray

- [ ] "Settings" in the tray menu opens the settings page in your browser.
- [ ] Settings > Privacy > "Hide titles": within about 15 seconds Discord and the card show "Private media", with no show name or episode code.
- [ ] "Hide album art": Discord shows the NowPlaying icon instead of the cover.
- [ ] "Hide progress and timer": no progress bar on the card and no timer on Discord.
- [ ] "Don't show" Music (or Movies / TV episodes): playing that kind clears Discord and the card shows nothing playing. Untick it and it comes back.
- [ ] "Run setup again" opens setup, and the change you save takes effect.
- [ ] Quit closes nowplaying. The icon goes, and Discord clears your status.

## 6. Start with Windows

- [ ] Sign out and back in (or restart). nowplaying starts on its own and the tray icon shows.
- [ ] `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\nowplaying.lnk` exists.
- [ ] Turn Start with Windows off in setup and sign in again. nowplaying doesn't start.

## 7. Uninstall

- [ ] Uninstall from Settings > Apps.
- [ ] The Startup shortcut is gone, even if you turned Start with Windows on in setup rather than in the installer. nowplaying doesn't start at the next sign-in.

## Reporting a problem

Open an issue with the build number, your Windows version, the step that failed and what you saw. Leave out server addresses, usernames and tokens.
