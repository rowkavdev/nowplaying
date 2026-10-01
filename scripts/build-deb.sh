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

bundle="${1:?usage: build-deb.sh <bundle-dir> <version> <amd64|arm64> <out-dir>}"
version="${2:?missing version}"
arch="${3:?missing architecture}"
out="${4:?missing output directory}"
maintainer="${NOWPLAYING_DEB_MAINTAINER:-rowkav09 <rowkav09@users.noreply.github.com>}"

case "$arch" in amd64|arm64) ;; *) echo "build-deb.sh: unsupported architecture: $arch" >&2; exit 2 ;; esac
# Debian versions allow [0-9A-Za-z.+~-] and must start with a digit; reject
# anything else before it reaches the control file.
if ! printf '%s' "$version" | grep -Eq '^[0-9][0-9A-Za-z.+~-]*$'; then
  echo "build-deb.sh: invalid version: $version" >&2; exit 2
fi
[ -x "$bundle/nowplaying" ] && [ -x "$bundle/runtime/node" ] || { echo "build-deb.sh: not a built bundle: $bundle" >&2; exit 2; }

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/opt" "$stage/usr/bin" "$stage/DEBIAN" "$out"
cp -a "$bundle" "$stage/opt/nowplaying"
cat > "$stage/usr/bin/nowplaying" <<'WRAP'
#!/bin/sh
exec /opt/nowplaying/nowplaying "$@"
WRAP
chmod 755 "$stage/usr/bin/nowplaying"

size_kb=$(du -sk "$stage/opt" "$stage/usr" | awk '{ sum += $1 } END { print sum }')
cat > "$stage/DEBIAN/control" <<CONTROL
Package: nowplaying
Version: $version
Architecture: $arch
Maintainer: $maintainer
Installed-Size: $size_kb
Depends: libc6
Section: sound
Priority: optional
Homepage: https://github.com/rowkavdev/nowplaying
Description: Show what you are playing on Plex, Jellyfin, Emby or Navidrome
 Turns playback from your media server into a README card or Discord Rich
 Presence. Ships its own Node runtime, so nothing else needs to be installed.
CONTROL

# Root-owned files regardless of who builds, and no stray build-time modes.
file="$out/nowplaying_${version}_${arch}.deb"
fakeroot sh -c "chown -R 0:0 '$stage' && dpkg-deb --root-owner-group -Zxz --build '$stage' '$file' >/dev/null"
echo "$file"
