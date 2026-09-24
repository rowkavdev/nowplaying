// Push-based hosted card service (#140).
// The desktop app pushes privacy-filtered playback state; this service never
// connects back to a media server, never stores provider credentials and never
// logs media fields. State expires on its own so a card never shows stale media.

import { createHash, randomBytes } from "node:crypto";
import { currentPosition, resolveDeviceStates } from "./resolve.js";

export const SCHEMA_VERSION = 1;
export const MAX_INGEST_BYTES = 2048;
export const STATE_TTL_SECONDS = 600;
export const MAX_CLOCK_SKEW_MS = 120_000;
export const SEQ_TTL_SECONDS = 60 * 60 * 24 * 30;
export const REGISTRATIONS_PER_HOUR = 5;
// The desktop app sends on change plus a 4-minute heartbeat, so a real device
// stays far below this. It only stops a leaked token or a looping client from
// hammering Redis.
export const INGESTS_PER_MINUTE = 30;
// Per-day aggregate counters for the private usage dashboard (#218). Kept a
// little over a year, then they expire on their own.
export const DAY_STATS_TTL_SECONDS = 60 * 60 * 24 * 400;

// GitHub sign-in (#140): one card per GitHub user, several PCs updating it.
export const MAX_DEVICES_PER_USER = 10;
export const USER_INGESTS_PER_MINUTE = 60;
export const SIGNINS_PER_HOUR = 10;
const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GITHUB_TOKEN_PATTERN = /^[A-Za-z0-9_]{10,255}$/;
const DEVICE_NAME_LIMIT = 40;

const STATES = new Set(["playing", "paused", "idle"]);
const KINDS = new Set(["track", "episode", "movie", "show", "unknown"]);
const INGEST_KEYS = new Set(["v", "seq", "observedAt", "state", "kind", "title", "subtitle", "positionMs", "durationMs"]);
const TEXT_LIMIT = 200;
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export class ServiceError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

export function hashToken(token) { return createHash("sha256").update(token).digest("hex"); }

function randomId(bytes) { return randomBytes(bytes).toString("base64url"); }

export function isCardId(value) { return typeof value === "string" && ID_PATTERN.test(value); }

export function validateIngest(payload, { now = Date.now() } = {}) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) throw new ServiceError(400, "invalid_payload");
  for (const key of Object.keys(payload)) if (!INGEST_KEYS.has(key)) throw new ServiceError(400, "unknown_field");
  if (payload.v !== SCHEMA_VERSION) throw new ServiceError(400, "unsupported_version");
  if (!Number.isSafeInteger(payload.seq) || payload.seq < 0) throw new ServiceError(400, "invalid_seq");
  if (!Number.isSafeInteger(payload.observedAt)) throw new ServiceError(400, "invalid_observed_at");
  if (Math.abs(payload.observedAt - now) > MAX_CLOCK_SKEW_MS) throw new ServiceError(400, "clock_skew");
  if (!STATES.has(payload.state)) throw new ServiceError(400, "invalid_state");
  const kind = payload.kind ?? "unknown";
  if (!KINDS.has(kind)) throw new ServiceError(400, "invalid_kind");
  const text = (value) => {
    if (value == null) return null;
    if (typeof value !== "string" || value.length > TEXT_LIMIT) throw new ServiceError(400, "invalid_text");
    return value;
  };
  const ms = (value) => {
    if (value == null) return null;
    if (!Number.isSafeInteger(value) || value < 0) throw new ServiceError(400, "invalid_time");
    return value;
  };
  const positionMs = ms(payload.positionMs);
  const durationMs = ms(payload.durationMs);
  if (positionMs !== null && durationMs !== null && positionMs > durationMs) throw new ServiceError(400, "invalid_time");
  return { seq: payload.seq, observedAt: payload.observedAt, state: payload.state, kind, title: text(payload.title), subtitle: text(payload.subtitle), positionMs, durationMs };
}

export function isLogin(value) { return typeof value === "string" && LOGIN_PATTERN.test(value); }

