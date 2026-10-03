#!/usr/bin/env bash
# Shared filesystem layout for .deb, .rpm and Arch packages.
# Input is trusted, immutable build output from our own CI. Link validation
# rejects accidental escapes; it is not race-safe against concurrent edits.
set -euo pipefail
[[ "$(uname -s)" = Linux ]] || { echo "Linux only: native Linux packaging" >&2; exit 2; }
bundle="${1:?bundle directory required}"
stage="${2:?staging directory required}"
[[ -x "$bundle/nowplaying" && -x "$bundle/runtime/node" ]] || { echo 'Not a built bundle' >&2; exit 2; }
[[ -f "$bundle/app/assets/brand/png/icon-512.png" ]] || { echo 'Bundle branding missing' >&2; exit 2; }
mkdir -p "$stage/opt" "$stage/usr/bin" "$stage/usr/share/applications" "$stage/usr/share/icons/hicolor/512x512/apps"
# npm dependencies may contain symlinks. Resolve each before copying, and
# reject absolute/relative links that escape the built bundle. Then flatten
# links in the staged copy so permission normalization cannot touch outside.
bundle="$(cd "$bundle" && pwd)"
while IFS= read -r -d '' link; do
  target="$(realpath -e "$link")" || { echo 'Broken bundle symlink' >&2; exit 2; }
  [[ "$target" = "$bundle/"* ]] || { echo 'Bundle symlink escapes package' >&2; exit 2; }
done < <(find "$bundle" -type l -print0)
cp -aL "$bundle" "$stage/opt/nowplaying"
cat > "$stage/usr/bin/nowplaying" <<'WRAP'
#!/bin/sh
exec /opt/nowplaying/nowplaying "$@"
WRAP
chmod 755 "$stage/usr/bin/nowplaying"
cat > "$stage/usr/share/applications/nowplaying.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Version=1.0
Name=NowPlaying
Comment=Media presence and README cards
Exec=/usr/bin/nowplaying start
Icon=nowplaying
Terminal=false
Categories=AudioVideo;Audio;
DESKTOP
cp "$bundle/app/assets/brand/png/icon-512.png" "$stage/usr/share/icons/hicolor/512x512/apps/nowplaying.png"
find "$stage/opt" "$stage/usr" -type d -exec chmod 755 {} +
find "$stage/opt" "$stage/usr" -type f -exec chmod 644 {} +
chmod 755 "$stage/usr/bin/nowplaying" "$stage/opt/nowplaying/nowplaying" "$stage/opt/nowplaying/runtime/node"
