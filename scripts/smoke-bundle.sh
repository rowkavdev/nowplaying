#!/usr/bin/env bash
# Smoke-check a built bundle: the launcher must run, the app must answer on
# its settings route AS THE BUNDLE'S OWN CHILD PROCESS, and the Info modal
# routes must serve the packaged project files.
#
# Why the ceremony: a hardcoded probe port can already be serving - a
# stray nowplaying (or anything else) would make a dead bundle look
# healthy. So the probe port is freshly assigned by the OS, and after a
# successful answer the listener on that port must be the child we
# spawned (the launcher execs node, so the child PID is the server PID).
set -euo pipefail

bundle="${1:?usage: smoke-bundle.sh <bundle-dir>}"

# The answering process must be the child we spawned. Preferred check is
# lsof; on Linux without it, match the LISTEN socket inode from
# /proc/net/tcp(6) against the child's /proc/<pid>/fd (#683).
listener_is_child() {
  if command -v lsof > /dev/null 2>&1; then
    [ "$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null)" = "$pid" ]
    return
  fi
  if [ -r /proc/net/tcp ]; then
    local hexport
    hexport=$(printf '%04X' "$port")
    local inode
    for inode in $(awk -v port=":$hexport" '$4 == "0A" && substr($2, length($2) - 4) == port { print $10 }' /proc/net/tcp /proc/net/tcp6 2>/dev/null); do
      if ls -l "/proc/$pid/fd" 2>/dev/null | grep -q "socket:\[$inode\]"; then
        return 0
      fi
    done
    return 1
  fi
  echo "smoke-bundle.sh: need lsof or /proc to verify the answering process" >&2
  exit 2
}

"$bundle/nowplaying" --version > /dev/null
"$bundle/nowplaying" --help > /dev/null

# Fresh ephemeral port: bind :0, read the assigned port, release it. If
# something races us onto the port, the listener-PID check below fails
# the smoke rather than accepting a stranger's answer.
port="$("$bundle/runtime/node" -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close();});')"

log="$(mktemp)"
NOWPLAYING_PORT=$port "$bundle/nowplaying" start --no-setup > "$log" 2>&1 &
pid=$!

ok=0
for _ in $(seq 1 30); do
  kill -0 "$pid" 2>/dev/null || break
  if curl -fsS "http://127.0.0.1:$port/settings" > /dev/null 2>&1; then
    listener_is_child && ok=1
    break
  fi
  sleep 1
done
kill "$pid" 2>/dev/null || true
wait "$pid" 2>/dev/null || true
if [ "$ok" != 1 ]; then
  echo "smoke-bundle.sh: the bundle did not answer on :$port as its own process" >&2
  cat "$log" >&2
  rm -f "$log"
  exit 1
fi
rm -f "$log"

# Packaged-layout check (#673 review): the Info modal handler reads
# ../NOTICE, ../README.md and ../LICENSE relative to app/src, so the files
# must ship next to the app sources or every /api/info/* answers 503. A
# full configured boot is fatal headless (the OS keychain read fails), so
# exercise the bundle's own route handler in-process instead.
bundle_abs="$(cd "$bundle" && pwd)"
"$bundle_abs/runtime/node" --input-type=module -e "
import { createSettingsPageHandler } from 'file://$bundle_abs/app/src/settings-page-handler.js';
const handler = createSettingsPageHandler({
  settings: { read: async () => ({}), updateDiscord: async () => {} },
  fallback: () => ({ status: 404, headers: {}, body: 'Not Found' }),
});
for (const name of ['NOTICE', 'README.md', 'LICENSE']) {
  const res = await handler({ method: 'GET', url: '/api/info/' + name, headers: {} });
  if (res?.status !== 200) {
    console.error('smoke-bundle.sh: /api/info/' + name + ' answered ' + (res?.status ?? 'nothing'));
    process.exit(1);
  }
}
"