// Asks GitHub who a user token belongs to. The token is used for this one
// call and then dropped; the service never stores it.
export function createGitHubIdentity({ fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  return async function githubUser(token) {
    let res;
    try {
      res = await fetchImpl("https://api.github.com/user", {
        headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "nowplaying-hosted", "x-github-api-version": "2022-11-28" },
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch { throw new ServiceError(502, "github_unavailable"); }
    if (res.status === 401 || res.status === 403) throw new ServiceError(401, "github_unauthorized");
    if (!res.ok) throw new ServiceError(502, "github_unavailable");
    let body;
    try { body = await res.json(); } catch { throw new ServiceError(502, "github_unavailable"); }
    if (!Number.isSafeInteger(body?.id) || body.id <= 0 || !isLogin(body?.login)) throw new ServiceError(502, "github_unavailable");
    return { id: body.id, login: body.login };
  };
}

function cleanDeviceName(value) {
  if (typeof value !== "string") return "PC";
  const cleaned = value.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, DEVICE_NAME_LIMIT);
  return cleaned || "PC";
}

export function createService({ redis, now = () => Date.now(), githubUser = createGitHubIdentity() } = {}) {
  if (!redis || typeof redis.command !== "function") throw new TypeError("redis client is required");
  const cmd = (...args) => redis.command(args);
  const dayKey = (metric) => `np:stats:day:${new Date(now()).toISOString().slice(0, 10)}:${metric}`;

  // Aggregate-only, best effort: a stats write failing must never fail a card,
  // an ingest or a registration. The key gets its TTL before the first INCR,
  // so it can't be left without one.
  async function countToday(metric) {
    try {
      const key = dayKey(metric);
      await cmd("SET", key, "0", "EX", DAY_STATS_TTL_SECONDS, "NX");
      await cmd("INCR", key);
    } catch { /* ignore */ }
  }

  // Unique devices per day. A HyperLogLog of a hash of the device ID spots
  // first-time devices without storing anything readable; when it changes,
  // a plain per-day counter goes up. The dashboard's read-only Redis token
  // can't run PFCOUNT, so it reads that counter. HyperLogLog is approximate:
  // treat the number as an estimate.
  async function markDeviceActive(deviceId) {
    try {
      const hllKey = dayKey("devices");
      const changed = await cmd("PFADD", hllKey, hashToken(`device:${deviceId}`).slice(0, 32));
      await cmd("EXPIRE", hllKey, DAY_STATS_TTL_SECONDS);
      if (changed === 1) await countToday("active_devices");
    } catch { /* ignore */ }
  }

  async function register({ clientKey = "unknown" } = {}) {
    const bucket = `np:rl:register:${hashToken(String(clientKey)).slice(0, 32)}`;
    const count = await cmd("INCR", bucket);
    if (count === 1) await cmd("EXPIRE", bucket, 3600);
    if (count > REGISTRATIONS_PER_HOUR) throw new ServiceError(429, "rate_limited");
    const cardId = randomId(16);
    const deviceId = randomId(16);
    const token = randomId(32);
    await cmd("SET", `np:tok:${hashToken(token)}`, JSON.stringify({ cardId, deviceId }));
    await cmd("INCR", "np:stats:registrations");
    await countToday("registrations");
    return { cardId, deviceId, token };
  }

  async function authenticate(token) {
    if (typeof token !== "string" || token.length < 20 || token.length > 128) throw new ServiceError(401, "unauthorized");
    const raw = await cmd("GET", `np:tok:${hashToken(token)}`);
    if (!raw) throw new ServiceError(401, "unauthorized");
    return JSON.parse(raw);
  }

  async function ingest({ token, payload }) {
    const device = await authenticate(token);
    const minute = Math.floor(now() / 60_000);
    const bucket = `np:rl:ingest:${device.deviceId}:${minute}`;
    // Create the bucket with its TTL first so it can never outlive the window,
    // even if the function dies between commands; INCR keeps the TTL.
    await cmd("SET", bucket, "0", "EX", 120, "NX");
    const count = await cmd("INCR", bucket);
    if (count > INGESTS_PER_MINUTE) throw new ServiceError(429, "rate_limited");
    if (device.userId) {
      const userBucket = `np:rl:uingest:${device.userId}:${minute}`;
      await cmd("SET", userBucket, "0", "EX", 120, "NX");
      if (await cmd("INCR", userBucket) > USER_INGESTS_PER_MINUTE) throw new ServiceError(429, "rate_limited");
    }
    const update = validateIngest(payload, { now: now() });
    const seqKey = `np:seq:${device.deviceId}`;
    const lastSeq = Number(await cmd("GET", seqKey) ?? -1);
    if (update.seq <= lastSeq) throw new ServiceError(409, "stale_sequence");
    await cmd("SET", seqKey, String(update.seq), "EX", SEQ_TTL_SECONDS);
    if (device.userId) {
      const key = `np:dstate:${device.deviceId}`;
      if (update.state === "idle") {
        await cmd("DEL", key);
      } else {
        const prevRaw = await cmd("GET", key);
        const prev = prevRaw ? JSON.parse(prevRaw) : null;
        // startedAt moves only when this device starts playing (server time).
        const startedAt = update.state === "playing" ? (prev?.state === "playing" && prev.startedAt ? prev.startedAt : now()) : null;
        await cmd("SET", key, JSON.stringify({ ...update, receivedAt: now(), startedAt }), "EX", STATE_TTL_SECONDS);
      }
      await cmd("SET", `np:dseen:${device.deviceId}`, String(now()), "EX", SEQ_TTL_SECONDS);
      await markDeviceActive(device.deviceId);
      return { accepted: true, expiresIn: update.state === "idle" ? 0 : STATE_TTL_SECONDS };
    }
    const stateKey = `np:state:${device.cardId}`;
    if (update.state === "idle") {
      await cmd("DEL", stateKey);
    } else {
      await cmd("SET", stateKey, JSON.stringify({ ...update, receivedAt: now() }), "EX", STATE_TTL_SECONDS);
    }
    await markDeviceActive(device.deviceId);
    return { accepted: true, expiresIn: update.state === "idle" ? 0 : STATE_TTL_SECONDS };
  }

  async function revoke({ token }) {
    const device = await authenticate(token);
    if (device.userId) {
      const devices = await readDevices(device.userId);
      const mine = devices.find((d) => d.deviceId === device.deviceId) ?? { deviceId: device.deviceId };
      await dropDevice({ ...mine, tokenHash: hashToken(token) });
      await writeDevices(device.userId, devices.filter((d) => d.deviceId !== device.deviceId));
      return { revoked: true };
    }
    await cmd("DEL", `np:state:${device.cardId}`);
    await cmd("DEL", `np:seq:${device.deviceId}`);
    await cmd("DEL", `np:tok:${hashToken(token)}`);
    return { revoked: true };
  }

  // ---- GitHub users and their devices -------------------------------------
  // np:user:<githubId>      { login, createdAt }
  // np:login:<login lower>  githubId (refreshed on every sign-in, so renames work)
  // np:udevs:<githubId>     [{ deviceId, name, createdAt, tokenHash }]
  // np:tok:<hash>           { userId, deviceId }
  // np:dstate:<deviceId>    that device's live state (TTL), with startedAt
  // np:dseen:<deviceId>     last upload time, for the device list
  // np:alias:<oldCardId>    githubId: an old per-PC card link now shows the user's card

  const readDevices = async (userId) => {
    const raw = await cmd("GET", `np:udevs:${userId}`);
    try { const list = JSON.parse(raw ?? "[]"); return Array.isArray(list) ? list : []; } catch { return []; }
  };
  const writeDevices = (userId, list) => (list.length ? cmd("SET", `np:udevs:${userId}`, JSON.stringify(list)) : cmd("DEL", `np:udevs:${userId}`));
  async function dropDevice(device) {
    if (device.tokenHash) await cmd("DEL", `np:tok:${device.tokenHash}`);
    await cmd("DEL", `np:dstate:${device.deviceId}`);
    await cmd("DEL", `np:seq:${device.deviceId}`);
    await cmd("DEL", `np:dseen:${device.deviceId}`);
  }

  async function signInWithGitHub({ githubToken, deviceName, legacyToken, clientKey = "unknown" } = {}) {
    const bucket = `np:rl:signin:${hashToken(String(clientKey)).slice(0, 32)}`;
    await cmd("SET", bucket, "0", "EX", 3600, "NX");
    if (await cmd("INCR", bucket) > SIGNINS_PER_HOUR) throw new ServiceError(429, "rate_limited");
    if (typeof githubToken !== "string" || !GITHUB_TOKEN_PATTERN.test(githubToken)) throw new ServiceError(400, "invalid_github_token");
    const { id, login } = await githubUser(githubToken);
    const userId = String(id);

    const rawUser = await cmd("GET", `np:user:${userId}`);
    const user = rawUser ? JSON.parse(rawUser) : null;
    if (!user) { await cmd("INCR", "np:stats:users"); await countToday("users"); }
    if (user?.login && user.login.toLowerCase() !== login.toLowerCase()) {
      const oldKey = `np:login:${user.login.toLowerCase()}`;
      if (await cmd("GET", oldKey) === userId) await cmd("DEL", oldKey);
    }
    await cmd("SET", `np:login:${login.toLowerCase()}`, userId);
    await cmd("SET", `np:user:${userId}`, JSON.stringify({ login, createdAt: user?.createdAt ?? now() }));

    let devices = await readDevices(userId);
    while (devices.length >= MAX_DEVICES_PER_USER) {
      // Full: the device quiet for longest makes room.
      const seen = await Promise.all(devices.map(async (d) => Number(await cmd("GET", `np:dseen:${d.deviceId}`) ?? d.createdAt ?? 0)));
      const oldest = seen.indexOf(Math.min(...seen));
      await dropDevice(devices[oldest]);
      devices = devices.filter((_, i) => i !== oldest);
    }
    const deviceId = randomId(16);
    const token = randomId(32);
    const tokenHash = hashToken(token);
    await cmd("SET", `np:tok:${tokenHash}`, JSON.stringify({ userId, deviceId }));
    devices.push({ deviceId, name: cleanDeviceName(deviceName), createdAt: now(), tokenHash });
    await writeDevices(userId, devices);

    // A PC moving from its old per-PC card: that link keeps working and now
    // shows this user's card; the old key and state go.
    let aliased = false;
    if (typeof legacyToken === "string" && legacyToken.length >= 20 && legacyToken.length <= 128) {
      const legacyHash = hashToken(legacyToken);
      const raw = await cmd("GET", `np:tok:${legacyHash}`);
      const legacy = raw ? JSON.parse(raw) : null;
      if (legacy?.cardId && !legacy.userId) {
        await cmd("SET", `np:alias:${legacy.cardId}`, userId);
        await cmd("DEL", `np:state:${legacy.cardId}`);
        await cmd("DEL", `np:seq:${legacy.deviceId}`);
        await cmd("DEL", `np:tok:${legacyHash}`);
        aliased = true;
      }
    }
    return { login, deviceId, token, cardPath: `/u/${login}.svg`, aliasedOldCard: aliased };
  }

  async function authenticateUser(token) {
    const device = await authenticate(token);
    if (!device.userId) throw new ServiceError(403, "not_signed_in");
    return device;
  }

  async function listDevices({ token }) {
    const me = await authenticateUser(token);
    const devices = await readDevices(me.userId);
    const seen = devices.length ? await cmd("MGET", ...devices.map((d) => `np:dseen:${d.deviceId}`)) : [];
    return { devices: devices.map((d, i) => ({ deviceId: d.deviceId, name: d.name, createdAt: d.createdAt, lastSeen: seen[i] === null ? null : Number(seen[i]), current: d.deviceId === me.deviceId })) };
  }

  async function renameDevice({ token, deviceId, name }) {
    const me = await authenticateUser(token);
    const devices = await readDevices(me.userId);
    const target = devices.find((d) => d.deviceId === (deviceId ?? me.deviceId));
    if (!target) throw new ServiceError(404, "not_found");
    target.name = cleanDeviceName(name);
    await writeDevices(me.userId, devices);
    return { renamed: true };
  }

  async function removeDevice({ token, deviceId }) {
    const me = await authenticateUser(token);
    const devices = await readDevices(me.userId);
    const target = devices.find((d) => d.deviceId === deviceId);
    if (!target) throw new ServiceError(404, "not_found");
    await dropDevice(target);
    await writeDevices(me.userId, devices.filter((d) => d !== target));
    return { removed: true };
  }

  async function signOutEverywhere({ token }) {
    const me = await authenticateUser(token);
    const devices = await readDevices(me.userId);
    for (const d of devices) await dropDevice(d);
    await cmd("DEL", `np:udevs:${me.userId}`);
    return { removed: devices.length };
  }

  const IDLE = Object.freeze({ state: "idle", kind: "unknown", title: null, subtitle: null, positionMs: null, durationMs: null });
  const shown = (stored) => ({ state: stored.state, kind: stored.kind, title: stored.title, subtitle: stored.subtitle, positionMs: currentPosition(stored, now()), durationMs: stored.durationMs });

  async function countRender() {
    await cmd("INCR", "np:stats:cards_rendered");
    await countToday("renders");
  }

  async function userCardState(userId) {
    const devices = await readDevices(userId);
    const raws = devices.length ? await cmd("MGET", ...devices.map((d) => `np:dstate:${d.deviceId}`)) : [];
    const entries = raws.map((raw, i) => { try { return raw ? { ...JSON.parse(raw), deviceId: devices[i].deviceId } : null; } catch { return null; } });
    const winner = resolveDeviceStates(entries);
    return winner ? shown(winner) : IDLE;
  }

  async function readUserCardState(login) {
    if (!isLogin(login)) throw new ServiceError(404, "not_found");
    const userId = await cmd("GET", `np:login:${login.toLowerCase()}`);
    if (!userId) throw new ServiceError(404, "not_found");
    const state = await userCardState(userId);
    await countRender();
    return state;
  }

  async function readCardState(cardId) {
    if (!isCardId(cardId)) throw new ServiceError(404, "not_found");
    const alias = await cmd("GET", `np:alias:${cardId}`);
    if (alias) { const state = await userCardState(alias); await countRender(); return state; }
    const raw = await cmd("GET", `np:state:${cardId}`);
    await countRender();
    if (!raw) return { ...IDLE };
    return shown(JSON.parse(raw));
  }

  // Public total for the README badge: how many card requests the service has
  // answered. One aggregate number, nothing per card or per device.
  async function readRequestCount() {
    const raw = await cmd("GET", "np:stats:cards_rendered");
    const count = raw === null ? 0 : Number(raw);
    if (!Number.isSafeInteger(count) || count < 0) throw new ServiceError(503, "unavailable");
    return count;
  }

  return { register, ingest, revoke, readCardState, readUserCardState, readRequestCount, signInWithGitHub, listDevices, renameDevice, removeDevice, signOutEverywhere };
}
