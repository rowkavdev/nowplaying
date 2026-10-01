#!/usr/bin/env bash
# Builds an .rpm from the Linux bundle that scripts/build-posix.sh produces
# (#779, second slice, after build-deb.sh: the package itself, not the release
# wiring or a dnf repository). Same layout as the .deb: the bundle under
# /opt/nowplaying and a small /usr/bin/nowplaying wrapper, because the bundle
# launcher finds its files relative to its own path and would break behind a
# symlink.
#
# usage: build-rpm.sh <bundle-dir> <version> <amd64|arm64> <out-dir>
# Needs rpmbuild. Runs as any user; the package records root ownership.
# The packager comes from NOWPLAYING_RPM_PACKAGER.
set -euo pipefail

bundle="${1:?usage: build-rpm.sh <bundle-dir> <version> <amd64|arm64> <out-dir>}"
version="${2:?missing version}"
arch="${3:?missing architecture}"
out="${4:?missing output directory}"
packager="${NOWPLAYING_RPM_PACKAGER:-rowkav09 <rowkav09@users.noreply.github.com>}"

case "$arch" in
  amd64) rpm_arch=x86_64 ;;
  arm64) rpm_arch=aarch64 ;;
  *) echo "build-rpm.sh: unsupported architecture: $arch" >&2; exit 2 ;;
esac
# Same whole-string check as build-deb.sh (a case pattern, not grep, so a
# newline can't smuggle a second spec line in).
case "$version" in
  ''|[!0-9]*|*[!0-9A-Za-z.+~-]*) echo "build-rpm.sh: invalid version" >&2; exit 2 ;;
esac
[ -x "$bundle/nowplaying" ] && [ -x "$bundle/runtime/node" ] || { echo "build-rpm.sh: not a built bundle: $bundle" >&2; exit 2; }
command -v rpmbuild >/dev/null || { echo "build-rpm.sh: rpmbuild is not installed" >&2; exit 2; }

# RPM versions can't contain "-": 0.3.0-beta.1 becomes 0.3.0~beta.1, which
# also sorts before 0.3.0 like a prerelease should.
rpm_version="${version//-/\~}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
stage="$work/stage"
mkdir -p "$stage/opt" "$stage/usr/bin" "$work/rpmbuild" "$out"
chmod 755 "$stage" "$stage/opt" "$stage/usr" "$stage/usr/bin"
cp -a "$bundle" "$stage/opt/nowplaying"
cat > "$stage/usr/bin/nowplaying" <<'WRAP'
#!/bin/sh
exec /opt/nowplaying/nowplaying "$@"
WRAP
chmod 755 "$stage/usr/bin/nowplaying"

cat > "$work/nowplaying.spec" <<SPEC
Name: nowplaying
Version: $rpm_version
Release: 1
Summary: Show what you are playing on Plex, Jellyfin, Emby or Navidrome
License: MIT
URL: https://github.com/rowkavdev/nowplaying
Packager: $packager
# The bundle ships its own Node runtime, so nothing is detected or stripped.
# These are the system libraries that Node links.
AutoReqProv: no
Requires: glibc, libstdc++, libgcc

%description
Turns playback from your media server into a README card or Discord Rich
Presence. Ships its own Node runtime, so nothing else needs to be installed.

%prep
%build
%install
mkdir -p %{buildroot}
cp -a "$stage"/. %{buildroot}/

%files
%defattr(-,root,root,-)
/opt/nowplaying
/usr/bin/nowplaying

%global debug_package %{nil}
%global __os_install_post %{nil}
SPEC

rpmbuild -bb --quiet --target "$rpm_arch" \
  --define "_topdir $work/rpmbuild" --define "_rpmdir $out" --define "_build_id_links none" \
  "$work/nowplaying.spec" >&2
file="$out/$rpm_arch/nowplaying-$rpm_version-1.$rpm_arch.rpm"
[ -f "$file" ] || { echo "build-rpm.sh: expected $file was not produced" >&2; exit 1; }
echo "$file"
