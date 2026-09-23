// Push-based hosted card service (#140).
// The desktop app pushes privacy-filtered playback state; this service never
// connects back to a media server, never stores provider credentials and never
// logs media fields. State expires on its own so a card never shows stale media.

import { createHash, randomBytes } from "node:crypto";

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

export function createService({ redis, now = () => Date.now() } = {}) {
  if (!redis || typeof redis.command !== "function") throw new TypeError("redis client is required");
  const cmd = (...args) => redis.command(args);

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
    const bucket = `np:rl:ingest:${device.deviceId}:${Math.floor(now() / 60_000)}`;
    const count = await cmd("INCR", bucket);
    if (count === 1) await cmd("EXPIRE", bucket, 120);
    if (count > INGESTS_PER_MINUTE) throw new ServiceError(429, "rate_limited");
    const update = validateIngest(payload, { now: now() });
    const seqKey = `np:seq:${device.deviceId}`;
    const lastSeq = Number(await cmd("GET", seqKey) ?? -1);
    if (update.seq <= lastSeq) throw new ServiceError(409, "stale_sequence");
    await cmd("SET", seqKey, String(update.seq), "EX", SEQ_TTL_SECONDS);
    const stateKey = `np:state:${device.cardId}`;
    if (update.state === "idle") {
      await cmd("DEL", stateKey);
    } else {
      await cmd("SET", stateKey, JSON.stringify({ ...update, receivedAt: now() }), "EX", STATE_TTL_SECONDS);
    }
    return { accepted: true, expiresIn: update.state === "idle" ? 0 : STATE_TTL_SECONDS };
  }

  async function revoke({ token }) {
    const device = await authenticate(token);
    await cmd("DEL", `np:state:${device.cardId}`);
    await cmd("DEL", `np:seq:${device.deviceId}`);
    await cmd("DEL", `np:tok:${hashToken(token)}`);
    return { revoked: true };
  }

  async function readCardState(cardId) {
    if (!isCardId(cardId)) throw new ServiceError(404, "not_found");
    const raw = await cmd("GET", `np:state:${cardId}`);
    await cmd("INCR", "np:stats:cards_rendered");
    if (!raw) return { state: "idle", kind: "unknown", title: null, subtitle: null, positionMs: null, durationMs: null };
    const stored = JSON.parse(raw);
    let positionMs = stored.positionMs;
    if (stored.state === "playing" && positionMs !== null) {
      positionMs = positionMs + Math.max(0, now() - stored.observedAt);
      if (stored.durationMs !== null) positionMs = Math.min(positionMs, stored.durationMs);
    }
    return { state: stored.state, kind: stored.kind, title: stored.title, subtitle: stored.subtitle, positionMs, durationMs: stored.durationMs };
  }

  return { register, ingest, revoke, readCardState };
}
