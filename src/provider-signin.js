import { createHash, randomBytes } from "node:crypto";
import { networkFailure } from "./setup-network-failure.js";

// Sign-in flows for the setup wizard. Each flow turns a user action (approve a
// Plex PIN, approve a Jellyfin Quick Connect code, or type a username and
// password) into a stable identity plus one secret for Credential Manager.
// Nothing here logs or returns passwords, and errors never echo server text.

const PRODUCT = "nowplaying";
const TIMEOUT_MS = 10_000;
const PLEX_API = "https://plex.tv/api/v2";

export class SignInError extends Error {
  constructor(status) {
    super(`provider sign-in failed: ${status}`);
    this.name = "SignInError";
    this.status = status;
  }
}

export function normalizeServerUrl(value) {
  let url;
  try { url = new URL(String(value ?? "").trim()); } catch { throw new SignInError("invalid_server_url"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new SignInError("invalid_server_url");
  }
  return url.toString().replace(/\/+$/, "");
}

function requiredText(value, status) {
  if (typeof value !== "string" || !value.trim()) throw new SignInError(status);
  return value;
}

async function request(fetchImpl, url, init = {}) {
  let response;
  try {
    response = await fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new SignInError(networkFailure(error));
  }
  if (response.status === 401 || response.status === 403) throw new SignInError("authentication_failed");
  if (!response.ok) throw new SignInError("connection_failed");
  try { return await response.json(); } catch { throw new SignInError("connection_failed"); }
}

function identity(id, displayName) {
  const cleanId = id === undefined || id === null ? "" : String(id).trim();
  const cleanName = typeof displayName === "string" ? displayName.trim() : "";
  if (!cleanId || !cleanName) throw new SignInError("connection_failed");
  return Object.freeze({ id: cleanId, displayName: cleanName });
}

function signedIn(provider, id, secret) {
  if (typeof secret !== "string" || !secret) throw new SignInError("connection_failed");
  return Object.freeze({ provider, identity: id, secret });
}

// ---- Plex: PIN approved on plex.tv ----------------------------------------

function plexHeaders(clientId) {
  return { Accept: "application/json", "X-Plex-Product": PRODUCT, "X-Plex-Client-Identifier": requiredText(clientId, "invalid_client_id") };
}

export async function startPlexPin({ clientId, fetchImpl = fetch } = {}) {
  const pin = await request(fetchImpl, `${PLEX_API}/pins?strong=true`, { method: "POST", headers: plexHeaders(clientId) });
  if (!Number.isSafeInteger(pin?.id) || typeof pin?.code !== "string" || !pin.code) throw new SignInError("connection_failed");
  const authUrl = `https://app.plex.tv/auth#?${new URLSearchParams({ clientID: clientId, code: pin.code, "context[device][product]": PRODUCT })}`;
  return Object.freeze({ pinId: pin.id, authUrl });
}

// Returns { status: "pending" } until the PIN is approved, then the signed-in result.
export async function pollPlexPin({ clientId, pinId, fetchImpl = fetch } = {}) {
  if (!Number.isSafeInteger(pinId)) throw new SignInError("invalid_pin");
  let pin;
  try {
    pin = await request(fetchImpl, `${PLEX_API}/pins/${pinId}`, { headers: plexHeaders(clientId) });
  } catch (error) {
    if (error.status === "connection_failed") throw new SignInError("expired");
    throw error;
  }
  if (typeof pin?.authToken !== "string" || !pin.authToken) return Object.freeze({ status: "pending" });
  const user = await request(fetchImpl, `${PLEX_API}/user`, { headers: { ...plexHeaders(clientId), "X-Plex-Token": pin.authToken } });
  return Object.freeze({ status: "signed_in", ...signedIn("plex", identity(user?.id, user?.username || user?.title), pin.authToken) });
}

// ---- Jellyfin: Quick Connect code approved in Jellyfin ---------------------

function jellyfinAuthorization({ deviceId, version }) {
  requiredText(deviceId, "invalid_client_id");
  const quote = (value) => String(value).replace(/["\\,\r\n]/g, "");
  return `MediaBrowser Client="${PRODUCT}", Device="Windows", DeviceId="${quote(deviceId)}", Version="${quote(version || "0")}"`;
}

export async function startJellyfinQuickConnect({ baseUrl, deviceId, version, fetchImpl = fetch } = {}) {
  const origin = normalizeServerUrl(baseUrl);
  const headers = { Accept: "application/json", Authorization: jellyfinAuthorization({ deviceId, version }) };
  let result;
  try {
    result = await request(fetchImpl, `${origin}/QuickConnect/Initiate`, { method: "POST", headers });
  } catch (error) {
    if (error.status === "authentication_failed") throw new SignInError("quick_connect_disabled");
    throw error;
  }
  if (typeof result?.Secret !== "string" || !result.Secret || typeof result?.Code !== "string" || !result.Code) throw new SignInError("connection_failed");
  return Object.freeze({ secret: result.Secret, code: result.Code });
}

export async function pollJellyfinQuickConnect({ baseUrl, secret, deviceId, version, fetchImpl = fetch } = {}) {
  const origin = normalizeServerUrl(baseUrl);
  requiredText(secret, "expired");
  const headers = { Accept: "application/json", Authorization: jellyfinAuthorization({ deviceId, version }) };
  let state;
  try {
    state = await request(fetchImpl, `${origin}/QuickConnect/Connect?${new URLSearchParams({ secret })}`, { headers });
  } catch (error) {
    if (error.status === "connection_failed") throw new SignInError("expired");
    if (error.status === "authentication_failed") throw new SignInError("quick_connect_disabled");
    throw error;
  }
  if (state?.Authenticated !== true) return Object.freeze({ status: "pending" });
  const auth = await request(fetchImpl, `${origin}/Users/AuthenticateWithQuickConnect`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ Secret: secret }),
  });
  return Object.freeze({ status: "signed_in", ...signedIn("jellyfin", identity(auth?.User?.Id, auth?.User?.Name), auth?.AccessToken) });
}

