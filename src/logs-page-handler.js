// Local Logs page (#253). Shows the newest app log events and refreshes every
// few seconds. The log only holds time, level, component, status and a short
// code, never server addresses, names, titles or sign-in details.

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>NowPlaying logs</title><link rel="stylesheet" href="/status.css"><link rel="stylesheet" href="/logs.css"></head>
<body><main>
<nav><a href="/">Status</a> <a href="/settings">Settings</a> <span aria-current="page">Logs</span></nav>
<h1>Logs</h1>
<section aria-labelledby="h-log"><h2 id="h-log">Recent events</h2>
<p class="row"><label for="level">Show</label>
<select id="level"><option value="info">Everything</option><option value="warn">Warnings and errors</option><option value="error">Errors only</option></select>
<button type="button" id="copy-log">Copy</button> <span id="log-result" role="status" aria-live="polite"></span></p>
<p id="log-empty" hidden>Nothing logged yet.</p>
<table id="log"><thead><tr><th scope="col">Time</th><th scope="col">Level</th><th scope="col">Part</th><th scope="col">Event</th></tr></thead><tbody></tbody></table>
<p class="hint">The log never includes your server address, user name, what you're playing or sign-in details. Use Copy diagnostics on the Status page for bug reports.</p>
</section>
</main><script src="/logs.js"></script></body></html>
`;

const CSS = `.row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:0 0 12px}.row label{color:#555}
select{font:inherit;padding:4px 8px;border:1px solid #888;border-radius:6px;background:#fff;color:inherit}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:4px 8px;border-bottom:1px solid #e4e4e8;vertical-align:top}
th{color:#555;font-weight:600}td:first-child{white-space:nowrap;font-variant-numeric:tabular-nums}
.hint{color:#555;font-size:13px;margin:12px 0 0}
@media (prefers-color-scheme:dark){select{background:#2c2c31;border-color:#555}th,.row label,.hint{color:#aaa}th,td{border-color:#333}}
`;

const SCRIPT = `"use strict";
const RANK = { info: 0, warn: 1, error: 2 };
const LEVEL_WORDS = { info: ["Info", ""], warn: ["Warning", "warn"], error: ["Error", "bad"] };
const PARTS = { startup: "App", provider: "Media server", discord: "Discord", updater: "Updates", tray: "Tray" };
const level = document.getElementById("level");
const body = document.querySelector("#log tbody");
let events = [];
function say(text, tone) { const el = document.getElementById("log-result"); el.textContent = text; el.className = tone || ""; }
function cell(row, text, tone) { const td = document.createElement("td"); td.textContent = text; if (tone) td.className = tone; row.appendChild(td); }
function shown() { return events.filter((e) => RANK[e.level] >= RANK[level.value]).slice().reverse(); }
function render() {
  const rows = shown();
  body.replaceChildren();
  for (const e of rows) {
    const tr = document.createElement("tr");
    const words = LEVEL_WORDS[e.level] || LEVEL_WORDS.info;
    cell(tr, new Date(e.time).toLocaleString());
    cell(tr, words[0], words[1]);
    cell(tr, PARTS[e.component] || e.component);
    cell(tr, e.status + (e.code ? " (" + e.code + ")" : ""));
    body.appendChild(tr);
  }
  document.getElementById("log-empty").hidden = rows.length > 0;
}
async function load() {
  try {
    const res = await fetch("/api/logs", { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    events = (await res.json()).events;
    render();
  } catch {
    say("Can't reach NowPlaying. It may have been closed.", "bad");
  }
}
level.addEventListener("change", render);
document.getElementById("copy-log").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shown().map((e) => [e.time, e.level, e.component, e.status, e.code || ""].join(" ").trim()).join("\\n"));
    say("Copied.", "ok");
  } catch {
    say("Couldn't copy.", "bad");
  }
});
load();
setInterval(load, 3000);
`;

const SAFE_FETCH_SITES = new Set(["same-origin", "none"]);

export function createLogsPageHandler({ readEvents, fallback } = {}) {
  if (typeof readEvents !== "function") throw new TypeError("readEvents: expected a function");
  if (typeof fallback !== "function") throw new TypeError("fallback: expected a handler");
  const assets = {
    "/logs": { body: PAGE, type: "text/html; charset=utf-8", page: true },
    "/logs.css": { body: CSS, type: "text/css; charset=utf-8" },
    "/logs.js": { body: SCRIPT, type: "text/javascript; charset=utf-8" },
  };
  return async function handle(request) {
    const method = request?.method || "GET";
    const url = new URL(request?.url || "/", "http://localhost");
    const asset = assets[url.pathname];
    if (!asset && url.pathname !== "/api/logs") return fallback(request);
    if (method !== "GET" && method !== "HEAD") return response(405, "Method Not Allowed", { Allow: "GET, HEAD" });
    if (asset) {
      const result = response(200, method === "HEAD" ? "" : asset.body, { "Content-Type": asset.type, "Cache-Control": "no-store" });
      return asset.page ? { ...result, page: true } : result;
    }
    // The log is for this app's own page: refuse other sites' requests.
    const site = header(request?.headers, "sec-fetch-site");
    if (site !== undefined && !SAFE_FETCH_SITES.has(String(site).toLowerCase())) return response(403, "Forbidden");
    let events;
    try { events = await readEvents(); } catch { return json(500, { error: "log_unreadable" }); }
    return json(200, { events }, method);
  };
}

function json(status, value, method = "GET") { return response(status, method === "HEAD" ? "" : JSON.stringify(value), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); }
function header(headers, name) {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((value) => value.toLowerCase() === name);
  return key ? headers[key] : undefined;
}
function response(status, body, headers = {}) { return Object.freeze({ status, headers: Object.freeze(headers), body }); }
