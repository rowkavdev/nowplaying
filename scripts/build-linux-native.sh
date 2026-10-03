#!/usr/bin/env bash
# Build only. Installing/releasing is an explicit next step. Source app version
# is normalised for package managers; a dev package must use a dev version.
set -euo pipefail
[[ "$(uname -s)" = Linux ]] || { echo "Linux only: native Linux packaging" >&2; exit 2; }
kind="${1:?deb|rpm|arch required}"
case "$kind" in
  deb|rpm|arch) ;;
  *) echo 'Unknown package format' >&2; exit 2 ;;
esac
bundle="$(cd "${2:?bundle directory required}" && pwd)"
version="${3:?package version required}"
out="${4:?output directory required}"
[[ "$version" =~ ^[0-9][0-9A-Za-z.+-]*$ ]] || { echo 'Invalid package version' >&2; exit 2; }
# This desktop slice ships only x86_64, matching the current dev artifact.
[[ "$(uname -m)" = x86_64 ]] || { echo 'Native desktop packages currently require x86_64' >&2; exit 2; }
[[ "$("$bundle/runtime/node" -p 'process.arch')" = x64 ]] || { echo 'Bundle architecture must be x64' >&2; exit 2; }
mkdir -p "$out"; out="$(cd "$out" && pwd)"
root="$(cd "$(dirname "$0")/.." && pwd)"
case "$kind" in
  deb) exec bash "$root/scripts/build-deb.sh" "$bundle" "$version" amd64 "$out" ;;
  rpm|arch) ;;
esac
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
bash "$root/scripts/stage-linux-package.sh" "$bundle" "$stage/payload"
if [[ "$kind" = rpm ]]; then
  mkdir -p "$stage/rpm/"{BUILD,BUILDROOT,RPMS,SOURCES,SPECS,SRPMS}
  tar -czf "$stage/rpm/SOURCES/payload.tar.gz" -C "$stage/payload" .
  cat > "$stage/rpm/SPECS/nowplaying.spec" <<SPEC
Name: nowplaying
Version: ${version//-/_}
Release: 1
Summary: Media presence and README cards
License: AGPL-3.0-only
URL: https://github.com/rowkavdev/nowplaying
Source0: payload.tar.gz
BuildArch: x86_64
AutoReqProv: no
Requires: glibc, libstdc++, libgcc, python3-gobject, gtk3, libayatana-appindicator-gtk3, libsecret, gnome-keyring, xdg-utils
%description
NowPlaying desktop app with a local web UI and system tray.
%prep
%setup -q -c -T
%build
%install
mkdir -p %{buildroot}
tar -xzf %{SOURCE0} -C %{buildroot}
%files
/opt/nowplaying
/usr/bin/nowplaying
/usr/share/applications/nowplaying.desktop
/usr/share/icons/hicolor/512x512/apps/nowplaying.png
SPEC
  rpmbuild --define "_topdir $stage/rpm" -bb "$stage/rpm/SPECS/nowplaying.spec"
  find "$stage/rpm/RPMS" -name '*.rpm' -exec cp {} "$out/" \;
else
  # makepkg cannot run as root. Caller must be an unprivileged builder.
  cat > "$stage/PKGBUILD" <<PKG
pkgname=nowplaying
pkgver=${version//-/_}
pkgrel=1
pkgdesc='Media presence and README cards'
arch=('x86_64')
url='https://github.com/rowkavdev/nowplaying'
license=('AGPL-3.0-only')
depends=('glibc' 'gcc-libs' 'python-gobject' 'gtk3' 'libayatana-appindicator' 'libsecret' 'gnome-keyring' 'xdg-utils')
options=('!strip' '!debug')
package() {
  cp -a "\$startdir/payload/." "\$pkgdir/"
}
PKG
  (cd "$stage" && makepkg --nodeps --noconfirm)
  find "$stage" -maxdepth 1 -name '*.pkg.tar.zst' -exec cp {} "$out/" \;
fi
