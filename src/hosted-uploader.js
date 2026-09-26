import { projectHostedState } from "./hosted-projection.js";

// Pushes privacy-filtered playback state from the desktop app to the hosted
// card service (#140). It only ever talks to the configured service URL, sends
// state changes plus a slow heartbeat (not every progress tick), keeps at most
// one pending update when the network drops, and never persists history.
//
// `credentials` stores the device registration ({ cardId, deviceId, token })
// somewhere safe (Windows Credential Manager in the app); it is never logged.

export const DEFAULT_HOSTED_URL = "https://nowplaying-hosted.vercel.app";
export const HEARTBEAT_MS = 4 * 60 * 1000;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const ID = /^[A-Za-z0-9_-]{22}$/;
const TOKEN = /^[A-Za-z0-9_-]{20,128}$/;

export function normalizeHostedUrl(value = DEFAULT_HOSTED_URL) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError("hosted URL must be a valid URL"); }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new TypeError("hosted URL must use HTTPS");
  if (url.username || url.password || url.search || url.hash) throw new TypeError("hosted URL must not carry credentials, a query or a fragment");
  return url.origin + url.pathname.replace(/\/+$/, "");
}

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
// Anonymous per-PC card ({ cardId }) or signed in with GitHub ({ login }).
function validRegistration(value) {
  return Boolean(value && ID.test(value.deviceId) && TOKEN.test(value.token) && (LOGIN.test(value.login ?? "") || ID.test(value.cardId ?? "")));
}

export class HostedUploadError extends Error {
  constructor(code, status = null) { super(code); this.name = "HostedUploadError"; this.code = code; this.status = status; }
}

