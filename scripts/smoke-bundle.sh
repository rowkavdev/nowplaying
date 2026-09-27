#!/usr/bin/env bash
# Smoke-check a built bundle: the launcher must run, and the app must
# answer on its settings route AS THE BUNDLE'S OWN CHILD PROCESS.
#
# Why the ceremony: a hardcoded probe port can already be serving - a
# stray nowplaying (or anything else) would make a dead bundle look
# healthy. So the probe port is freshly assigned by the OS, and after a
# successful answer the listener on that port must be the child we
# spawned (the launcher execs node, so the child PID is the server PID).
set -euo pipefail

bundle="${1:?usage: smoke-bundle.sh <bundle-dir>}"

if ! command -v lsof > /dev/null 2>&1; then
  echo "smoke-bundle.sh: lsof is required to verify the answering process" >&2
  exit 2
fi

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
    if [ "$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null)" = "$pid" ]; then
      ok=1
    fi
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
