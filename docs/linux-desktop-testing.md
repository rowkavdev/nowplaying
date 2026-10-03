# Linux desktop dev-build acceptance

The Linux desktop implementation uses the existing browser setup and a native
GTK/AppIndicator tray helper. Start-at-login remains opt-in in Settings. No
separate setup window, terminal or automatic login entry is required for normal
installed launch. The CLI remains available; `start --no-tray --no-setup` is the
headless route.

Native packages use a shared bundle under `/opt/nowplaying`, a menu launcher,
and distro-declared desktop dependencies. The package builders support x86_64
Debian (.deb), Fedora (.rpm) and Arch (.pkg.tar.zst). They do not publish anything.

## Automated evidence

Planned coverage (not yet a passed distro guarantee): `Linux desktop packages`
is intended to install a built package in Debian 13, Fedora 43 and
Arch's rolling container image. Each is intended to run the installed app as an unprivileged
user with Xvfb and a private session bus. A synthetic StatusNotifier host is intended to check:

- Actual GTK/AppIndicator process registers an Active tray item.
- First-run Settings is served on loopback by the installed app.
- Open Web UI, Settings and Logs activate the validated opener. A stand-in
  xdg-open records the destinations, all Settings while first-run is incomplete.
- Activating Quit closes the installed app, its observed tray helper process
  exits, and the WebUI port no longer accepts connections.

Once the exact-head matrix passes, this will be protocol and install evidence,
not a screenshot of a real desktop. Until then these checks are planned, not
confirmed. Image tags, Node 22 setup and package installs float for this dev
lab; re-run after dependency changes rather than claim reproducible versions.
The containers do not prove GNOME extension configuration, icon rendering,
Wayland integration or behavior on every release of each distro. They do not
promise compatibility beyond the tested x86_64 releases.

## Real desktop acceptance required

On each intended desktop (KDE, GNOME with indicator support, XFCE):

1. Install through the package manager and confirm dependencies resolve.
2. Launch from the application menu, with no terminal. Fresh Settings opens.
3. Sign in to a media server through the existing WebUI and confirm playback.
4. Confirm the tray icon and menu render correctly. Capture a screenshot.
5. Close the browser. Presence and the WebUI keep running. Settings/Logs reopen
   from the tray; during first-run those commands return to setup instead.
6. Quit from the tray. Confirm app and tray processes exit and the port closes.
7. Launch twice: document any duplicate-instance behavior before release.
8. Toggle start-at-login, sign out/back in, and confirm behavior both on and off.
9. Upgrade the dev package; preserve credentials, configuration and working cards.

A missing indicator host or dependency must produce a clear warning while the
local server keeps running, not silently report a working tray. GNOME typically
needs its AppIndicator extension. Headless installs are not desktop acceptance.
