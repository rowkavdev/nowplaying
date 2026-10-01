import { readBoundedJson } from "./bounded-response.js";
import { normalizeHostedUrl, hostedCredentialMatches } from "./hosted-uploader.js";

// Settings "Hosted card devices" (#140): the PCs signed in to the same GitHub
// account. Rename, sign out one PC, or sign out everywhere. The browser talks
// only to this app; the app calls the hosted service's /api/devices with this
// PC's device key, which never reaches the page.

export const HOSTED_DEVICES_PATH = "/api/settings/hosted/devices";
const ID = /^[A-Za-z0-9_-]{22}$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const MAX_NAME = 40;
const MAX_BODY = 2048;
const TIMEOUT_MS = 10_000;
const SAFE_FETCH_SITES = new Set(["same-origin", "none"]);
const SIGNED_OUT = Object.freeze({ signedIn: false, devices: [] });

function cleanName(value) {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return name && name.length <= MAX_NAME ? name : null;
}
function time(value) { return Number.isSafeInteger(value) && value > 0 ? value : null; }
function device(d) {
  if (!d || !ID.test(d.deviceId)) return null;
  return { deviceId: d.deviceId, name: typeof d.name === "string" ? d.name.slice(0, MAX_NAME) : "PC", createdAt: time(d.createdAt), lastSeen: time(d.lastSeen), current: d.current === true };
}

