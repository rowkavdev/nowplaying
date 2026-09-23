// Local status page (#253, slice 1). Served on loopback by the running app.
// The page is static; /status.js fetches /api/status (same origin only) and
// fills it in every few seconds. Nothing here can change settings yet.

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>NowPlaying status</title><link rel="stylesheet" href="/status.css"></head>
<body><main>
<h1>NowPlaying</h1>
<p id="summary" role="status" aria-live="polite">Loading status...</p>
<section aria-labelledby="h-playing"><h2 id="h-playing">Now playing</h2><p id="playing">-</p></section>
<section aria-labelledby="h-server"><h2 id="h-server">Media server</h2>
<dl><dt>Server</dt><dd id="server-type">-</dd><dt>Address</dt><dd id="server-address">-</dd><dt>Signed in as</dt><dd id="server-user">-</dd><dt>Connection</dt><dd id="server-state">-</dd><dt>Last checked</dt><dd id="server-poll">-</dd></dl></section>
<section aria-labelledby="h-discord"><h2 id="h-discord">Discord</h2>
<dl><dt>Status</dt><dd id="discord-state">-</dd><dt>Last update</dt><dd id="discord-last">-</dd></dl></section>
<section aria-labelledby="h-card"><h2 id="h-card">Your card</h2>
<p>Card address: <a id="card-link" href="/card.svg">/card.svg</a></p>
<p><img id="card" src="/card.svg" alt="Your now playing card" width="480"></p></section>
<section aria-labelledby="h-help"><h2 id="h-help">Reporting a problem</h2>
<p>Copies a short report with your version, server type and connection state. It leaves out your server address, user name, what you're playing and any sign-in details.</p>
<p><button type="button" id="copy-diagnostics">Copy diagnostics</button> <a href="/api/diagnostics" download="nowplaying-diagnostics.json">Download</a> <span id="copy-result" role="status" aria-live="polite"></span></p></section>
<footer><p>Version <span id="version">-</span></p></footer>
</main><script src="/status.js"></script></body></html>
`;

// State colours are blue (fine) and orange (problem), never red vs green:
// the owner is deuteranopic. The words carry the meaning; colour only helps.
const CSS = `body{font:15px/1.5 "Segoe UI",system-ui,sans-serif;margin:0;background:#f6f6f8;color:#1b1b1f}
main{max-width:640px;margin:0 auto;padding:24px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:0 0 8px}
section{background:#fff;border:1px solid #ddd;border-radius:8px;padding:16px;margin:16px 0}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0}dt{color:#555}dd{margin:0;overflow-wrap:anywhere}
img{max-width:100%;height:auto}.ok{color:#0b5cad}.bad{color:#b85c00;font-weight:600}.warn{color:#6b5a00}
footer{color:#555;font-size:13px}
button{font:inherit;padding:6px 12px;border:1px solid #888;border-radius:6px;background:#fff;color:inherit;cursor:pointer}
@media (prefers-color-scheme:dark){body{background:#17171a;color:#eee}section{background:#222226;border-color:#333}button{background:#2c2c31;border-color:#555}dt,footer{color:#aaa}.ok{color:#7ab8ff}.bad{color:#ffa552;font-weight:600}.warn{color:#e0d070}}
`;

const SCRIPT = `"use strict";
const SERVER_WORDS = { connected: ["Connected", "ok"], starting: ["Checking...", "warn"], unreachable: ["Can't reach the server", "bad"], authentication_failed: ["Sign-in rejected - run setup again", "bad"], error: ["Server returned an error", "bad"] };
const DISCORD_WORDS = { ready: ["Connected", "ok"], disconnected: ["Waiting for Discord to open", "warn"], degraded: ["Having trouble reaching Discord", "warn"], closed: ["Stopped", "warn"], off: ["Turned off", ""], no_app_id: ["Not set up", "warn"], failed: ["Couldn't start", "bad"], unknown: ["Unknown", "warn"] };
function set(id, value, tone) { const el = document.getElementById(id); el.textContent = value ?? "-"; el.className = tone || ""; }
function ago(iso) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 5) return "just now";
  if (s < 90) return s + " seconds ago";
  const m = Math.round(s / 60);
  return m < 90 ? m + " minutes ago" : Math.round(m / 60) + " hours ago";
}
let cardTick = 0;
async function load() {
  try {
    const res = await fetch("/api/status", { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    const s = await res.json();
    const server = SERVER_WORDS[s.server.state] || SERVER_WORDS.error;
    const discord = s.discord.enabled ? (DISCORD_WORDS[s.discord.state] || DISCORD_WORDS.unknown) : DISCORD_WORDS.off;
    const healthy = s.server.state === "connected" && (!s.discord.enabled || s.discord.state === "ready");
    set("summary", healthy ? "Everything is working." : s.server.state === "starting" ? "Starting up..." : "Something needs attention - see below.", healthy ? "ok" : s.server.state === "starting" ? "warn" : "bad");
    set("playing", s.playing ? [s.playing.title, s.playing.subtitle].filter(Boolean).join(" - ") + (s.playing.state === "paused" ? " (paused)" : "") : "Nothing playing");
    set("server-type", s.server.type);
    set("server-address", s.server.address);
    set("server-user", s.server.user);
    set("server-state", server[0], server[1]);
    set("server-poll", ago(s.server.lastPollAt));
    set("discord-state", discord[0] + (s.discord.error ? " (" + s.discord.error + ")" : ""), discord[1]);
    set("discord-last", s.discord.enabled ? ago(s.discord.lastPublishedAt) : "-");
    set("version", s.version);
    if (++cardTick % 3 === 0) document.getElementById("card").src = "/card.svg?t=" + Date.now();
  } catch {
    set("summary", "Can't reach NowPlaying. It may have been closed.", "bad");
  }
}
document.getElementById("copy-diagnostics").addEventListener("click", async () => {
  try {
    const res = await fetch("/api/diagnostics", { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    await navigator.clipboard.writeText(JSON.stringify(await res.json(), null, 2));
    set("copy-result", "Copied. Paste it into your bug report.", "ok");
  } catch {
    set("copy-result", "Couldn't copy. Use Download instead.", "bad");
  }
});
load();
setInterval(load, 5000);
`;

const SAFE_FETCH_SITES = new Set(["same-origin", "none"]);

export function createStatusPageHandler({ status, fallback } = {}) {
  if (!status || typeof status.snapshot !== "function" || typeof status.refresh !== "function") throw new TypeError("status: expected an app status");
  if (typeof fallback !== "function") throw new TypeError("fallback: expected a handler");
  const assets = {
    "/": { body: PAGE, type: "text/html; charset=utf-8", page: true },
    "/status": { body: PAGE, type: "text/html; charset=utf-8", page: true },
    "/status.css": { body: CSS, type: "text/css; charset=utf-8" },
    "/status.js": { body: SCRIPT, type: "text/javascript; charset=utf-8" },
  };
  return async function handle(request) {
    const method = request?.method || "GET";
    const url = new URL(request?.url || "/", "http://localhost");
    const asset = assets[url.pathname];
    const api = url.pathname === "/api/status" || url.pathname === "/api/diagnostics";
    if (!asset && !api) return fallback(request);
    if (method !== "GET" && method !== "HEAD") return response(405, "Method Not Allowed", { Allow: "GET, HEAD" });
    if (asset) {
      const result = response(200, method === "HEAD" ? "" : asset.body, { "Content-Type": asset.type, "Cache-Control": "no-store" });
      return asset.page ? { ...result, page: true } : result;
    }
    // Status JSON is for this app's own page: refuse other sites' requests.
    const site = header(request?.headers, "sec-fetch-site");
    if (site !== undefined && !SAFE_FETCH_SITES.has(site)) return response(403, "Forbidden");
    await status.refresh();
    if (url.pathname === "/api/diagnostics") {
      if (typeof status.diagnostics !== "function") return response(404, "Not Found");
      return response(200, method === "HEAD" ? "" : `${JSON.stringify(status.diagnostics(), null, 2)}\n`, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": 'attachment; filename="nowplaying-diagnostics.json"' });
    }
    return response(200, method === "HEAD" ? "" : JSON.stringify(status.snapshot()), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  };
}

function header(headers, name) {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((value) => value.toLowerCase() === name);
  return key ? headers[key] : undefined;
}
function response(status, body, headers = {}) { return Object.freeze({ status, headers: Object.freeze(headers), body }); }
