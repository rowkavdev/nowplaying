// Local settings page (#253): Discord section (#272), including what
// Discord shows when nothing is playing, and card appearance (#94). Served on loopback by
// the running app next to the status page. Saves go to /api/settings as JSON;
// the HTTP server only lets them through with the session cookie this page
// sets, from the app's own origin.

import { normalizeCard } from "./setup-config.js";

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
<form id="card-form" hidden>
<section aria-labelledby="h-card"><h2 id="h-card">Card</h2>
<p class="hint">How your README card looks. Changes show in the preview straight away and are saved when you press Save. The hosted card link below uses these settings too, apart from artwork, which the hosted card never shows.</p>
<p class="row"><label for="card-theme">Style</label>
<select id="card-theme">
<option value="midnight-blue">Dark</option>
<option value="paper">Light</option>
<option value="compact">Compact (title only)</option>
</select></p>
<p class="row"><label for="card-width">Width</label><input type="number" id="card-width" min="280" max="800" step="10" inputmode="numeric"> <span class="unit">px, 280 to 800</span></p>
<p class="row"><label for="card-padding">Padding</label><input type="range" id="card-padding" min="12" max="48" step="1"> <output id="card-padding-value" for="card-padding"></output></p>
<p class="row"><label for="card-radius">Corners</label><input type="range" id="card-radius" min="0" max="24" step="1"> <output id="card-radius-value" for="card-radius"></output></p>
<p class="row"><label><input type="checkbox" id="card-showProgress"> Show progress bar</label></p>
<p class="row"><label for="card-progressHeight">Bar thickness</label><input type="range" id="card-progressHeight" min="2" max="12" step="1"> <output id="card-progressHeight-value" for="card-progressHeight"></output></p>
<p class="row"><label for="card-progressPosition">Bar position</label>
<select id="card-progressPosition">
<option value="bottom">Bottom of the card</option>
<option value="text">Under the text</option>
</select></p>
<p class="row"><label for="card-progressWidth">Bar width</label>
<select id="card-progressWidth">
<option value="content">Text column</option>
<option value="full">Whole card</option>
</select></p>
<p class="row"><label for="card-artworkPosition">Artwork side</label>
<select id="card-artworkPosition">
<option value="left">Left</option>
<option value="right">Right</option>
</select></p>
<p class="row"><label for="card-artworkWidth">Artwork width</label><input type="range" id="card-artworkWidth" min="48" max="160" step="1"> <output id="card-artworkWidth-value" for="card-artworkWidth"></output></p>
<p class="row"><label for="card-artworkHeight">Artwork height</label><input type="range" id="card-artworkHeight" min="48" max="180" step="1"> <output id="card-artworkHeight-value" for="card-artworkHeight"></output></p>
<p class="row"><label for="card-fieldOrder">Line order</label>
<select id="card-fieldOrder">
<option value="state,title,subtitle">Status / Title / Subtitle</option>
<option value="state,subtitle,title">Status / Subtitle / Title</option>
<option value="title,state,subtitle">Title / Status / Subtitle</option>
<option value="title,subtitle,state">Title / Subtitle / Status</option>
<option value="subtitle,state,title">Subtitle / Status / Title</option>
<option value="subtitle,title,state">Subtitle / Title / Status</option>
</select></p>
<p class="row"><label for="card-textAlign">Text alignment</label>
<select id="card-textAlign">
<option value="start">Left</option>
<option value="middle">Centre</option>
<option value="end">Right</option>
</select></p>
<p class="row"><label for="card-direction">Text direction</label>
<select id="card-direction">
<option value="ltr">Left to right</option>
<option value="rtl">Right to left</option>
<option value="auto">Match the title</option>
</select></p>
<div class="preview"><p class="preview-label">Preview</p><img id="card-preview" alt="Preview of your card with these settings"><p id="card-preview-note" class="hint" hidden>Can't show a preview right now.</p></div>
<p><button type="submit" id="card-save">Save</button> <button type="button" id="card-reset">Back to defaults</button> <span id="card-result" role="status" aria-live="polite"></span></p>
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
input[type=number]{font:inherit;width:6em;padding:4px 8px;border:1px solid #888;border-radius:6px;background:#fff;color:inherit}
input[type=range]{width:180px;accent-color:#0b5cad}output{min-width:3.5em;font-variant-numeric:tabular-nums;color:#555}.unit{color:#555;font-size:13px}
.preview{margin:4px 0 12px;padding:12px;border:1px dashed #bbb;border-radius:6px;overflow-x:auto}.preview-label{margin:0 0 8px;color:#555;font-size:13px}.preview img{display:block;max-width:100%;height:auto}
dl{margin:0 0 12px}code{font:12px/1.4 Consolas,monospace;overflow-wrap:anywhere}button[disabled]{opacity:.6;cursor:default}
@media (max-width:520px){.row label[for]{flex-basis:100%;min-width:0}}
@media (prefers-color-scheme:dark){select,input[type=number]{background:#2c2c31;border-color:#555}.row label[for],.hint,legend,output,.unit,.preview-label{color:#aaa}input[type=range]{accent-color:#7ab8ff}.preview{border-color:#555}}
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
    savedCard = all.card || null;
    showCard(all.card);
    if (hostedCard) showHosted(hostedCard);
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
const CARD_DEFAULTS = { theme: "midnight-blue", width: 440, padding: 24, radius: 10, progressHeight: 4, showProgress: true, artworkPosition: "left", artworkWidth: 68, artworkHeight: 100, fieldOrder: ["state", "title", "subtitle"], textAlign: "start", progressPosition: "bottom", progressWidth: "content", direction: "ltr" };
const CARD_NUMBERS = { width: [280, 800], padding: [12, 48], radius: [0, 24], progressHeight: [2, 12], artworkWidth: [48, 160], artworkHeight: [48, 180] };
const card = { form: document.getElementById("card-form"), save: document.getElementById("card-save"), preview: document.getElementById("card-preview"), note: document.getElementById("card-preview-note") };
const cardField = (key) => document.getElementById("card-" + key);
function cardSay(text, tone) { const el = document.getElementById("card-result"); el.textContent = text; el.className = tone || ""; }
function cardValues() {
  const values = { theme: cardField("theme").value, showProgress: cardField("showProgress").checked, artworkPosition: cardField("artworkPosition").value, fieldOrder: cardField("fieldOrder").value.split(","), textAlign: cardField("textAlign").value, progressPosition: cardField("progressPosition").value, progressWidth: cardField("progressWidth").value, direction: cardField("direction").value };
  for (const key of Object.keys(CARD_NUMBERS)) values[key] = Number(cardField(key).value);
  return values;
}
function cardValid(values) {
  return Object.entries(CARD_NUMBERS).every(([key, [min, max]]) => Number.isInteger(values[key]) && values[key] >= min && values[key] <= max);
}
let previewTimer;
function cardChanged() {
  for (const key of ["padding", "radius", "progressHeight", "artworkWidth", "artworkHeight"]) document.getElementById("card-" + key + "-value").textContent = cardField(key).value + " px";
  for (const key of ["progressHeight", "progressPosition", "progressWidth"]) cardField(key).disabled = !cardField("showProgress").checked;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const values = cardValues();
    if (!cardValid(values)) { cardSay("Width must be a whole number from 280 to 800.", "bad"); card.save.disabled = true; return; }
    card.save.disabled = false;
    if (document.getElementById("card-result").className === "bad") cardSay("");
    const query = new URLSearchParams({ ...values, showProgress: values.showProgress ? "1" : "0", fieldOrder: values.fieldOrder.join(",") });
    card.preview.src = "/api/settings/card/preview.svg?" + query;
  }, 200);
}
card.preview.addEventListener("load", () => { card.preview.hidden = false; card.note.hidden = true; });
card.preview.addEventListener("error", () => { card.preview.hidden = true; card.note.hidden = false; });
function showCard(c) {
  card.form.hidden = !c;
  if (!c) return;
  cardField("theme").value = c.theme;
  cardField("showProgress").checked = c.showProgress;
  cardField("artworkPosition").value = c.artworkPosition;
  cardField("fieldOrder").value = c.fieldOrder.join(",");
  cardField("textAlign").value = c.textAlign;
  cardField("progressPosition").value = c.progressPosition;
  cardField("progressWidth").value = c.progressWidth;
  cardField("direction").value = c.direction;
  for (const key of Object.keys(CARD_NUMBERS)) cardField(key).value = c[key];
  cardChanged();
}
for (const key of ["theme", "width", "padding", "radius", "progressHeight", "showProgress", "artworkPosition", "artworkWidth", "artworkHeight", "fieldOrder", "textAlign", "progressPosition", "progressWidth", "direction"]) cardField(key).addEventListener("input", cardChanged);
cardField("theme").addEventListener("change", () => {
  // Compact hides the bar by default; the others show it.
  cardField("showProgress").checked = cardField("theme").value !== "compact";
  cardChanged();
});
document.getElementById("card-reset").addEventListener("click", () => { showCard(CARD_DEFAULTS); cardSay("Defaults shown. Press Save to keep them.", ""); });
card.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = cardValues();
  if (!cardValid(values)) return;
  card.save.disabled = true;
  cardSay("Saving...", "warn");
  try {
    const saved = (await send("/api/settings", "PUT", { card: values })).card;
    savedCard = saved;
    showCard(saved);
    if (hostedCard) showHosted(hostedCard);
    cardSay("Saved. Your card uses these settings now.", "ok");
  } catch {
    cardSay("Couldn't save. Nothing was changed.", "bad");
  } finally {
    card.save.disabled = false;
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
// The hosted card takes its look from the link (#94, #414, #421). Only
// non-default settings are added. Artwork options are left out because the
// hosted card never draws artwork.
let hostedCard = null;
let savedCard = null;
function hostedLink(base) {
  if (!base || !savedCard) return base || "";
  const query = new URLSearchParams();
  if (savedCard.theme !== "midnight-blue") query.set("theme", savedCard.theme);
  if (savedCard.width !== 440) query.set("width", String(savedCard.width));
  if (savedCard.theme !== "compact" && !savedCard.showProgress) query.set("show", "mediaType,state,subtitle");
  const progressShown = savedCard.theme === "compact" ? savedCard.showProgress === true : savedCard.showProgress !== false;
  if (savedCard.padding !== undefined && savedCard.padding !== 24) query.set("padding", String(savedCard.padding));
  if (savedCard.radius !== undefined && savedCard.radius !== 10) query.set("radius", String(savedCard.radius));
  if (progressShown && savedCard.progressHeight !== undefined && savedCard.progressHeight !== 4) query.set("progressHeight", String(savedCard.progressHeight));
  if (savedCard.fieldOrder && savedCard.fieldOrder.join(",") !== "state,title,subtitle") query.set("fieldOrder", savedCard.fieldOrder.join(","));
  if (savedCard.textAlign && savedCard.textAlign !== "start") query.set("textAlign", savedCard.textAlign);
  if (progressShown && savedCard.progressPosition && savedCard.progressPosition !== "bottom") query.set("progressPosition", savedCard.progressPosition);
  if (progressShown && savedCard.progressWidth && savedCard.progressWidth !== "content") query.set("progressWidth", savedCard.progressWidth);
  if (savedCard.direction && savedCard.direction !== "ltr") query.set("direction", savedCard.direction);
  const text = query.toString().replace(/%2C/g, ",");
  return text ? base + (base.includes("?") ? "&" : "?") + text : base;
}
const hosted = { form: document.getElementById("hosted-form"), enabled: document.getElementById("hosted-enabled"), save: document.getElementById("hosted-save"), disconnect: document.getElementById("hosted-disconnect") };
function hostedSay(text, tone) { const el = document.getElementById("hosted-result"); el.textContent = text; el.className = tone || ""; }
function showHosted(h) {
  if (!h) { hosted.form.hidden = true; return; }
  hosted.enabled.checked = h.enabled;
  const words = HOSTED_WORDS[h.state] || HOSTED_WORDS.failed;
  const state = document.getElementById("hosted-state");
  state.textContent = words[0]; state.className = words[1];
  hostedCard = h;
  const link = document.getElementById("hosted-url");
  const url = hostedLink(h.cardUrl);
  link.textContent = url || "Appears after the first upload";
  link.href = url || "#";
  document.getElementById("hosted-markdown").textContent = url ? "![Now playing](" + url + ")" : "-";
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
const PREVIEW_PATH = "/api/settings/card/preview.svg";
const PREVIEW_NUMBERS = new Set(["width", "padding", "radius", "progressHeight", "artworkWidth", "artworkHeight"]);

// Draft card settings from the preview URL. Values are checked again by
// normalizeCard, the same rules as a save.
function parsePreviewQuery(searchParams) {
  const card = {};
  for (const [key, value] of searchParams) {
    if (Object.hasOwn(card, key)) throw new TypeError("repeated");
    if (key === "theme") card.theme = value;
    else if (key === "showProgress" && (value === "1" || value === "0")) card.showProgress = value === "1";
    else if (key === "artworkPosition") card.artworkPosition = value;
    else if (key === "textAlign" || key === "progressPosition" || key === "progressWidth" || key === "direction") card[key] = value;
    else if (key === "fieldOrder") card.fieldOrder = value.split(",");
    else if (PREVIEW_NUMBERS.has(key) && /^\d{1,3}$/.test(value)) card[key] = Number(value);
    else throw new TypeError("bad preview query");
  }
  return normalizeCard(card);
}

export const YOUTUBE_PAIRING_PATH = "/api/settings/youtube/pairing";
export const YOUTUBE_PAIRING_RESET_PATH = "/api/settings/youtube/pairing/reset";

const SECTIONS = { discord: "updateDiscord", hosted: "updateHosted", startup: "updateStartup", privacy: "updatePrivacy", card: "updateCard" };

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
    return { discord: value.discord, ...(value.hosted ? { hosted: value.hosted } : {}), ...(value.startup ? { startup: value.startup } : {}), ...(value.privacy ? { privacy: value.privacy } : {}), ...(value.card ? { card: value.card } : {}) };
  };
  async function preview(request, method, url) {
    if (typeof settings.previewCard !== "function") return response(404, "Not Found");
    if (method !== "GET" && method !== "HEAD") return response(405, "Method Not Allowed", { Allow: "GET, HEAD" });
    const site = header(request?.headers, "sec-fetch-site");
    if (site !== undefined && !SAFE_FETCH_SITES.has(String(site).toLowerCase())) return response(403, "Forbidden");
    let card;
    try { card = parsePreviewQuery(url.searchParams); } catch { return response(400, "Invalid preview"); }
    let svg;
    try { svg = await settings.previewCard(card); } catch { svg = null; }
    if (typeof svg !== "string" || !svg.includes("<svg")) return response(503, "Preview unavailable", { "Cache-Control": "no-store" });
    return response(200, method === "HEAD" ? "" : svg, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  }
  // YouTube extension pairing token (#136). POST even for reading, so the
  // server's session check applies and only this app's own page gets the
  // token. Reset makes a new one.
  async function youtubePairing(request, method, reset) {
    const fn = reset ? settings.resetYouTubePairing : settings.youtubePairing;
    if (typeof fn !== "function") return response(404, "Not Found");
    if (method !== "POST") return response(405, "Method Not Allowed", { Allow: "POST" });
    const site = header(request?.headers, "sec-fetch-site");
    if (site !== undefined && !SAFE_FETCH_SITES.has(String(site).toLowerCase())) return response(403, "Forbidden");
    let result;
    try { result = await fn(); } catch { return json(500, { error: reset ? "reset_failed" : "read_failed" }); }
    if (typeof result?.token !== "string") return json(500, { error: "read_failed" });
    return json(200, { token: result.token });
  }
  return async function handle(request) {
    const method = request?.method || "GET";
    const url = new URL(request?.url || "/", "http://localhost");
    const asset = assets[url.pathname];
    const disconnect = url.pathname === "/api/settings/hosted/disconnect";
    const refresh = url.pathname === "/api/settings/discord/refresh-artwork";
    if (url.pathname === PREVIEW_PATH) return preview(request, method, url);
    if (url.pathname === YOUTUBE_PAIRING_PATH || url.pathname === YOUTUBE_PAIRING_RESET_PATH) return youtubePairing(request, method, url.pathname === YOUTUBE_PAIRING_RESET_PATH);
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
