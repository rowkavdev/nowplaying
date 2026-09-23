// Local settings page (#253): Discord section (#272). Served on loopback by
// the running app next to the status page. Saves go to /api/settings as JSON;
// the HTTP server only lets them through with the session cookie this page
// sets, from the app's own origin.

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>NowPlaying settings</title><link rel="stylesheet" href="/status.css"><link rel="stylesheet" href="/settings.css"></head>
<body><main>
<nav><a href="/">Status</a> <span aria-current="page">Settings</span></nav>
<h1>Settings</h1>
<form id="discord-form">
<section aria-labelledby="h-discord"><h2 id="h-discord">Discord</h2>
<p class="row"><label><input type="checkbox" id="discord-enabled" name="enabled"> Show what I'm playing on Discord</label></p>
<p class="row"><label for="discord-timestamps">Timer</label>
<select id="discord-timestamps" name="timestamps">
<option value="both">Time played and time left</option>
<option value="elapsed">Time played</option>
<option value="remaining">Time left</option>
<option value="none">No timer</option>
</select></p>
<p class="row"><label for="discord-artwork">Album art</label>
<select id="discord-artwork" name="artworkLookup">
<option value="musicbrainz">Look up covers on MusicBrainz</option>
<option value="off">Only use art from my server</option>
</select></p>
<p class="hint">MusicBrainz lookups send only the track title and artist to musicbrainz.org and coverartarchive.org. Art from a private server is never sent to Discord.</p>
<p><button type="submit" id="discord-save">Save</button> <span id="discord-result" role="status" aria-live="polite"></span></p>
</section>
</form>
</main><script src="/settings.js"></script></body></html>
`;

const CSS = `.row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:0 0 12px}.row label[for]{min-width:96px;color:#555}
select{font:inherit;padding:4px 8px;border:1px solid #888;border-radius:6px;background:#fff;color:inherit}
.hint{color:#555;font-size:13px;margin:0 0 12px}button[disabled]{opacity:.6;cursor:default}
@media (prefers-color-scheme:dark){select{background:#2c2c31;border-color:#555}.row label[for],.hint{color:#aaa}}
`;

const SCRIPT = `"use strict";
const form = document.getElementById("discord-form");
const fields = { enabled: document.getElementById("discord-enabled"), timestamps: document.getElementById("discord-timestamps"), artworkLookup: document.getElementById("discord-artwork") };
const save = document.getElementById("discord-save");
function say(text, tone) { const el = document.getElementById("discord-result"); el.textContent = text; el.className = tone || ""; }
function show(d) { fields.enabled.checked = d.enabled; fields.timestamps.value = d.timestamps; fields.artworkLookup.value = d.artworkLookup; toggle(); }
function toggle() { fields.timestamps.disabled = fields.artworkLookup.disabled = !fields.enabled.checked; }
fields.enabled.addEventListener("change", toggle);
async function load() {
  try {
    const res = await fetch("/api/settings", { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    show((await res.json()).discord);
  } catch {
    say("Can't load settings. NowPlaying may have been closed.", "bad");
    save.disabled = true;
  }
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  save.disabled = true;
  say("Saving...", "warn");
  try {
    const body = { discord: { enabled: fields.enabled.checked, timestamps: fields.timestamps.value, artworkLookup: fields.artworkLookup.value } };
    const res = await fetch("/api/settings", { method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(String(res.status));
    show((await res.json()).discord);
    say("Saved. Discord is using the new settings.", "ok");
  } catch {
    say("Couldn't save. Nothing was changed.", "bad");
  } finally {
    save.disabled = false;
  }
});
load();
`;

const SAFE_FETCH_SITES = new Set(["same-origin", "none"]);
const MAX_BODY = 4096;

export function createSettingsPageHandler({ settings, fallback } = {}) {
  if (!settings || typeof settings.read !== "function" || typeof settings.updateDiscord !== "function") throw new TypeError("settings: expected read() and updateDiscord()");
  if (typeof fallback !== "function") throw new TypeError("fallback: expected a handler");
  const assets = {
    "/settings": { body: PAGE, type: "text/html; charset=utf-8", page: true },
    "/settings.css": { body: CSS, type: "text/css; charset=utf-8" },
    "/settings.js": { body: SCRIPT, type: "text/javascript; charset=utf-8" },
  };
  return async function handle(request) {
    const method = request?.method || "GET";
    const url = new URL(request?.url || "/", "http://localhost");
    const asset = assets[url.pathname];
    if (!asset && url.pathname !== "/api/settings") return fallback(request);
    if (asset) {
      if (method !== "GET" && method !== "HEAD") return response(405, "Method Not Allowed", { Allow: "GET, HEAD" });
      const result = response(200, method === "HEAD" ? "" : asset.body, { "Content-Type": asset.type, "Cache-Control": "no-store" });
      return asset.page ? { ...result, page: true } : result;
    }
    if (method !== "GET" && method !== "PUT") return response(405, "Method Not Allowed", { Allow: "GET, PUT" });
    // Settings are for this app's own page: refuse other sites' requests.
    const site = header(request?.headers, "sec-fetch-site");
    if (site !== undefined && !SAFE_FETCH_SITES.has(String(site).toLowerCase())) return response(403, "Forbidden");
    if (method === "GET") return json(200, { discord: settings.read().discord });
    let input;
    try {
      if (typeof request.body !== "string" || Buffer.byteLength(request.body) > MAX_BODY) throw new Error("body");
      input = JSON.parse(request.body);
    } catch {
      return json(400, { error: "invalid_json" });
    }
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => key !== "discord") || input.discord === undefined) return json(400, { error: "invalid_settings" });
    try {
      await settings.updateDiscord(input.discord);
    } catch (error) {
      // Bad values are the caller's fault; anything else (disk, file) is ours.
      if (error instanceof TypeError || error instanceof RangeError) return json(400, { error: "invalid_settings" });
      return json(500, { error: "save_failed" });
    }
    return json(200, { discord: settings.read().discord });
  };
}

function json(status, value) { return response(status, JSON.stringify(value), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); }
function header(headers, name) {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((value) => value.toLowerCase() === name);
  return key ? headers[key] : undefined;
}
function response(status, body, headers = {}) { return Object.freeze({ status, headers: Object.freeze(headers), body }); }
