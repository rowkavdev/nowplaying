// Push-based hosted card service (#140).
// The desktop app pushes privacy-filtered playback state; this service never
// connects back to a media server, never stores provider credentials and never
// logs media fields. State expires on its own so a card never shows stale media.

import { isHostedArtwork, MAX_HOSTED_ARTWORK_LENGTH } from "../../src/hosted-artwork-format.js";
import { createHash, randomBytes } from "node:crypto";
import { currentPosition, resolveDeviceStates } from "./resolve.js";

export const SCHEMA_VERSION = 1;
export const MAX_INGEST_BYTES = MAX_HOSTED_ARTWORK_LENGTH + 2048;
export const STATE_TTL_SECONDS = 600;
// Last-played records feed the /badges/last.json badge. They hold only the
// fields the public card already shows (kind, title, subtitle, last state)
// and expire on their own after a week.
export const LAST_TTL_SECONDS = 60 * 60 * 24 * 7;
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
// Stored JSON we cannot parse, or that parses to something other than a
// plain object, is treated as absent: a corrupt entry fails closed (or
// renders idle) instead of crashing the request with a 500.
const parseStored = (raw) => {
  try {
    const value = JSON.parse(raw);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch { return null; }
};

const USER_ID_PATTERN = /^\d+$/;
// Token entries come in exactly two shapes, both written by this service:
// legacy per-PC { cardId, deviceId } and GitHub-signed-in { userId, deviceId }.
// Anything else under np:tok: is not a credential and fails closed. The
// returned entry carries only the known fields, so a corrupt or crafted
// value can never steer the keys ingest writes to (np:state:undefined and
// friends).
const parseDeviceEntry = (raw) => {
  const value = parseStored(raw);
  if (!value || !isCardId(value.deviceId)) return null;
  const keys = Object.keys(value).sort().join(",");
  if (keys === "cardId,deviceId" && isCardId(value.cardId)) return { cardId: value.cardId, deviceId: value.deviceId };
  if (keys === "deviceId,userId" && typeof value.userId === "string" && USER_ID_PATTERN.test(value.userId)) return { userId: value.userId, deviceId: value.deviceId };
  return null;
};

const GITHUB_TOKEN_PATTERN = /^[A-Za-z0-9_]{10,255}$/;
const DEVICE_NAME_LIMIT = 40;

const STATES = new Set(["playing", "paused", "idle"]);
const KINDS = new Set(["track", "episode", "movie", "show", "unknown"]);
const INGEST_KEYS = new Set(["v", "seq", "observedAt", "state", "kind", "title", "subtitle", "positionMs", "durationMs", "artworkDataUri"]);
const TEXT_LIMIT = 200;
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

// Keep authorization, per-device sequence check and card-state write in one Redis action.
// EVAL is atomic on Upstash Redis, including across concurrent function calls.
// Increment and repair legacy buckets atomically. A no-TTL bucket came from the
// former INCR-before-EXPIRE window; retain its count and bound it from now on.
export const REGISTRATION_LIMIT_SCRIPT = `
redis.call('SET', KEYS[1], '0', 'EX', tonumber(ARGV[1]), 'NX')
if redis.call('TTL', KEYS[1]) == -1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
return redis.call('INCR', KEYS[1])
`;

export const INGEST_ATOMIC_SCRIPT = `
if not redis.call('GET', KEYS[4]) then return {-1, -1} end
local previous = tonumber(redis.call('GET', KEYS[1]) or '-1')
local incoming = tonumber(ARGV[1])
if incoming <= previous then return {0, previous} end
local state = cjson.decode(ARGV[4])
if ARGV[3] == '1' then
  if state.state == 'idle' then
    redis.call('DEL', KEYS[2])
  else
    local prior = redis.call('GET', KEYS[2])
    local old = prior and cjson.decode(prior) or nil
    if state.state == 'playing' then
      state.startedAt = old and old.state == 'playing' and old.startedAt or tonumber(ARGV[5])
    else
      state.startedAt = cjson.null
    end
    redis.call('SET', KEYS[2], cjson.encode(state), 'EX', tonumber(ARGV[6]))
  end
  redis.call('SET', KEYS[3], ARGV[5], 'EX', tonumber(ARGV[2]))
elseif state.state == 'idle' then
  redis.call('DEL', KEYS[2])
else
  redis.call('SET', KEYS[2], cjson.encode(state), 'EX', tonumber(ARGV[6]))
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[2]))
return {1, previous}
`;

// History is best-effort, but its write must not follow token revocation.
export const LAST_PLAY_ATOMIC_SCRIPT = `
-- np-last-play-v1
if not redis.call('GET', KEYS[1]) then return 0 end
redis.call('SET', KEYS[2], ARGV[1], 'EX', tonumber(ARGV[2]))
return 1
`;

// All device-list writes and associated token/state changes share this Redis atomic action.
export const DEVICE_ATOMIC_SCRIPT = `
-- np-device-lifecycle-v1
local userId, action, authHash, targetId, name, newId, newHash, stamp, previousHash, maxDevices = unpack(ARGV)
local listKey = KEYS[1]
local function tok(hash) return 'np:tok:' .. hash end
local function drop(d)
  if d.tokenHash then redis.call('DEL', tok(d.tokenHash)) end
  redis.call('DEL', 'np:dstate:' .. d.deviceId, 'np:seq:' .. d.deviceId, 'np:dseen:' .. d.deviceId)
end
local function authorized()
  local raw = redis.call('GET', tok(authHash))
  if not raw then return false end
  local data = cjson.decode(raw)
  return tostring(data.userId) == userId
end
if action ~= 'sign-in' and not authorized() then return {-1, 0} end
local raw = redis.call('GET', listKey)
local devices = raw and cjson.decode(raw) or {}
local function save()
  if #devices == 0 then redis.call('DEL', listKey)
  else redis.call('SET', listKey, cjson.encode(devices)) end
end
if action == 'sign-in' then
  if previousHash ~= '' then
    local priorRaw = redis.call('GET', tok(previousHash))
    if not priorRaw then return {-2, 0} end
    local prior = cjson.decode(priorRaw)
    if tostring(prior.userId) ~= userId then return {-3, 0} end
    local index = nil
    for i, d in ipairs(devices) do
      if d.deviceId == prior.deviceId and d.tokenHash == previousHash then index = i; break end
    end
    if not index then return {-4, 0} end
    drop(devices[index]); table.remove(devices, index)
  end
  while #devices >= tonumber(maxDevices) do
    local oldest, oldestSeen = 1, nil
    for i, d in ipairs(devices) do
      local seen = tonumber(redis.call('GET', 'np:dseen:' .. d.deviceId)) or tonumber(d.createdAt) or 0
      if not oldestSeen or seen < oldestSeen then oldest, oldestSeen = i, seen end
    end
    drop(devices[oldest]); table.remove(devices, oldest)
  end
  redis.call('SET', tok(newHash), cjson.encode({userId=userId, deviceId=newId}))
  table.insert(devices, {deviceId=newId, name=name, createdAt=tonumber(stamp), tokenHash=newHash})
  save(); return {1, #devices}
elseif action == 'sign-out' then
  for _, d in ipairs(devices) do drop(d) end
  local count = #devices
  redis.call('DEL', listKey)
  return {1, count}
end
local index = nil
for i, d in ipairs(devices) do if d.deviceId == targetId then index = i; break end end
if action == 'revoke' and not index then
  redis.call('DEL', tok(authHash))
  redis.call('DEL', 'np:dstate:' .. targetId, 'np:seq:' .. targetId, 'np:dseen:' .. targetId)
  return {1, 0}
end
if not index then return {-5, 0} end
if action == 'rename' then devices[index].name = name
else drop(devices[index]); table.remove(devices, index) end
save(); return {1, 1}
`;

export class ServiceError extends Error {
  constructor(status, code, details = {}, headers = {}) { super(code); this.status = status; this.code = code; this.details = details; this.headers = headers; }
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
  if (payload.artworkDataUri !== undefined && !isHostedArtwork(payload.artworkDataUri)) throw new ServiceError(400, "invalid_artwork");
  return { ...(payload.state !== "idle" && payload.artworkDataUri ? { artworkDataUri: payload.artworkDataUri } : {}), seq: payload.seq, observedAt: payload.observedAt, state: payload.state, kind, title: text(payload.title), subtitle: text(payload.subtitle), positionMs, durationMs };
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
  const cleaned = value.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, DEVICE_NAME_LIMIT).replace(/[\uD800-\uDBFF]$/, "").trim();
  return cleaned || "PC";
}

