// Local status page (#253, slice 1). Served on loopback by the running app.
// The page is static; /status.js fetches /api/status (same origin only) and
// fills it in every few seconds. Nothing here can change settings yet.

import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>NowPlaying status</title><link rel="stylesheet" href="/status-ui.css"></head>
<body class="status-ui"><div class="app-shell">
<aside class="sidebar"><a class="app-name" href="/">nowplaying</a><nav aria-label="Main"><span aria-current="page">Status</span><a href="/settings">Settings</a><a href="/logs">Logs</a></nav><p class="sidebar-note">On this device</p></aside>
<main><header class="page-heading"><h1>Status</h1><a class="settings-link" href="/settings">Edit settings</a></header>
<p id="summary" role="status" aria-live="polite">Loading status...</p>
<section class="playing-section" aria-labelledby="h-playing"><h2 id="h-playing">Now playing</h2><p id="playing">-</p><p id="playing-subtitle"></p></section>
<div class="connection-grid"><section aria-labelledby="h-server"><h2 id="h-server">Media server</h2>
<dl><dt>Server</dt><dd id="server-type">-</dd><dt>Address</dt><dd id="server-address">-</dd><dt>Signed in as</dt><dd id="server-user">-</dd><dt>Connection</dt><dd id="server-state">-</dd><dt>Last checked</dt><dd id="server-poll">-</dd></dl>
<div id="servers-block" hidden><h3>All servers</h3><ul id="servers"></ul></div></section>
<section aria-labelledby="h-discord"><h2 id="h-discord">Discord</h2>
<dl><dt>Status</dt><dd id="discord-state">-</dd><dt>Last update</dt><dd id="discord-last">-</dd></dl></section>
<section aria-labelledby="h-hosted"><h2 id="h-hosted">Hosted card upload</h2>
<dl><dt>Status</dt><dd id="hosted-state">-</dd><dt>Last upload</dt><dd id="hosted-last">-</dd></dl></section>
</div><section aria-labelledby="h-card"><h2 id="h-card">Your card</h2>
<div class="card-options"><article><h3>Local card</h3><p class="hint">Only reachable on this device</p>
<p class="card-address"><a id="card-link" href="/card.svg">/card.svg</a></p>
<div class="card-preview"><img id="card" src="/card.svg" alt="Local now playing card" width="480"></div></article>
<article><h3>Hosted card</h3><p class="hint">Public link for your README</p>
<p class="card-address"><a id="hosted-card-link" hidden target="_blank" rel="noreferrer"></a><span id="hosted-card-address">No hosted address yet</span></p>
<div class="card-preview"><img id="hosted-card" hidden referrerpolicy="no-referrer" alt="Hosted now playing card" width="480"><p id="hosted-card-note" role="status">Checking hosted upload...</p></div></article></div></section>
<section aria-labelledby="h-help"><h2 id="h-help">Diagnostics</h2>
<p class="hint">Version and connection details only. No titles, server addresses or sign-in details.</p>
<p><button type="button" id="copy-diagnostics">Copy diagnostics</button> <a href="/api/diagnostics" download="nowplaying-diagnostics.json">Download</a> <span id="copy-result" role="status" aria-live="polite"></span></p>
<details id="diagnostics-details"><summary>See exactly what's in the report</summary><pre id="diagnostics-preview">Loading...</pre></details></section>
<footer><p>Version <span id="version">-</span><span id="build"></span></p></footer>
</main></div><script src="/status.js"></script></body></html>
`;

// State colours are blue (fine) and orange (problem), never red vs green:
// the owner is deuteranopic. The words carry the meaning; colour only helps.
const SETTINGS_CSS = `body{font:15px/1.5 "Segoe UI",system-ui,sans-serif;margin:0;background:#f6f6f8;color:#1b1b1f}
main{max-width:640px;margin:0 auto;padding:24px}
pre{background:#fff;border:1px solid #d0d0d7;padding:8px;overflow:auto;font-size:13px;max-height:320px}
nav{display:flex;gap:16px;margin-bottom:8px}nav a{color:inherit}nav [aria-current]{font-weight:600}
h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:0 0 8px}
section{background:#fff;border:1px solid #ddd;border-radius:8px;padding:16px;margin:16px 0}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0}dt{color:#555}dd{margin:0;overflow-wrap:anywhere}
img{max-width:100%;height:auto}.ok{color:#0b5cad}.bad{color:#b85c00;font-weight:600}.warn{color:#6b5a00}
footer{color:#555;font-size:13px}
button{font:inherit;padding:6px 12px;border:1px solid #888;border-radius:6px;background:#fff;color:inherit;cursor:pointer}
@media (prefers-color-scheme:dark){body{background:#17171a;color:#eee}section{background:#222226;border-color:#333}button{background:#2c2c31;border-color:#555}dt,footer{color:#aaa}.ok{color:#7ab8ff}.bad{color:#ffa552;font-weight:600}.warn{color:#e0d070}}
`;

const CSS = `@font-face{font-family:Inter;src:url('/inter.woff2') format('woff2');font-style:normal;font-weight:100 900;font-display:swap}
.status-ui{--bg:#fff;--sidebar:#f7f7f8;--panel:#fff;--line:#e5e5e8;--ink:#242429;--muted:#74747e;--accent:#7C3AED;--selected:#ede7fb;font:13px/1.5 Inter,system-ui,sans-serif;margin:0;background:var(--bg);color:var(--ink)}
.status-ui *{box-sizing:border-box}.status-ui [hidden]{display:none!important}
.status-ui .app-shell{display:grid;grid-template-columns:184px minmax(0,1fr);min-height:100vh}
.status-ui .sidebar{background:var(--sidebar);border-right:1px solid var(--line);padding:28px 14px;display:flex;flex-direction:column}
.status-ui .app-name{font-weight:700;letter-spacing:-.5px;font-size:18px;text-decoration:none;color:var(--ink);margin:0 12px 30px}
.status-ui nav{display:flex;flex-direction:column;gap:4px}.status-ui nav a,.status-ui nav [aria-current]{padding:8px 12px;border-radius:4px;text-decoration:none;color:var(--muted);font-weight:500}
.status-ui nav [aria-current]{background:var(--selected);color:var(--accent)}.status-ui nav a:hover{background:var(--line);color:var(--ink)}
.status-ui .sidebar-note{font-size:11px;color:var(--muted);margin:auto 12px 0;padding-top:32px}
.status-ui main{width:100%;max-width:1040px;padding:32px 36px 20px;margin:0 auto}
.status-ui .page-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;gap:16px}.status-ui h1{font-size:22px;line-height:1.3;letter-spacing:-.6px;font-weight:650;margin:0}
.status-ui .settings-link{font-size:12px;text-decoration:none;color:var(--muted)}.status-ui .settings-link:hover{color:var(--accent)}
.status-ui #summary{font-size:12px;margin:0 0 26px}.status-ui h2{font-size:13px;font-weight:600;margin:0 0 14px}.status-ui h3{font-size:13px;font-weight:600;margin:0}
.status-ui section{margin:0 0 22px}.status-ui .playing-section{border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:4px;padding:18px 20px;background:var(--panel)}
.status-ui .playing-section h2{color:var(--muted);font-size:11px;margin:0 0 8px;font-weight:500}.status-ui #playing{font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-.5px;margin:0}.status-ui #playing-subtitle{color:var(--muted);font-size:13px;margin:5px 0 0}
.status-ui .connection-grid{display:grid;grid-template-columns:1.45fr 1fr 1fr;gap:12px;margin-bottom:26px}
.status-ui .connection-grid section{border:1px solid var(--line);border-radius:4px;background:var(--panel);padding:16px;margin:0;min-width:0}
.status-ui dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:5px 12px;margin:0;font-size:12px}.status-ui dt{color:var(--muted)}.status-ui dd{margin:0;overflow-wrap:anywhere}
.status-ui .connection-grid section:not(:first-child) dl{display:block}.status-ui .connection-grid section:not(:first-child) dt{margin-top:10px;font-size:11px}.status-ui .connection-grid section:not(:first-child) dd{margin-top:2px}
.status-ui .card-options{display:grid;grid-template-columns:1fr 1fr;gap:16px}.status-ui .card-options article{min-width:0;border:1px solid var(--line);border-radius:4px;padding:16px;background:var(--panel)}
.status-ui .hint{font-size:11px;color:var(--muted);margin:3px 0 0}.status-ui .card-address{font:11px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;margin:14px 0 0;padding:9px 10px;background:var(--sidebar);border:1px solid var(--line);border-radius:3px;overflow-wrap:anywhere;min-height:54px}
.status-ui .card-address a{color:var(--ink);text-decoration:none}.status-ui .card-address a:hover{color:var(--accent);text-decoration:underline}
.status-ui .card-preview{min-height:126px;display:flex;align-items:center;justify-content:center;margin-top:14px}.status-ui .card-preview p{font-size:12px;color:var(--muted);margin:0;max-width:280px}.status-ui img{display:block;max-width:100%;height:auto}
.status-ui .ok{color:#356797}.status-ui .bad{color:#a24f00;font-weight:600}.status-ui .warn{color:#876113}
.status-ui button,.status-ui select{font:inherit;font-size:12px;padding:6px 10px;border:1px solid var(--line);border-radius:4px;background:var(--panel);color:var(--ink);cursor:pointer}.status-ui button:hover{border-color:#aaa}.status-ui :focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.status-ui a{color:var(--accent);text-underline-offset:3px}.status-ui pre{background:var(--sidebar);border:1px solid var(--line);padding:12px;overflow:auto;font-size:12px;max-height:320px}
.status-ui section[aria-labelledby="h-help"]{padding-top:18px;border-top:1px solid var(--line);margin-top:28px}.status-ui #h-help{margin-bottom:4px}.status-ui section[aria-labelledby="h-help"] p:not(.hint){margin:12px 0;font-size:12px}.status-ui details{font-size:11px;color:var(--muted)}.status-ui footer{color:var(--muted);font-size:10px;padding-top:4px}
@media(max-width:940px){.status-ui .connection-grid{grid-template-columns:1fr 1fr}.status-ui .connection-grid section:first-child{grid-column:1/-1}}
@media(max-width:660px){.status-ui .app-shell{display:block}.status-ui .sidebar{padding:16px;border-right:0;border-bottom:1px solid var(--line);flex-direction:row;align-items:center;gap:16px}.status-ui .app-name{font-size:16px;margin:0}.status-ui nav{flex-direction:row;gap:0}.status-ui nav a,.status-ui nav [aria-current]{padding:6px 8px;font-size:12px}.status-ui .sidebar-note{display:none}.status-ui main{padding:24px 18px}.status-ui .card-options{grid-template-columns:1fr}.status-ui #playing{font-size:20px}.status-ui .connection-grid{gap:10px}}
@media(prefers-color-scheme:dark){.status-ui{--bg:#161619;--sidebar:#1c1c20;--panel:#1b1b1f;--line:#303037;--ink:#ececf0;--muted:#9b9ba7;--accent:#a78bfa;--selected:#2d2541}.status-ui .ok{color:#89b4e4}.status-ui .bad{color:#f1ae70}.status-ui .warn{color:#d7bc7b}}
`;

const SCRIPT = `"use strict";
const SERVER_WORDS = { connected: ["Connected", "ok"], starting: ["Checking...", "warn"], unreachable: ["Can't reach the server", "bad"], authentication_failed: ["Sign-in rejected - run setup again", "bad"], error: ["Server returned an error", "bad"], safe_mode: ["Safe mode - server checks are off. Run setup again from the tray", "warn"] };
const HOSTED_WORDS = { off: ["Turned off", ""], connected: ["Uploading", "ok"], idle: ["Starting upload...", "warn"], starting: ["Starting upload...", "warn"], retrying: ["Upload failed - retrying. Check your connection or hosted service", "bad"], unauthorized: ["Sign-in rejected - reconnect in Settings", "bad"], no_credentials: ["Not signed in - connect in Settings", "bad"], disconnect_pending: ["Remote deletion pending - retry in Settings", "bad"], unknown: ["Upload status unavailable", "bad"] };
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
function publicCardUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || !/^\\/(u\\/[A-Za-z0-9-]+|card\\/[A-Za-z0-9_-]+)\\.svg$/.test(u.pathname)) return null;
    return u.href;
  } catch { return null; }
}
function showCards(hosted) {
  const local = document.getElementById("card-link");
  local.textContent = typeof location !== "undefined" ? location.origin + "/card.svg" : "/card.svg";
  const link = document.getElementById("hosted-card-link");
  const image = document.getElementById("hosted-card");
  const address = document.getElementById("hosted-card-address");
  const note = document.getElementById("hosted-card-note");
  const url = hosted?.enabled && hosted.state !== "disconnect_pending" ? publicCardUrl(hosted.cardUrl) : null;
  link.hidden = !url; address.hidden = Boolean(url);
  if (url) { link.href = url; link.textContent = url; }
  const preview = url && url.startsWith("https://nowplaying-hosted.vercel.app/");
  image.hidden = !preview; note.hidden = Boolean(preview);
  if (preview) {
    if (cardTick % 3 === 0 || !image.src || image.src.split("?")[0] !== url) image.src = url + "?t=" + Date.now();
    image.onerror = () => { image.hidden = true; note.hidden = false; note.textContent = "Hosted preview unavailable. Open the address to check it."; };
  } else {
    if (image.removeAttribute) image.removeAttribute("src"); else image.src = "";
    note.textContent = !hosted?.enabled ? "Hosted upload is off. Enable it in Settings to get a public card link." : hosted.state === "disconnect_pending" ? "Remote deletion is pending. Reconnect in Settings once it finishes." : url ? "Open the address to view this card on your own hosted service." : "No hosted card address yet. Connect in Settings and wait for the first upload.";
  }
}
const SERVER_ROW_WORDS = { playing: "playing", paused: "paused", idle: "connected, nothing playing", waiting: "waiting for first check", error: "returned an error", unavailable: "sign-in missing" };
const SERVER_ROW_ERRORS = { unauthorized: "sign-in rejected, run setup again", unreachable: "can't reach it", timeout: "can't reach it", error: "returned an error" };
async function load() {
  try {
    const res = await fetch("/api/status", { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    const s = await res.json();
    const server = SERVER_WORDS[s.server.state] || SERVER_WORDS.error;
    const discord = s.discord.enabled ? (DISCORD_WORDS[s.discord.state] || DISCORD_WORDS.unknown) : DISCORD_WORDS.off;
    const rows = Array.isArray(s.servers) ? s.servers : [];
    const failedServer = rows.length > 1 && rows.some((row) => row.state === "error" || row.state === "unavailable");
    const hosted = s.hosted && s.hosted.enabled ? (HOSTED_WORDS[s.hosted.state] || HOSTED_WORDS.unknown) : HOSTED_WORDS.off;
    const hostedStarting = s.hosted && s.hosted.enabled && ["idle", "starting"].includes(s.hosted.state);
    const hostedHealthy = !s.hosted || !s.hosted.enabled || s.hosted.state === "connected";
    const healthy = !failedServer && s.server.state === "connected" && (!s.discord.enabled || s.discord.state === "ready") && hostedHealthy;
    const starting = !failedServer && (!s.discord.enabled || !["degraded", "failed", "closed"].includes(s.discord.state)) && (s.server.state === "starting" && (hostedHealthy || hostedStarting) || (hostedStarting && s.server.state === "connected"));
    set("summary", healthy ? "Everything is working." : starting ? "Starting up..." : "Something needs attention - see below.", healthy ? "ok" : starting ? "warn" : "bad");
    set("playing", s.playing ? s.playing.title + (s.playing.state === "paused" ? " (paused)" : "") : "Nothing playing");
    set("playing-subtitle", s.playing?.subtitle || "");
    set("server-type", s.server.type);
    set("server-address", s.server.address);
    set("server-user", s.server.user);
    set("server-state", server[0], server[1]);
    set("server-poll", ago(s.server.lastPollAt));
    // Several servers (#252): one line each. Which one Discord shows is still to be decided.
    document.getElementById("servers-block").hidden = rows.length < 2;
    document.getElementById("servers").replaceChildren(...(rows.length < 2 ? [] : rows.map((row) => {
      const li = document.createElement("li");
      const state = row.state === "error" ? (SERVER_ROW_ERRORS[row.reason] || SERVER_ROW_WORDS.error) : (SERVER_ROW_WORDS[row.state] || "unknown");
      li.textContent = [row.type, row.user ? "as " + row.user : null, "- " + state, row.lastPollAt ? "- checked " + ago(row.lastPollAt) : null].filter(Boolean).join(" ");
      return li;
    })));
    set("discord-state", discord[0] + (s.discord.error ? " (" + s.discord.error + ")" : ""), discord[1]);
    set("discord-last", s.discord.enabled ? ago(s.discord.lastPublishedAt) : "-");
    set("hosted-state", hosted[0], hosted[1]);
    set("hosted-last", s.hosted && s.hosted.enabled ? ago(s.hosted.lastSuccessAt) : "-");
    showCards(s.hosted);
    set("version", s.version);
    const b = s.build;
    set("build", b ? " - build " + b.commit + ", " + b.channel + ", " + (b.signed ? "signed" : "unsigned") + ", built " + new Date(b.builtAt).toLocaleString() : "");
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
// Shows the exact report before anyone copies or downloads it (#141).
document.getElementById("diagnostics-details").addEventListener("toggle", async (event) => {
  if (!event.target.open) return;
  const out = document.getElementById("diagnostics-preview");
  try {
    const res = await fetch("/api/diagnostics", { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    out.textContent = JSON.stringify(await res.json(), null, 2);
  } catch {
    out.textContent = "Couldn't load the report. Reload this page and try again.";
  }
});
load();
setInterval(load, 5000);
`;

const SAFE_FETCH_SITES = new Set(["same-origin", "none"]);

// Where the installer and `nowplaying stop` ask a running app to quit (#780).
// The path skips the WebUI session check (it is in openWritePaths); the
// per-install random shutdown secret authenticates instead.
export const SHUTDOWN_PATH = "/api/shutdown";

export function createStatusPageHandler({ status, fallback, shutdown = null } = {}) {
  if (!status || typeof status.snapshot !== "function" || typeof status.refresh !== "function") throw new TypeError("status: expected an app status");
  if (typeof fallback !== "function") throw new TypeError("fallback: expected a handler");
  if (shutdown !== null && (typeof shutdown?.token !== "string" || typeof shutdown?.request !== "function")) throw new TypeError("shutdown: expected { token, request }");
  const assets = {
    "/": { body: PAGE, type: "text/html; charset=utf-8", page: true },
    "/status": { body: PAGE, type: "text/html; charset=utf-8", page: true },
    "/status.css": { body: SETTINGS_CSS, type: "text/css; charset=utf-8" },
    "/inter.woff2": { body: readFileSync(new URL("./assets/InterVariable.woff2", import.meta.url)), type: "font/woff2" },
    "/status-ui.css": { body: CSS, type: "text/css; charset=utf-8" },
    "/status.js": { body: SCRIPT, type: "text/javascript; charset=utf-8" },
  };
  function handleShutdown(request, method) {
    if (shutdown === null) return fallback(request);
    if (method !== "POST") return response(405, "Method Not Allowed", { Allow: "POST" });
    const presented = bearer(request?.headers);
    if (presented === undefined || !tokensEqual(presented, shutdown.token)) return response(401, "Unauthorized");
    // Answer first; the app quits once the reply is out.
    setTimeout(() => {
      void shutdown.request();
    }, 25);
    return response(202, "");
  }
  async function serveApi(pathname, method, request) {
    // Status JSON is for this app's own page: refuse other sites' requests.
    const site = header(request?.headers, "sec-fetch-site");
    if (site !== undefined && !SAFE_FETCH_SITES.has(site)) return response(403, "Forbidden");
    await status.refresh();
    if (pathname === "/api/tray") {
      if (typeof status.tray !== "function") return response(404, "Not Found");
      return response(200, method === "HEAD" ? "" : JSON.stringify(status.tray()), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    }
    if (pathname === "/api/diagnostics") {
      if (typeof status.diagnostics !== "function") return response(404, "Not Found");
      return response(200, method === "HEAD" ? "" : `${JSON.stringify(status.diagnostics(), null, 2)}\n`, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": 'attachment; filename="nowplaying-diagnostics.json"' });
    }
    return response(200, method === "HEAD" ? "" : JSON.stringify(status.snapshot()), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  }
  return async function handle(request) {
    const method = request?.method || "GET";
    const url = new URL(request?.url || "/", "http://localhost");
    if (url.pathname === SHUTDOWN_PATH) return handleShutdown(request, method);
    const asset = assets[url.pathname];
    const api = url.pathname === "/api/status" || url.pathname === "/api/diagnostics" || url.pathname === "/api/tray";
    if (!asset && !api) return fallback(request);
    if (method !== "GET" && method !== "HEAD") return response(405, "Method Not Allowed", { Allow: "GET, HEAD" });
    if (asset) {
      const result = response(200, method === "HEAD" ? "" : asset.body, { "Content-Type": asset.type, "Cache-Control": "no-store" });
      return asset.page ? { ...result, page: true, hostedCardPreview: true } : result;
    }
    return serveApi(url.pathname, method, request);
  };
}

function bearer(headers) {
  const value = header(headers, "authorization");
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return undefined;
  return value.slice("Bearer ".length).trim();
}

function tokensEqual(a, b) {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function header(headers, name) {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((value) => value.toLowerCase() === name);
  return key ? headers[key] : undefined;
}
function response(status, body, headers = {}) { return Object.freeze({ status, headers: Object.freeze(headers), body }); }