// ---- Emby: username and password ------------------------------------------

export async function signInEmby({ baseUrl, username, password, deviceId, version, fetchImpl = fetch } = {}) {
  const origin = normalizeServerUrl(baseUrl);
  requiredText(username, "username_required");
  if (typeof password !== "string") throw new SignInError("password_required");
  const quote = (value) => String(value).replace(/["\\,\r\n]/g, "");
  requiredText(deviceId, "invalid_client_id");
  const auth = await request(fetchImpl, `${origin}/Users/AuthenticateByName`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Emby-Authorization": `Emby Client="${PRODUCT}", Device="Windows", DeviceId="${quote(deviceId)}", Version="${quote(version || "0")}"`,
    },
    body: JSON.stringify({ Username: username, Pw: password }),
  });
  return signedIn("emby", identity(auth?.User?.Id, auth?.User?.Name), auth?.AccessToken);
}

// ---- Navidrome: username and password (Subsonic salted token) -------------

export async function signInNavidrome({ baseUrl, username, password, fetchImpl = fetch, salt = randomBytes(12).toString("hex") } = {}) {
  const origin = normalizeServerUrl(baseUrl);
  requiredText(username, "username_required");
  requiredText(password, "password_required");
  // The stored secret is the salted token, not the password, so it only works
  // for the Subsonic API and never for the Navidrome web login.
  const token = createHash("md5").update(password + salt).digest("hex");
  const params = new URLSearchParams({ u: username, t: token, s: salt, v: "1.16.1", c: PRODUCT, f: "json" });
  const payload = await request(fetchImpl, `${origin}/rest/ping.view?${params}`, { headers: { Accept: "application/json" } });
  const root = payload?.["subsonic-response"];
  if (root?.status === "failed") throw new SignInError(root?.error?.code === 40 ? "authentication_failed" : "connection_failed");
  if (root?.status !== "ok") throw new SignInError("connection_failed");
  return signedIn("navidrome", identity(username, username), JSON.stringify({ token, salt }));
}
