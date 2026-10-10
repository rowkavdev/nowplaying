# Install on Linux (experimental)

Linux desktop builds are available for **x86_64** from the [rolling dev release](https://github.com/rowkavdev/nowplaying/releases/tag/dev). Choose a native package for your distribution or the portable tarball. These are moving development builds, not stable releases. Keep the files for a known working build if you need to roll back. ARM packages are not published by the current Linux desktop release workflow.

## Download and verify

Download your chosen package and `SHA256SUMS` from the same release. In the download folder, run:

```sh
sha256sum --ignore-missing -c SHA256SUMS
```

Your downloaded file must say `OK`. Native package names include the version and development commit; the portable file is `nowplaying-dev-linux-x64.tar.gz`. Status and diagnostics show the exact running commit and package type. `nowplaying --version` reports only the base app version. Avoid mixing downloads from different revisions of the moving release.

## Native package

Use the package manager for your distribution so desktop dependencies are installed too. Run the matching command in a folder containing just the package you want to install, or replace the wildcard with its exact filename:

| Package | Install or upgrade |
| --- | --- |
| Debian-family `.deb` | `sudo apt install ./nowplaying_*.deb` |
| Fedora `.rpm` | `sudo dnf install ./nowplaying-*.x86_64.rpm` |
| Arch `.pkg.tar.zst` | `sudo pacman -U ./nowplaying-*.pkg.tar.zst` |

The native package places the app in `/opt/nowplaying`, adds the `nowplaying` command and a **NowPlaying** application-menu entry. Launch that entry as your usual desktop user. Administrator access is only needed for package installation. Install an upgrade with the same package manager, then quit and reopen NowPlaying to use the new build.

The packaging lab targets Debian 13, Fedora 43 and rolling Arch. This does not guarantee every release or desktop; the [desktop acceptance checklist](../linux-desktop-testing.md) describes the verification scope.

## Portable tarball

The tarball bundles Node.js and the app. It does not install desktop dependencies or a menu entry, and does not need administrator access to extract or launch:

```sh
tar -xzf nowplaying-dev-linux-x64.tar.gz
cd nowplaying
./nowplaying start
```

Keep the extracted files together. Choose a permanent folder before enabling start-at-login. To upgrade, quit NowPlaying, replace the whole bundle with the new verified download and start it from the same location. Your user settings and sign-ins live outside the bundle.

## Desktop requirements

- A graphical user session with a working session D-Bus and `xdg-open` for browser Settings.
- Python 3 with GObject introspection, GTK 3 and Ayatana AppIndicator (or AppIndicator) for the tray. Native packages declare these dependencies. Portable users need the corresponding distribution packages: `python3-gi`, `gir1.2-gtk-3.0` and `gir1.2-ayatanaappindicator3-0.1` on Debian; `python3-gobject`, `gtk3` and `libayatana-appindicator-gtk3` on Fedora; `python-gobject`, `gtk3` and `libayatana-appindicator` on Arch.
- `secret-tool` from libsecret and an unlocked **Secret Service** credential store. Native packages include GNOME Keyring as a provider. KDE users can also use a configured KWallet Secret Service provider; an installed wallet alone does not prove that the service is available in the current session. Debian calls the command package `libsecret-tools`; Fedora and Arch call it `libsecret`.
- A desktop that displays StatusNotifier/AppIndicator items. KDE and XFCE have indicator support; GNOME may need its AppIndicator extension enabled. If the tray is unavailable, NowPlaying keeps its local WebUI running and logs a warning.

Node.js is bundled in release downloads. Node.js 22 or newer is needed only when developing from source.

## First launch and playback

The first launch opens **Settings in your browser**. If no tab opens, visit [local Settings](http://127.0.0.1:47832/settings). Find a server or use **Add a server by address**, then sign in. Plex uses its browser authorization flow; Plexamp can keep playing while you complete setup. NowPlaying reads the server's playback sessions, so choose the server your player uses.

Play a track and open [the local card](http://127.0.0.1:47832/card.svg). For Discord, open the **Discord desktop app**, enable **Settings > Discord > Show what I'm playing on Discord**, and save. Linux socket discovery includes native Discord and the Flatpak Discord session. Discord in a browser cannot accept local Rich Presence.

For private server covers, **Show my server's cover** uploads the cover to a temporary public host; Discord cannot load artwork directly from your private server. Check [artwork privacy and fallbacks](../artwork.md#discord-cover-upload) before enabling it. Music status text defaults to **song - artist**; saved custom wording remains available in Discord Settings.

Launching NowPlaying again opens the existing app's Settings. Only one instance uses the local port.

**Start NowPlaying at login** is optional in Settings. It creates `~/.config/autostart/nowplaying.desktop`, respecting `XDG_CONFIG_HOME`. Disable it before moving a portable bundle.

## Files and troubleshooting

Defaults, with XDG directory overrides respected:

- Settings: `~/.config/nowplaying/config.json`
- Logs: `~/.local/state/nowplaying/logs/nowplaying.log`
- Sign-ins: the desktop Secret Service credential store, separate from `config.json`

If sign-in fails to save, check that `secret-tool` is installed and your credential store is unlocked in this desktop session. If Discord reports unavailable, check that its desktop app is open under the same user. If artwork is missing, check privacy settings, the cover-upload option and network access to the configured artwork services. Use **Refresh album art** after changing artwork settings.

To remove a native installation, quit NowPlaying, turn off start-at-login and use `sudo apt remove nowplaying`, `sudo dnf remove nowplaying` or `sudo pacman -R nowplaying`. For a portable install, quit, turn off start-at-login and delete the bundle. User settings and saved credentials are separate and may remain. To clear them, remove the app's user data and its `nowplaying` entries in your desktop credential manager after quitting.

When reporting a problem, include the package version/commit, distribution, desktop environment, package format, native or Flatpak Discord, steps and observed result. Do not include tokens or your server address. See the [dev-build checklist](../testing-dev-build.md) and [troubleshooting guide](Troubleshooting.md).