export function createService({ redis, now = () => Date.now(), githubUser = createGitHubIdentity() } = {}) {
  if (!redis || typeof redis.command !== "function") throw new TypeError("redis client is required");
  const cmd = (...args) => redis.command(args);
  const dayKey = (metric) => `np:stats:day:${new Date(now()).toISOString().slice(0, 10)}:${metric}`;

  // Aggregate-only, best effort: a stats write failing must never fail a card,
  // an ingest or a registration. The key gets its TTL before the first INCR,
  // so it can't be left without one.
  async function bump(key) {
    try { await cmd("INCR", key); } catch { /* optional analytics */ }
  }

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
    const count = await cmd("EVAL", REGISTRATION_LIMIT_SCRIPT, 1, bucket, "3600");
    if (count > REGISTRATIONS_PER_HOUR) throw new ServiceError(429, "rate_limited");
    const cardId = randomId(16);
    const deviceId = randomId(16);
    const token = randomId(32);
    await cmd("SET", `np:tok:${hashToken(token)}`, JSON.stringify({ cardId, deviceId }));
    await bump("np:stats:registrations");
    await countToday("registrations");
    return { cardId, deviceId, token };
  }

  async function authenticate(token) {
    if (typeof token !== "string" || token.length < 20 || token.length > 128) throw new ServiceError(401, "unauthorized");
    const raw = await cmd("GET", `np:tok:${hashToken(token)}`);
    const device = raw ? parseDeviceEntry(raw) : null;
    if (!device) throw new ServiceError(401, "unauthorized");
    return device;
  }

  async function ingest({ token, payload }) {
    const device = await authenticate(token);
    const minute = Math.floor(now() / 60_000);
    const bucket = `np:rl:ingest:${device.deviceId}:${minute}`;
    // Create the bucket with its TTL first so it can never outlive the window,
    // even if the function dies between commands; INCR keeps the TTL.
    await cmd("SET", bucket, "0", "EX", 120, "NX");
    const count = await cmd("INCR", bucket);
    // The bucket is keyed by the clock minute, so the window ends at the next minute boundary.
    const retryAfter = { "retry-after": String(60 - Math.floor((now() % 60_000) / 1000)) };
    if (count > INGESTS_PER_MINUTE) throw new ServiceError(429, "rate_limited", {}, retryAfter);
    if (device.userId) {
      const userBucket = `np:rl:uingest:${device.userId}:${minute}`;
      await cmd("SET", userBucket, "0", "EX", 120, "NX");
      if (await cmd("INCR", userBucket) > USER_INGESTS_PER_MINUTE) throw new ServiceError(429, "rate_limited", {}, retryAfter);
    }
    let update;
    const serverTime = now();
    try { update = validateIngest(payload, { now: serverTime }); }
    catch (error) {
      // Authentication has already succeeded; disclose only the service clock
      // so the device can correct a skewed observedAt without re-registering.
      if (error instanceof ServiceError && error.code === "clock_skew") error.details = { serverTime };
      throw error;
    }
    const seqKey = `np:seq:${device.deviceId}`;
    const stateKey = device.userId ? `np:dstate:${device.deviceId}` : `np:state:${device.cardId}`;
    const seenKey = device.userId ? `np:dseen:${device.deviceId}` : seqKey;
    const receivedAt = now();
    const record = { ...update, receivedAt };
    const [accepted, lastSeq] = await cmd("EVAL", INGEST_ATOMIC_SCRIPT, 4, seqKey, stateKey, seenKey, `np:tok:${hashToken(token)}`,
      String(update.seq), SEQ_TTL_SECONDS, device.userId ? "1" : "0", JSON.stringify(record), String(receivedAt), STATE_TTL_SECONDS);
    if (Number(accepted) === -1) throw new ServiceError(401, "unauthorized");
    if (Number(accepted) !== 1) throw new ServiceError(409, "stale_sequence", { lastSeq: Number(lastSeq) });
    if (update.state !== "idle" && update.title) {
      // Remember the last playback of each kind for the last-played badge. A
      // failing record must never fail an accepted ingest.
      try { await recordLastPlay(device, update, hashToken(token)); } catch { /* ignore */ }
    }
    await markDeviceActive(device.deviceId);
    return { accepted: true, expiresIn: update.state === "idle" ? 0 : STATE_TTL_SECONDS };
  }

  async function revoke({ token }) {
    const device = await authenticate(token);
    if (device.userId) {
      const result = await deviceAction(device.userId, "revoke", hashToken(token), device.deviceId);
      if (Number(result[0]) === -1) throw new ServiceError(401, "unauthorized");
      return { revoked: true };
    }
    // Invalidate first: no in-flight commit may follow the state deletion.
    await cmd("DEL", `np:tok:${hashToken(token)}`);
    await cmd("DEL", `np:state:${device.cardId}`);
    await cmd("DEL", `np:seq:${device.deviceId}`);
    // The token is already gone, so this must not turn the revoke into a 500.
    try { await deleteLastPlays(`np:last:card:${device.cardId}`); } catch { /* ignore */ }
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
  // np:last:user:<githubId>:<kind>   last non-idle playback of that kind, for
  // np:last:card:<cardId>:<kind>     the /badges/last.json badge (7-day TTL)

  const readDevices = async (userId) => {
    const raw = await cmd("GET", `np:udevs:${userId}`);
    try { const list = JSON.parse(raw ?? "[]"); return Array.isArray(list) ? list : []; } catch { return []; }
  };
  const deviceAction = (userId, action, authHash = "", targetId = "", name = "", newId = "", newHash = "", previousHash = "") =>
    cmd("EVAL", DEVICE_ATOMIC_SCRIPT, 1, `np:udevs:${userId}`, String(userId), action, authHash, targetId, name, newId, newHash, String(now()), previousHash, String(MAX_DEVICES_PER_USER));

  async function signInWithGitHub({ githubToken, deviceName, legacyToken, previousToken, clientKey = "unknown" } = {}) {
    const bucket = `np:rl:signin:${hashToken(String(clientKey)).slice(0, 32)}`;
    await cmd("SET", bucket, "0", "EX", 3600, "NX");
    if (await cmd("INCR", bucket) > SIGNINS_PER_HOUR) throw new ServiceError(429, "rate_limited");
    if (typeof githubToken !== "string" || !GITHUB_TOKEN_PATTERN.test(githubToken)) throw new ServiceError(400, "invalid_github_token");
    const { id, login } = await githubUser(githubToken);
    const userId = String(id);

    const rawUser = await cmd("GET", `np:user:${userId}`);
    const user = rawUser ? parseStored(rawUser) : null;
    // A stored user record we cannot read is not a new user. Signing in
    // anyway would skip the old-login cleanup below and leave the previous
    // public handle serving this account's playback, with no path to
    // recover it. Fail closed before any account, mapping, device or token
    // write, until the record is repaired by hand.
    if (rawUser && (!user || typeof user.login !== "string" || !isLogin(user.login))) throw new ServiceError(409, "account_needs_repair");
    if (!user) { await bump("np:stats:users"); await countToday("users"); }
    if (user?.login && user.login.toLowerCase() !== login.toLowerCase()) {
      const oldKey = `np:login:${user.login.toLowerCase()}`;
      if (await cmd("GET", oldKey) === userId) await cmd("DEL", oldKey);
    }
    await cmd("SET", `np:login:${login.toLowerCase()}`, userId);
    await cmd("SET", `np:user:${userId}`, JSON.stringify({ login, createdAt: user?.createdAt ?? now() }));

    if (previousToken !== undefined && (typeof previousToken !== "string" || previousToken.length < 20 || previousToken.length > 128)) throw new ServiceError(400, "invalid_previous_token");
    const deviceId = randomId(16);
    const token = randomId(32);
    const result = await deviceAction(userId, "sign-in", "", "", cleanDeviceName(deviceName), deviceId, hashToken(token), previousToken ? hashToken(previousToken) : "");
    if (Number(result[0]) < 0) {
      const errors = { "-2": [409, "previous_device_missing"], "-3": [403, "previous_device_mismatch"], "-4": [409, "previous_device_mismatch"] };
      const [status, code] = errors[String(result[0])];
      throw new ServiceError(status, code);
    }

    // A PC moving from its old per-PC card: that link keeps working and now
    // shows this user's card; the old key and state go.
    let aliased = false;
    if (typeof legacyToken === "string" && legacyToken.length >= 20 && legacyToken.length <= 128) {
      const legacyHash = hashToken(legacyToken);
      const raw = await cmd("GET", `np:tok:${legacyHash}`);
      const legacy = raw ? parseStored(raw) : null;
      if (legacy?.cardId && !legacy.userId) {
        await cmd("DEL", `np:tok:${legacyHash}`);
        await cmd("SET", `np:alias:${legacy.cardId}`, userId);
        await cmd("DEL", `np:state:${legacy.cardId}`);
        await cmd("DEL", `np:seq:${legacy.deviceId}`);
        // The old link's last-played history moves to the user's card so the
        // badge keeps telling one story. Best effort, like the stats writes.
        try { await migrateLastPlays(`np:last:card:${legacy.cardId}`, `np:last:user:${userId}`); } catch { /* ignore */ }
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
    const result = await deviceAction(me.userId, "rename", hashToken(token), deviceId ?? me.deviceId, cleanDeviceName(name));
    if (Number(result[0]) === -1) throw new ServiceError(401, "unauthorized");
    if (Number(result[0]) === -5) throw new ServiceError(404, "not_found");
    return { renamed: true };
  }

  async function removeDevice({ token, deviceId }) {
    const me = await authenticateUser(token);
    const result = await deviceAction(me.userId, "remove", hashToken(token), deviceId);
    if (Number(result[0]) === -1) throw new ServiceError(401, "unauthorized");
    if (Number(result[0]) === -5) throw new ServiceError(404, "not_found");
    return { removed: true };
  }

  async function signOutEverywhere({ token }) {
    const me = await authenticateUser(token);
    const result = await deviceAction(me.userId, "sign-out", hashToken(token));
    if (Number(result[0]) === -1) throw new ServiceError(401, "unauthorized");
    if (Number(result[1]) > 0) {
      // The devices are gone; a failed cleanup must not fail the sign-out.
      try { await deleteLastPlays(`np:last:user:${me.userId}`); } catch { /* ignore */ }
    }
    return { removed: Number(result[1]) };
  }

  const IDLE = Object.freeze({ state: "idle", kind: "unknown", title: null, subtitle: null, positionMs: null, durationMs: null });
  const shown = (stored) => ({ ...(stored.artworkDataUri ? { artworkDataUri: stored.artworkDataUri } : {}), state: stored.state, kind: stored.kind, title: stored.title, subtitle: stored.subtitle, positionMs: currentPosition(stored, now()), durationMs: stored.durationMs });

  async function countRender() {
    await bump("np:stats:cards_rendered");
    await countToday("renders");
  }

  async function userCardState(userId) {
    const devices = await readDevices(userId);
    const raws = devices.length ? await cmd("MGET", ...devices.map((d) => `np:dstate:${d.deviceId}`)) : [];
    const entries = raws.map((raw, i) => { try { return raw ? { ...JSON.parse(raw), deviceId: devices[i].deviceId } : null; } catch { return null; } });
    const winner = resolveDeviceStates(entries);
    return winner ? shown(winner) : IDLE;
  }

  // Resolve a card or a GitHub login to the presence the public card shows.
  // Card reads count a render; badge reads reuse this without counting.
  async function resolvePresence({ id, login }) {
    if (login != null) {
      if (!isLogin(login)) throw new ServiceError(404, "not_found");
      const userId = await cmd("GET", `np:login:${login.toLowerCase()}`);
      if (!userId) throw new ServiceError(404, "not_found");
      return { userId, presence: await userCardState(userId) };
    }
    if (!isCardId(id)) throw new ServiceError(404, "not_found");
    const alias = await cmd("GET", `np:alias:${id}`);
    if (alias) return { userId: alias, presence: await userCardState(alias) };
    const raw = await cmd("GET", `np:state:${id}`);
    const stored = raw ? parseStored(raw) : null;
    return { cardId: id, presence: stored ? shown(stored) : { ...IDLE } };
  }

  async function readUserCardState(login) {
    const { presence } = await resolvePresence({ login });
    await countRender();
    return presence;
  }

  async function readCardState(cardId) {
    const { presence } = await resolvePresence({ id: cardId });
    await countRender();
    return presence;
  }

  async function recordLastPlay(device, update, tokenHash) {
    const scope = device.userId != null ? `np:last:user:${device.userId}` : device.cardId != null ? `np:last:card:${device.cardId}` : null;
    if (!scope) return;
    await cmd("EVAL", LAST_PLAY_ATOMIC_SCRIPT, 2, `np:tok:${tokenHash}`, `${scope}:${update.kind}`, JSON.stringify({ title: update.title, subtitle: update.subtitle, state: update.state, kind: update.kind, at: now() }), LAST_TTL_SECONDS);
  }

  // Move an old per-PC card's last-played records to the user scope during a
  // legacy sign-in, so the badge history follows the card like the alias does.
  // A record never overwrites a newer one already on the user's card.
  async function migrateLastPlays(fromScope, toScope) {
    for (const kind of KINDS) {
      try {
        const raw = await cmd("GET", `${fromScope}:${kind}`);
        if (!raw) continue;
        const kept = await cmd("GET", `${toScope}:${kind}`);
        const moved = JSON.parse(raw);
        const current = kept ? JSON.parse(kept) : null;
        if (!current || current.at < moved.at) await cmd("SET", `${toScope}:${kind}`, raw, "EX", LAST_TTL_SECONDS);
        await cmd("DEL", `${fromScope}:${kind}`);
      } catch { /* the next kind still migrates */ }
    }
  }

  async function deleteLastPlays(scope) {
    for (const kind of KINDS) await cmd("DEL", `${scope}:${kind}`);
  }

  // Content for the /badges/now.json and /badges/last.json badges: the live
  // playback filtered by kind, or with `last` the most recent playback of that
  // kind. Only fields the public card already shows, never a device or token.
  // The live playback when it matches the requested kind, else nothing.
  function liveBadgeFor(presence, kind) {
    if (presence.state === "idle" || !presence.title) return null;
    if (kind !== "any" && presence.kind !== kind) return null;
    return { state: presence.state, kind: presence.kind, title: presence.title, subtitle: presence.subtitle };
  }

  // The most recent last-played record of the requested kind in this scope.
  async function lastBadgeFor(scope, kind) {
    if (!scope) return { ...IDLE };
    const kinds = kind === "any" ? [...KINDS] : [kind];
    const raws = await cmd("MGET", ...kinds.map((entry) => `${scope}:${entry}`));
    let best = null;
    for (const raw of raws ?? []) {
      if (!raw) continue;
      try { const entry = JSON.parse(raw); if (entry?.title && (!best || entry.at >= best.at)) best = entry; } catch { /* ignore */ }
    }
    return best ? { state: best.state ?? "idle", kind: best.kind ?? "unknown", title: best.title, subtitle: best.subtitle ?? null } : { ...IDLE };
  }

  async function readBadgeState({ id, login, kind = "any", last = false }) {
    if (kind !== "any" && !KINDS.has(kind)) throw new ServiceError(400, "invalid_kind");
    const { userId, cardId, presence } = await resolvePresence({ id, login });
    const live = liveBadgeFor(presence, kind);
    if (live) return live;
    if (!last) return { ...IDLE };
    const scope = userId != null ? `np:last:user:${userId}` : cardId != null ? `np:last:card:${cardId}` : null;
    return lastBadgeFor(scope, kind);
  }

  // Public totals for the README badges: one aggregate number each, nothing
  // per card, per user or per device.
  async function readTotalCount(key) {
    const raw = await cmd("GET", key);
    const count = raw === null ? 0 : Number(raw);
    if (!Number.isSafeInteger(count) || count < 0) throw new ServiceError(503, "unavailable");
    return count;
  }

  function readRequestCount() { return readTotalCount("np:stats:cards_rendered"); }
  function readRegistrationCount() { return readTotalCount("np:stats:registrations"); }
  function readUserCount() { return readTotalCount("np:stats:users"); }

  return { register, ingest, revoke, readCardState, readUserCardState, readBadgeState, readRequestCount, readRegistrationCount, readUserCount, signInWithGitHub, listDevices, renameDevice, removeDevice, signOutEverywhere };
}
