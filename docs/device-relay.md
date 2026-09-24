# GhostDeps device-code relay

Lets headless automation lanes (GhostDeps build lanes, this repo's hosted lane)
complete GitHub's OAuth device flow without Rowan hand-typing codes. A lane
mints a device code, pushes it to the relay, and Rowan's Tampermonkey script
auto-fills github.com/login/device, verifies the OAuth app is **GitHub CLI**,
and clicks authorize.

## Threat model

The relay key is the only line of defense: anyone who can push codes can get a
token approved onto Rowan's account (device-flow client IDs are public, so the
app-name check alone is not sufficient). The key therefore lives only in the
vault and in the `DEVICE_RELAY_KEY` env var. It never travels through chat or
git. The Tampermonkey script stores it via `GM_setValue` on first run.

- Pushes are capped at 10 pending entries; codes expire after 15 minutes.
- The script auto-approves only when the authorize page says "GitHub CLI" and
  any code echoed on the page matches the relayed code; otherwise it aborts
  with a banner and desktop notification and takes no action.
- The userscript and push page are public but contain no secrets.

## Setup (one-time)

1. Vercel project settings -> Environment Variables -> add `DEVICE_RELAY_KEY`
   (value from the vault entry "ghostdeps-device-relay") for Production, then
   redeploy.
2. Open `https://<host>/ghostdeps-device-relay.user.js` in a browser with
   Tampermonkey installed and confirm the install.
3. Tampermonkey menu on any github.com page -> "Set GhostDeps relay key" ->
   paste the key from the vault.

## Lane usage

`POST /api/device-relay` with `Authorization: Bearer <key>` and JSON
`{code, lane, scopes, repo}` -> `{id}`. Lanes get the key onto the request via
the push page (`/api/device-relay?push=1`) in the cloud browser with vault
fill, never via chat. The script polls `?pending=1` and consumes with
`?consume=1` after approval.
