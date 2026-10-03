#!/usr/bin/env bash
# Builds a .deb from the Linux bundle that scripts/build-posix.sh produces
# (#779, first slice: the package itself, not the release wiring or an apt
# repository). The bundle goes under /opt/nowplaying and /usr/bin/nowplaying
# is a small wrapper, because the bundle launcher finds its files relative to
# its own path and would break behind a symlink.
#
# usage: build-deb.sh <bundle-dir> <version> <amd64|arm64> <out-dir>
# The Maintainer field comes from NOWPLAYING_DEB_MAINTAINER.
set -euo pipefail
[[ "$(uname -s)" = Linux ]] || { echo "Linux only: native Linux packaging" >&2; exit 2; }

bundle="${1:?usage: build-deb.sh <bundle-dir> <version> <amd64|arm64> <out-dir>}"
version="${2:?missing version}"
arch="${3:?missing architecture}"
out="${4:?missing output directory}"
maintainer="${NOWPLAYING_DEB_MAINTAINER:-rowkav09 <rowkav09@users.noreply.github.com>}"

case "$arch" in amd64|arm64) ;; *) echo "build-deb.sh: unsupported architecture: $arch" >&2; exit 2 ;; esac
# Debian versions allow [0-9A-Za-z.+~-] and must start with a digit. A case
# pattern checks the whole string, newlines included (grep checks per line, so
# "0.2.0<newline>Package: x" would pass it); reject before it reaches the
# control file.
case "$version" in
  ''|[!0-9]*|*[!0-9A-Za-z.+~-]*) echo "build-deb.sh: invalid version" >&2; exit 2 ;;
esac
[ -x "$bundle/nowplaying" ] && [ -x "$bundle/runtime/node" ] || { echo "build-deb.sh: not a built bundle: $bundle" >&2; exit 2; }

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/DEBIAN" "$out"
chmod 755 "$stage"
bash "$(dirname "$0")/stage-linux-package.sh" "$bundle" "$stage"

size_kb=$(du -sk "$stage/opt" "$stage/usr" | awk '{ sum += $1 } END { print sum }')
cat > "$stage/DEBIAN/control" <<CONTROL
Package: nowplaying
Version: $version
Architecture: $arch
Maintainer: $maintainer
Installed-Size: $size_kb
Depends: libc6, libstdc++6, libgcc-s1, python3-gi, gir1.2-gtk-3.0, gir1.2-ayatanaappindicator3-0.1, libsecret-tools, gnome-keyring, xdg-utils
Section: sound
Priority: optional
Homepage: https://github.com/rowkavdev/nowplaying
Description: Show what you are playing on Plex, Jellyfin, Emby or Navidrome
 Turns playback from your media server into a README card or Discord Rich
 Presence. Ships its own Node runtime; desktop dependencies are installed by apt.
CONTROL

# Root-owned files regardless of who builds, and no stray build-time modes.
file="$out/nowplaying_${version}_${arch}.deb"
fakeroot dpkg-deb --root-owner-group -Zxz --build "$stage" "$file" >/dev/null
echo "$file"