export function createHostedUploader({
  baseUrl = DEFAULT_HOSTED_URL,
  credentials,
  settings = {},
  fetchImpl = fetch,
  now = () => Date.now(),
  heartbeatMs = HEARTBEAT_MS,
} = {}) {
  if (typeof credentials?.load !== "function" || typeof credentials?.save !== "function" || typeof credentials?.clear !== "function") {
    throw new TypeError("credentials.load, save and clear are required");
  }
  const origin = normalizeHostedUrl(baseUrl);
  let registration = null;
  let lastSeq = -1;
  let lastSent = null; // { key, at }
  let pending = null;
  let retryAt = 0;
  let failures = 0;
  let status = { state: "idle", lastError: null, lastSuccessAt: null };

  async function request(path, { method = "POST", token, body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers = { accept: "application/json" };
      if (token) headers.authorization = `Bearer ${token}`;
      if (body !== undefined) headers["content-type"] = "application/json";
      const res = await fetchImpl(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, redirect: "error" });
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      if (!res.ok) throw new HostedUploadError(typeof data?.error === "string" ? data.error : "http_error", res.status);
      return data;
    } catch (error) {
      if (error instanceof HostedUploadError) throw error;
      throw new HostedUploadError("network_error");
    } finally {
      clearTimeout(timer);
    }
  }

  async function ensureRegistered() {
    if (registration) return registration;
    const stored = await credentials.load();
    if (validRegistration(stored)) return (registration = { ...stored });
    const created = await request("/api/register");
    if (!validRegistration(created)) throw new HostedUploadError("invalid_registration");
    registration = { cardId: created.cardId, deviceId: created.deviceId, token: created.token };
    await credentials.save(registration);
    return registration;
  }

  // Wall-clock based so the sequence keeps rising across restarts without
  // writing anything to disk.
  function nextSeq() {
    lastSeq = Math.max(lastSeq + 1, now());
    return lastSeq;
  }

  function changeKey(payload) {
    const { seq, observedAt, positionMs, ...rest } = payload;
    return JSON.stringify(rest);
  }

  function due(key, at, positionMs) {
    if (!lastSent) return true;
    if (lastSent.key !== key) return true;
    if (key.includes('"state":"idle"')) return false;
    if (at - lastSent.at >= heartbeatMs) return true;
    // A seek moves the card's progress: resend when position drifts over 15s
    // from where the service would have extrapolated it.
    if (positionMs != null && lastSent.positionMs != null && lastSent.playing) {
      const expected = lastSent.positionMs + (at - lastSent.at);
      if (Math.abs(positionMs - expected) > 15_000) return true;
    } else if (positionMs != null && lastSent.positionMs != null && Math.abs(positionMs - lastSent.positionMs) > 15_000) {
      return true;
    }
    return false;
  }

  async function send(presence) {
    const at = now();
    // `settings` can be a function so privacy and card changes apply without a restart.
    const probe = projectHostedState(presence, typeof settings === "function" ? settings() : settings, { seq: 0, now: at });
    const key = changeKey(probe);
    if (!due(key, at, probe.positionMs)) return { sent: false, reason: "unchanged" };
    const device = await ensureRegistered();
    const payload = { ...probe, seq: nextSeq() };
    try {
      await request("/api/ingest", { token: device.token, body: payload });
    } catch (error) {
      if (error.code === "stale_sequence") {
        // Another run pushed a later seq; jump past it once.
        lastSeq = Math.max(lastSeq, now()) + 1000;
        await request("/api/ingest", { token: device.token, body: { ...payload, seq: nextSeq() } });
      } else {
        throw error;
      }
    }
    lastSent = { key, at, positionMs: probe.positionMs ?? null, playing: probe.state === "playing" };
    return { sent: true };
  }

  async function push(presence) {
    if (status.state === "unauthorized") return { sent: false, reason: "unauthorized" };
    if (status.state === "disconnect_pending") return { sent: false, reason: "disconnect_pending" };
    pending = presence; // only the newest state is kept
    if (now() < retryAt) return { sent: false, reason: "backoff" };
    const current = pending;
    try {
      const result = await send(current);
      if (pending === current) pending = null;
      failures = 0; retryAt = 0;
      status = { state: "connected", lastError: null, lastSuccessAt: result.sent ? now() : status.lastSuccessAt };
      return result;
    } catch (error) {
      const code = error instanceof HostedUploadError ? error.code : "upload_failed";
      if (error?.status === 401) {
        // Signed in again elsewhere (setup's GitHub sign-in replaces the key):
        // pick up the new key instead of wiping it.
        const failed = registration?.token;
        const stored = await credentials.load().catch(() => null);
        if (validRegistration(stored) && stored.token !== failed) {
          registration = { ...stored }; lastSent = null; failures = 0; retryAt = 0;
          status = { ...status, state: "retrying", lastError: code };
          return { sent: false, reason: "credentials_changed" };
        }
        registration = null; pending = null;
        await credentials.clear().catch(() => {});
        status = { ...status, state: "unauthorized", lastError: code };
        return { sent: false, reason: "unauthorized" };
      }
      failures += 1;
      retryAt = now() + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (failures - 1));
      status = { ...status, state: "retrying", lastError: code };
      return { sent: false, reason: code };
    }
  }

  async function disconnect() {
    const stored = await credentials.load();
    pending = null; lastSent = null;
    if (validRegistration(stored)) {
      try { await request("/api/revoke", { method: "DELETE", token: stored.token }); }
      catch (error) {
        if (error.status !== 401) {
          // Keep the protected key so the user can retry revocation. Do not
          // send another upload or register a replacement card in this run.
          status = { state: "disconnect_pending", lastError: error.code, lastSuccessAt: null };
          throw error;
        }
      }
    }
    await credentials.clear();
    registration = null;
    status = { state: "idle", lastError: null, lastSuccessAt: null };
    return { disconnected: true };
  }

  async function cardUrl() {
    if (status.state === "disconnect_pending") return null;
    const device = await ensureRegistered();
    return device.login ? `${origin}/u/${device.login}.svg` : `${origin}/card/${device.cardId}.svg`;
  }

  return Object.freeze({ push, disconnect, cardUrl, status: () => ({ ...status, pending: pending !== null }) });
}
