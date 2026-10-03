#!/usr/bin/env bash
# Runs as root inside a disposable distro container. Package builders and app
# run unprivileged. Synthetic StatusNotifier host tests protocol, not pixels.
set -euo pipefail
case "${DISTRO:?}" in
  debian)
    apt-get update
    apt-get install -y --no-install-recommends fakeroot dpkg-dev curl dbus-x11 xvfb xauth python3-gi gir1.2-gtk-3.0 gir1.2-ayatanaappindicator3-0.1 libsecret-tools gnome-keyring xdg-utils
    format=deb ;;
  fedora)
    dnf install -y rpm-build curl dbus-x11 xorg-x11-server-Xvfb xorg-x11-xauth python3-gobject gtk3 libayatana-appindicator-gtk3 libsecret gnome-keyring xdg-utils
    format=rpm ;;
  arch)
    pacman -Syu --noconfirm --needed base-devel curl dbus xorg-server-xvfb xorg-xauth python-gobject gtk3 libayatana-appindicator libsecret gnome-keyring xdg-utils
    format=arch ;;
  *) exit 2 ;;
esac
useradd -m builder
cp -a /source /home/builder/source
chown -R builder:builder /home/builder/source
runuser -u builder -- bash /home/builder/source/scripts/build-linux-native.sh "$format" /home/builder/source/dist/linux/nowplaying 0.2.1+dev /home/builder/packages
case "$format" in
  deb) apt-get install -y /home/builder/packages/*.deb ;;
  rpm) dnf install -y /home/builder/packages/*.rpm ;;
  arch) pacman -U --noconfirm /home/builder/packages/*.pkg.tar.zst ;;
esac
/usr/bin/nowplaying --version
# appPaths/first-run and real GTK helper run in a private user session.
runuser -u builder -- xvfb-run -a dbus-run-session -- python3 /home/builder/source/scripts/linux-desktop-smoke.py
