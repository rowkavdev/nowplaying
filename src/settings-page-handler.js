// Local settings page (#253): Discord section (#272), including what
// Discord shows when nothing is playing. Served on loopback by
// the running app next to the status page. Saves go to /api/settings as JSON;
// the HTTP server only lets them through with the session cookie this page
// sets, from the app's own origin.

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>NowPlaying settings</title><link rel="stylesheet" href="/status.css"><link rel="stylesheet" href="/settings.css"></head>
<body><main>
<nav><a href="/">Status</a> <span aria-current="page">Settings</span> <a href="/logs">Logs</a></nav>
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
<p class="row"><label for="discord-idle">When nothing is playing</label>
<select id="discord-idle" name="idleBehavior">
<option value="clear">Clear my status</option>
<option value="grace">Keep it for a short grace period</option>
<option value="show">Show that nothing is playing</option>
<option value="recent">Show what I played last</option>
</select></p>
<p class="row"><label for="discord-artwork">Album art</label>
<select id="discord-artwork" name="artworkLookup">
<option value="musicbrainz">Look up covers on MusicBrainz</option>
<option value="off">Only use art from my server</option>
</select></p>
<p class="hint">MusicBrainz lookups send only the track title and artist to musicbrainz.org and coverartarchive.org. Art from a private server is never sent to Discord.</p>
<p><button type="submit" id="discord-save">Save</button> <span id="discord-result" role="status" aria-live="polite"></span></p>
<p class="row"><button type="button" id="refresh-art">Refresh album art</button> <span id="refresh-result" role="status" aria-live="polite"></span></p>
<p class="hint">Use this if Discord shows an old or wrong cover. It forgets saved covers and looks them up again now.</p>
</section>
</form>
<form id="privacy-form" hidden>
<section aria-labelledby="h-privacy"><h2 id="h-privacy">Privacy</h2>
<p class="hint">Applies to Discord, the hosted card and your local card.</p>
<p class="row"><label><input type="checkbox" id="privacy-hideTitles"> Hide titles (shows "Private media")</label></p>
<p class="row"><label><input type="checkbox" id="privacy-hideArtwork"> Hide album art</label></p>
<p class="row"><label><input type="checkbox" id="privacy-hideProgress"> Hide progress and timer</label></p>
<fieldset><legend>Don't show when I'm playing</legend>
<p class="row"><label><input type="checkbox" id="privacy-hideMovies"> Movies</label> <label><input type="checkbox" id="privacy-hideEpisodes"> TV episodes</label> <label><input type="checkbox" id="privacy-hideMusic"> Music</label></p>
</fieldset>
<p class="hint">Hidden kinds show as nothing playing. With titles or album art hidden, covers are never looked up on MusicBrainz.</p>
<p><button type="submit" id="privacy-save">Save</button> <span id="privacy-result" role="status" aria-live="polite"></span></p>
</section>
</form>
<form id="startup-form" hidden>
<section aria-labelledby="h-startup"><h2 id="h-startup">Windows</h2>
<p class="row"><label><input type="checkbox" id="startup-enabled"> Start NowPlaying when I sign in to Windows</label></p>
<p><button type="submit" id="startup-save">Save</button> <span id="startup-result" role="status" aria-live="polite"></span></p>
</section>
</form>
<form id="hosted-form">
<section aria-labelledby="h-hosted"><h2 id="h-hosted">Hosted card</h2>
<p class="hint">Puts your card on nowplaying-hosted.vercel.app so a GitHub README can show it without opening your server to the internet. It sends only what your card shows: playing or paused, the title, artist and progress if the card shows them. Never your server address, user name, sign-in, artwork or Discord details. <a href="https://github.com/rowkavdev/nowplaying/blob/main/docs/hosted-upload.md">What leaves your PC</a></p>
<p class="row"><label><input type="checkbox" id="hosted-enabled" name="enabled"> Upload my card to the hosted service</label></p>
<dl id="hosted-details" hidden><dt>Upload</dt><dd id="hosted-state">-</dd><dt>Card link</dt><dd><a id="hosted-url" href="#">-</a> <button type="button" id="copy-url">Copy</button></dd>
<dt>README</dt><dd><code id="hosted-markdown">-</code> <button type="button" id="copy-markdown">Copy</button></dd></dl>
<p><button type="submit" id="hosted-save">Save</button> <button type="button" id="hosted-disconnect">Disconnect this PC</button> <span id="hosted-result" role="status" aria-live="polite"></span></p>
</section>
</form>
</main><script src="/settings.js"></script></body></html>
`;

const CSS = `.row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:0 0 12px}.row label[for]{min-width:184px;color:#555}
select{font:inherit;padding:4px 8px;border:1px solid #888;border-radius:6px;background:#fff;color:inherit}
.hint{color:#555;font-size:13px;margin:0 0 12px}.hint a{color:inherit}
fieldset{border:0;padding:0;margin:0 0 4px}legend{padding:0;margin:0 0 8px;color:#555}
dl{margin:0 0 12px}code{font:12px/1.4 Consolas,monospace;overflow-wrap:anywhere}button[disabled]{opacity:.6;cursor:default}
@media (prefers-color-scheme:dark){select{background:#2c2c31;border-color:#555}.row label[for],.hint,legend{color:#aaa}}
`;

const SCRIPT = `"use strict";
const form = document.getElementById("discord-form");
const fields = { enabled: document.getElementById("discord-enabled"), timestamps: document.getElementById("discord-timestamps"), artworkLookup: document.getElementById("discord-artwork"), idleBehavior: document.getElementById("discord-idle") };
const save = document.getElementById("discord-save");
function say(text, tone) { const el = document.getElementById("discord-result"); el.textContent = text; el.className = tone || ""; }
function show(d) { fields.enabled.checked = d.enabled; fields.timestamps.value = d.timestamps; fields.artworkLookup.value = d.artworkLookup; fields.idleBehavior.value = d.idleBehavior || "clear"; toggle(); }
function toggle() { fields.timestamps.disabled = fields.artworkLookup.disabled = fields.idleBehavior.disabled = !fields.enabled.checked; }
fields.enabled.addEventListener("change", toggle);
async function load() {
  try {
    const res = await fetch("/api/settings", { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    const all = await res.json();
    show(all.discord);
    showHosted(all.hosted);
    showStartup(all.startup);
    showPrivacy(all.privacy);
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
    const body = { discord: { enabled: fields.enabled.checked, timestamps: fields.timestamps.value, artworkLookup: fields.artworkLookup.value, idleBehavior: fields.idleBehavior.value } };
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
document.getElementById("refresh-art").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const result = document.getElementById("refresh-result");
  button.disabled = true;
  result.textContent = "Refreshing..."; result.className = "warn";
  try {
    const res = await fetch("/api/settings/discord/refresh-artwork", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: "{}" });
    if (!res.ok) throw new Error(String(res.status));
    await res.json();
    result.textContent = fields.enabled.checked ? "Done. Discord will show the new cover in a moment." : "Done. Covers are looked up again when Discord is on.";
    result.className = "ok";
  } catch {
    result.textContent = "Couldn't refresh.";
    result.className = "bad";
  } finally {
    button.disabled = false;
  }
});
const PRIVACY_KEYS = ["hideTitles", "hideArtwork", "hideProgress", "hideMovies", "hideEpisodes", "hideMusic"];
const privacy = { form: document.getElementById("privacy-form"), save: document.getElementById("privacy-save") };
function privacySay(text, tone) { const el = document.getElementById("privacy-result"); el.textContent = text; el.className = tone || ""; }
function showPrivacy(p) { privacy.form.hidden = !p; if (p) for (const key of PRIVACY_KEYS) document.getElementById("privacy-" + key).checked = p[key] === true; }
privacy.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  privacy.save.disabled = true;
  privacySay("Saving...", "warn");
  try {
    const body = { privacy: Object.fromEntries(PRIVACY_KEYS.map((key) => [key, document.getElementById("privacy-" + key).checked])) };
    const res = await fetch("/api/settings", { method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(String(res.status));
    showPrivacy((await res.json()).privacy);
    privacySay("Saved. Applies from the next update.", "ok");
  } catch {
    privacySay("Couldn't save. Nothing was changed.", "bad");
  } finally {
    privacy.save.disabled = false;
  }
});
const startup = { form: document.getElementById("startup-form"), enabled: document.getElementById("startup-enabled"), save: document.getElementById("startup-save") };
function startupSay(text, tone) { const el = document.getElementById("startup-result"); el.textContent = text; el.className = tone || ""; }
function showStartup(s) { startup.form.hidden = !s || !s.available; if (s) startup.enabled.checked = s.startWithWindows; }
startup.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  startup.save.disabled = true;
  startupSay("Saving...", "warn");
  try {
    const res = await fetch("/api/settings", { method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ startup: { startWithWindows: startup.enabled.checked } }) });
    if (!res.ok) throw new Error(String(res.status));
    showStartup((await res.json()).startup);
    startupSay("Saved.", "ok");
  } catch {
    startupSay("Couldn't save. Nothing was changed.", "bad");
  } finally {
    startup.save.disabled = false;
  }
});
const HOSTED_WORDS = { connected: ["Connected", "ok"], idle: ["Waiting for something to play", ""], retrying: ["Can't reach the service - retrying", "warn"], unauthorized: ["Signed out - save again to reconnect", "bad"], no_credentials: ["Not available in this build", "warn"], failed: ["Couldn't start", "bad"], safe_mode: ["Paused (safe mode)", "warn"], off: ["Off", ""] };
const hosted = { form: document.getElementById("hosted-form"), enabled: document.getElementById("hosted-enabled"), save: document.getElementById("hosted-save"), disconnect: document.getElementById("hosted-disconnect") };
function hostedSay(text, tone) { const el = document.getElementById("hosted-result"); el.textContent = text; el.className = tone || ""; }
function showHosted(h) {
  if (!h) { hosted.form.hidden = true; return; }
  hosted.enabled.checked = h.enabled;
  const words = HOSTED_WORDS[h.state] || HOSTED_WORDS.failed;
  const state = document.getElementById("hosted-state");
  state.textContent = words[0]; state.className = words[1];
  const link = document.getElementById("hosted-url");
  link.textContent = h.cardUrl || "Appears after the first upload";
  link.href = h.cardUrl || "#";
  document.getElementById("hosted-markdown").textContent = h.cardUrl ? "![Now playing](" + h.cardUrl + ")" : "-";
  document.getElementById("copy-url").disabled = document.getElementById("copy-markdown").disabled = !h.cardUrl;
  document.getElementById("hosted-details").hidden = !h.enabled;
}
async function copy(id) {
  try { await navigator.clipboard.writeText(document.getElementById(id).textContent); hostedSay("Copied.", "ok"); }
  catch { hostedSay("Couldn't copy. Select the text instead.", "bad"); }
}
document.getElementById("copy-url").addEventListener("click", () => copy("hosted-url"));
document.getElementById("copy-markdown").addEventListener("click", () => copy("hosted-markdown"));
async function send(path, method, body) {
  const res = await fetch(path, { method, cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}
hosted.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hosted.save.disabled = true;
  hostedSay("Saving...", "warn");
  try {
    showHosted((await send("/api/settings", "PUT", { hosted: { enabled: hosted.enabled.checked } })).hosted);
    hostedSay(hosted.enabled.checked ? "Saved. Uploads have started." : "Saved. Uploads have stopped.", "ok");
  } catch {
    hostedSay("Couldn't save. Nothing was changed.", "bad");
  } finally {
    hosted.save.disabled = false;
  }
});
hosted.disconnect.addEventListener("click", async () => {
  if (!confirm("Disconnect this PC from the hosted card? The service deletes its copy of your card. If you turn it on again, you get a new card link.")) return;
  hosted.disconnect.disabled = true;
  hostedSay("Disconnecting...", "warn");
  try {
    showHosted((await send("/api/settings/hosted/disconnect", "POST", {})).hosted);
    hostedSay("Disconnected. The service has deleted this PC's card.", "ok");
  } catch {
    hostedSay("Couldn't reach the service. Try again when you're online.", "bad");
  } finally {
    hosted.disconnect.disabled = false;
  }
});
load();
`;

const SAFE_FETCH_SITES = new Set(["same-origin", "none"]);
const MAX_BODY = 4096;

const SECTIONS = { discord: "updateDiscord", hosted: "updateHosted", startup: "updateStartup", privacy: "updatePrivacy" };

export function createSettingsPageHandler({ settings, fallback } = {}) {
  if (!settings || typeof settings.read !== "function" || typeof settings.updateDiscord !== "function") throw new TypeError("settings: expected read() and updateDiscord()");
  if (typeof fallback !== "function") throw new TypeError("fallback: expected a handler");
  const assets = {
    "/settings": { body: PAGE, type: "text/html; charset=utf-8", page: true },
    "/settings.css": { body: CSS, type: "text/css; charset=utf-8" },
    "/settings.js": { body: SCRIPT, type: "text/javascript; charset=utf-8" },
  };
  const read = async () => {
    const value = await settings.read();
    return { discord: value.discord, ...(value.hosted ? { hosted: value.hosted } : {}), ...(value.startup ? { startup: value.startup } : {}), ...(value.privacy ? { privacy: value.privacy } : {}) };
  };
  return async function handle(request) {
    const method = request?.method || "GET";
    const url = new URL(request?.url || "/", "http://localhost");
    const asset = assets[url.pathname];
    const disconnect = url.pathname === "/api/settings/hosted/disconnect";
    const refresh = url.pathname === "/api/settings/discord/refresh-artwork";
    if (!asset && url.pathname !== "/api/settings" && !disconnect && !refresh) return fallback(request);
    if (asset) {
      if (method !== "GET" && method !== "HEAD") return response(405, "Method Not Allowed", { Allow: "GET, HEAD" });
      const result = response(200, method === "HEAD" ? "" : asset.body, { "Content-Type": asset.type, "Cache-Control": "no-store" });
      return asset.page ? { ...result, page: true } : result;
    }
    const action = disconnect || refresh;
    if (action ? method !== "POST" : method !== "GET" && method !== "PUT") return response(405, "Method Not Allowed", { Allow: action ? "POST" : "GET, PUT" });
    // Settings are for this app's own page: refuse other sites' requests.
    const site = header(request?.headers, "sec-fetch-site");
    if (site !== undefined && !SAFE_FETCH_SITES.has(String(site).toLowerCase())) return response(403, "Forbidden");
    if (method === "GET") return json(200, await read());
    if (refresh) {
      if (typeof settings.refreshArtwork !== "function") return response(404, "Not Found");
      let dropped;
      try { dropped = await settings.refreshArtwork(); } catch { return json(500, { error: "refresh_failed" }); }
      return json(200, { dropped: Number.isInteger(dropped) && dropped >= 0 ? dropped : 0 });
    }
    if (disconnect) {
      if (typeof settings.disconnectHosted !== "function") return response(404, "Not Found");
      try { await settings.disconnectHosted(); } catch { return json(502, { error: "disconnect_failed" }); }
      return json(200, await read());
    }
    let input;
    try {
      if (typeof request.body !== "string" || Buffer.byteLength(request.body) > MAX_BODY) throw new Error("body");
      input = JSON.parse(request.body);
    } catch {
      return json(400, { error: "invalid_json" });
    }
    const keys = input && typeof input === "object" && !Array.isArray(input) ? Object.keys(input) : [];
    if (keys.length !== 1 || !Object.hasOwn(SECTIONS, keys[0]) || typeof settings[SECTIONS[keys[0]]] !== "function") return json(400, { error: "invalid_settings" });
    try {
      await settings[SECTIONS[keys[0]]](input[keys[0]]);
    } catch (error) {
      // Bad values are the caller's fault; anything else (disk, file) is ours.
      if (error instanceof TypeError || error instanceof RangeError) return json(400, { error: "invalid_settings" });
      return json(500, { error: "save_failed" });
    }
    return json(200, await read());
  };
}

function json(status, value) { return response(status, JSON.stringify(value), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); }
function header(headers, name) {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((value) => value.toLowerCase() === name);
  return key ? headers[key] : undefined;
}
function response(status, body, headers = {}) { return Object.freeze({ status, headers: Object.freeze(headers), body }); }