export function createHostedDevicesClient({ baseUrl, credentials, fetchImpl = fetch } = {}) {
  if (typeof credentials?.load !== "function") throw new TypeError("credentials are required");
  const origin = normalizeHostedUrl(baseUrl);

  async function call(token, body) {
    const res = await fetchImpl(`${origin}/api/devices`, {
      method: body ? "POST" : "GET",
      headers: { accept: "application/json", authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let data = null;
    try { data = await readBoundedJson(res); } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        data = null;
      }
    return { status: res.status, data };
  }

  async function signedIn() {
    const stored = await credentials.load();
    return hostedCredentialMatches(stored, origin) && LOGIN.test(stored.login ?? "") && typeof stored.token === "string" ? stored : null;
  }

  // Returns { signedIn, login?, devices, signedOutHere? }. A 401 means this
  // PC's key was removed from another PC: report it as signed out.
  async function run(action = {}) {
    const me = await signedIn();
    if (!me) return SIGNED_OUT;
    let body = null;
    if (action.action === "rename") body = { action: "rename", deviceId: action.deviceId, name: action.name };
    else if (action.action === "remove") body = { action: "remove", deviceId: action.deviceId };
    else if (action.action === "remove-all") body = { action: "remove-all" };
    if (body) {
      const res = await call(me.token, body);
      if (res.status === 401) return { ...SIGNED_OUT, signedOutHere: true };
      if (res.status >= 400) { const error = new Error("hosted_devices_failed"); error.status = res.status; error.code = res.data?.error ?? null; throw error; }
      if (body.action === "remove-all" || (body.action === "remove" && body.deviceId === me.deviceId)) return { ...SIGNED_OUT, signedOutHere: true };
    }
    const res = await call(me.token, null);
    if (res.status === 401) return { ...SIGNED_OUT, signedOutHere: true };
    if (res.status !== 200 || !Array.isArray(res.data?.devices)) { const error = new Error("hosted_devices_failed"); error.status = res.status; throw error; }
    return { signedIn: true, login: me.login, devices: res.data.devices.map(device).filter(Boolean).slice(0, 10) };
  }

  return Object.freeze({ run });
}

function parseAction(raw) {
  let input;
  try {
    if (typeof raw !== "string" || Buffer.byteLength(raw) > MAX_BODY) return null;
    input = JSON.parse(raw);
  } catch { return null; }
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  switch (input.action) {
    case "list": case "remove-all": return { action: input.action };
    case "remove": return ID.test(input.deviceId ?? "") ? { action: "remove", deviceId: input.deviceId } : null;
    case "rename": {
      const name = cleanName(input.name);
      return name && ID.test(input.deviceId ?? "") ? { action: "rename", deviceId: input.deviceId, name } : null;
    }
    default: return null;
  }
}

// Handles HOSTED_DEVICES_PATH; everything else goes to
// fallback. getClient() returns the client for the current hosted URL (or
// null when hosted upload isn't set up). onSignedOut() runs after this PC's
// own key is removed, so the app stops uploading and forgets it.
export function createHostedDevicesHandler({ getClient, onSignedOut = async () => {}, fallback } = {}) {
  if (typeof getClient !== "function") throw new TypeError("getClient: expected a function");
  if (typeof fallback !== "function") throw new TypeError("fallback: expected a handler");
  return async function handle(request) {
    const method = request?.method || "GET";
    const url = new URL(request?.url || "/", "http://localhost");
    if (url.pathname !== HOSTED_DEVICES_PATH) return fallback(request);
    // POST even for listing, so the server's session check applies.
    if (method !== "POST") return response(405, "Method Not Allowed", { Allow: "POST" });
    const site = header(request?.headers, "sec-fetch-site");
    if (site !== undefined && !SAFE_FETCH_SITES.has(String(site).toLowerCase())) return response(403, "Forbidden");
    const action = parseAction(request.body);
    if (!action) return json(400, { error: "invalid_request" });
    let client;
    try { client = await getClient(); } catch { client = null; }
    if (!client) return json(200, SIGNED_OUT);
    let result;
    try { result = await client.run(action); } catch (error) {
      if (error?.status === 404) return json(404, { error: "not_found" });
      if (error?.status === 400) return json(400, { error: "invalid_request" });
      return json(502, { error: "unreachable" });
    }
    if (result.signedOutHere) {
      try { await onSignedOut(); } catch { /* the key is already dead on the service */ }
      return json(200, SIGNED_OUT);
    }
    return json(200, result);
  };
}

function json(status, value) { return response(status, JSON.stringify(value), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); }
function header(headers, name) {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((value) => value.toLowerCase() === name);
  return key ? headers[key] : undefined;
}
function response(status, body, headers = {}) { return Object.freeze({ status, headers: Object.freeze(headers), body }); }

// Page script for the "Hosted card devices" block, appended to /settings.js.
// Text only (no innerHTML), so device names can't inject markup.
export const HOSTED_DEVICES_SCRIPT = `(() => {
const root = document.getElementById("hosted-devices");
if (!root) return;
const list = document.getElementById("hosted-devices-list");
const status = document.getElementById("hosted-devices-result");
const everywhere = document.getElementById("hosted-devices-everywhere");
function say(text, tone) { status.textContent = text; status.className = tone || ""; }
function when(ms) { return ms ? new Date(ms).toLocaleString() : "never"; }
async function call(body) {
  const res = await fetch(${JSON.stringify(HOSTED_DEVICES_PATH)}, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(String(res.status));
  // Read at most MAX bytes before parsing, so a misbehaving reply can't make the page buffer an unbounded body.
  const MAX = 65536;
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > MAX) { reader.cancel().catch(() => {}); throw new Error("too_large"); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
function button(text, target, onClick) { const b = document.createElement("button"); b.type = "button"; b.textContent = text; b.ariaLabel = text === "Rename" ? "Rename " + target : "Sign out " + target; b.addEventListener("click", onClick); return b; }
const deviceActions = new Map();
function render(data) {
  deviceActions.clear();
  list.replaceChildren();
  root.hidden = !data.signedIn;
  if (!data.signedIn) return;
  document.getElementById("hosted-devices-login").textContent = data.login;
  for (const d of data.devices) {
    const li = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = d.name + (d.current ? " (this PC)" : "");
    const seen = document.createElement("span");
    seen.className = "hint";
    seen.textContent = " last seen " + when(d.lastSeen) + " ";
    const rename = button("Rename", d.name, () => { const next = prompt("New name for " + d.name, d.name); if (next && next.trim()) act({ action: "rename", deviceId: d.deviceId, name: next.trim().slice(0, 40) }, "Renamed."); });
    const remove = button(d.current ? "Sign out this PC" : "Sign out", d.name + (d.current ? " (this PC)" : ""), () => { if (confirm("Sign out " + d.name + "? It stops updating your card.")) act({ action: "remove", deviceId: d.deviceId }, "Signed out " + d.name + "."); });
    deviceActions.set(d.deviceId, { rename, remove });
    li.append(name, seen, rename, remove);
    list.append(li);
  }
}
async function act(body, done) {
  const focused = document.activeElement;
  const restore = list.contains(focused);
  say("Working...", "warn");
  try {
    const data = await call(body);
    const keepFocus = restore && document.activeElement === focused;
    render(data);
    say(done, "ok");
    if (keepFocus) {
      const target = deviceActions.get(body.deviceId)?.[body.action === "rename" ? "rename" : "remove"] || (data.signedIn ? everywhere : document.querySelector(".drpp-config-scroll"));
      target?.focus();
    }
  }
  catch { say("Couldn't reach the hosted service. Try again.", "bad"); }
}
everywhere.addEventListener("click", () => { if (confirm("Sign out every PC? Your card stops updating until you sign in again.")) act({ action: "remove-all" }, "Signed out everywhere."); });
call({ action: "list" }).then(render).catch(() => { root.hidden = true; });
})();
`;
