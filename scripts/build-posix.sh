#!/usr/bin/env bash
# Unsigned macOS/Linux dev-build packaging (#215 slice B). Produces a
# self-contained bundle shaped like the Windows one - the Node runtime, the
# app sources with production dependencies, and a `nowplaying` launcher -
# archived with a stable dev name for the rolling dev pre-release. The
# launcher runs the same scripts/nowplaying.js entry a source checkout uses.
set -euo pipefail

os="${1:?usage: build-posix.sh macos|linux}"
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

case "$os" in
  macos) ;;
  linux) ;;
  *) echo "build-posix.sh: unknown OS: $os" >&2; exit 2 ;;
esac
# Normalize uname to the asset-name arch scheme (x64/arm64).
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) echo "build-posix.sh: unsupported arch: $(uname -m)" >&2; exit 2 ;;
esac

bundle="dist/$os/nowplaying"
rm -rf "dist/$os"
mkdir -p "$bundle/runtime" "$bundle/app"

cp "$(command -v node)" "$bundle/runtime/node"
cp -r src scripts package.json "$bundle/app/"
cp -r node_modules "$bundle/app/node_modules"
cp NOTICE README.md LICENSE "$bundle/"

cat > "$bundle/nowplaying" <<'LAUNCH'
#!/bin/sh
# Resolve the bundle from the launcher's own location, so the folder can
# live anywhere on disk.
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$here/runtime/node" "$here/app/scripts/nowplaying.js" "$@"
LAUNCH
chmod +x "$bundle/nowplaying"

# Smoke: the launcher runs, and the app answers on its settings route (the
# bundle always boots first-run on CI, where /healthz does not exist yet).
# A dev asset that cannot boot is worse than no asset.
"$bundle/nowplaying" --version > /dev/null
"$bundle/nowplaying" --help > /dev/null
port=47839
log="$(mktemp)"
NOWPLAYING_PORT=$port "$bundle/nowplaying" start --no-setup > "$log" 2>&1 &
pid=$!
ok=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$port/settings" > /dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
kill "$pid" 2> /dev/null || true
wait "$pid" 2> /dev/null || true
if [ "$ok" != 1 ]; then
  echo "build-posix.sh: smoke failed - the bundle did not answer on :$port" >&2
  cat "$log" >&2
  exit 1
fi

if [ "$os" = macos ]; then
  (cd "dist/$os" && zip -q -r "nowplaying-dev-$os-$arch.zip" nowplaying)
else
  tar -czf "dist/$os/nowplaying-dev-$os-$arch.tar.gz" -C "dist/$os" nowplaying
fi
ls -la "dist/$os"
