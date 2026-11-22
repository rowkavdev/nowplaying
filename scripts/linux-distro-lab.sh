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
scripts=/home/builder/source/scripts
bundle=/home/builder/source/dist/linux/nowplaying
base_version=$("$bundle/nowplaying" --version)
package_version="${PACKAGE_VERSION:-$base_version+dev.10000000.1.0000000}"

build_and_install() {
  local version=$1 output=$2 installed expected
  runuser -u builder -- bash "$scripts/build-linux-native.sh" "$format" "$bundle" "$version" "$output"
  case "$format" in
    deb)
      apt-get install -y "$output"/*.deb
      installed=$(dpkg-query -W -f='${Version}' nowplaying)
      expected=$version ;;
    rpm)
      dnf install -y "$output"/*.rpm
      installed=$(rpm -q --queryformat '%{VERSION}-%{RELEASE}' nowplaying)
      expected="${version//-/_}-1" ;;
    arch)
      pacman -U --noconfirm "$output"/*.pkg.tar.zst
      installed=$(pacman -Q nowplaying)
      expected="nowplaying ${version//-/_}-1" ;;
  esac
  if [[ "$installed" != "$expected" ]]; then
    echo "Expected installed package $expected, found $installed" >&2
    return 1
  fi
}

if [[ "${1:-}" == --verify-lifecycle ]]; then
  # A numeric legacy SHA sorts last among the old versions on all three distros.
  build_and_install "$base_version+dev.9999999" /home/builder/previous-package
  config=/home/builder/.config/nowplaying/config.json
  runuser -u builder -- bash -c 'umask 077; mkdir -p "$(dirname "$1")"; printf "%s\n" "{}" > "$1"' bash "$config"
  config_checksum=$(sha256sum "$config")
fi

build_and_install "$package_version" /home/builder/packages
cmp "$bundle/app/build-info.json" /opt/nowplaying/app/build-info.json
/usr/bin/nowplaying --version
# appPaths/first-run and real GTK helper run in a private user session.
runuser -u builder -- env XDG_CONFIG_HOME=/home/builder/smoke-config xvfb-run -a dbus-run-session -- python3 "$scripts/linux-desktop-smoke.py"

if [[ "${1:-}" == --verify-lifecycle ]]; then
  [[ "$(sha256sum "$config")" == "$config_checksum" ]]
  case "$format" in
    deb) apt-get remove -y nowplaying ;;
    rpm) dnf remove -y nowplaying ;;
    arch) pacman -R --noconfirm nowplaying ;;
  esac
  [[ ! -e /usr/bin/nowplaying && ! -e /opt/nowplaying && ! -e /usr/share/applications/nowplaying.desktop ]]
  [[ "$(sha256sum "$config")" == "$config_checksum" ]]
  echo "PASS: package installed, upgraded and removed with user config preserved"
fi

# Export only after package installation and desktop protocol acceptance pass.
if [[ -d /artifacts ]]; then
  find /home/builder/packages -maxdepth 1 -type f \( -name '*.deb' -o -name '*.rpm' -o -name '*.pkg.tar.zst' \) -exec cp {} /artifacts/ \;
  find /artifacts -maxdepth 1 -type f -exec chmod 644 {} +
fi
