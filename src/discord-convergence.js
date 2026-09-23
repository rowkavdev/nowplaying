import { formatDiscordActivity } from "./discord.js";

const STATES = new Set(["disconnected", "connecting", "ready", "degraded"]);
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,47}$/;

export function reconnectDelay(attempt, { baseMs = 1_000, maxMs = 30_000 } = {}) {
  if (!Number.isInteger(attempt) || attempt < 0) throw new TypeError("attempt is invalid");
  if (!Number.isInteger(baseMs) || baseMs < 100 || !Number.isInteger(maxMs) || maxMs < baseMs) throw new TypeError("backoff is invalid");
  return Math.min(maxMs, baseMs * (2 ** Math.min(attempt, 20)));
}

export function createDiscordConvergence({ client, settings = {}, now = () => Date.now() } = {}) {
  if (!client || typeof client.connect !== "function" || typeof client.publish !== "function") throw new TypeError("discord client is invalid");
  if (typeof now !== "function") throw new TypeError("now is invalid");

  let state = "disconnected";
  let attempt = 0;
  let lastActivity = null;
  let lastPublishedAt = null;
  let lastError = null;

  const snapshot = () => Object.freeze({ state, attempt, lastPublishedAt, lastError });

  async function connect() {
    state = "connecting";
    try {
      await client.connect();
      state = "ready";
      attempt = 0;
      lastError = null;
      return snapshot();
    } catch (error) {
      state = "degraded";
      attempt += 1;
      lastError = safeError(error);
      return snapshot();
    }
  }

  function disconnect() {
    state = "disconnected";
    lastActivity = null;
    return snapshot();
  }

  async function reconcile(presence) {
    if (state !== "ready") return Object.freeze({ changed: false, status: snapshot() });
    const activity = formatDiscordActivity(presence, settings);
    const fingerprint = JSON.stringify(activity);
    if (fingerprint === lastActivity) return Object.freeze({ changed: false, status: snapshot() });
    try {
      await client.publish(activity);
      lastActivity = fingerprint;
      lastPublishedAt = new Date(now()).toISOString();
      lastError = null;
      return Object.freeze({ changed: true, activity, status: snapshot() });
    } catch (error) {
      state = "degraded";
      attempt += 1;
      lastError = safeError(error);
      return Object.freeze({ changed: false, status: snapshot() });
    }
  }

  return Object.freeze({ connect, disconnect, reconcile, status: snapshot, nextReconnectDelay: (options) => reconnectDelay(attempt, options) });
}

function safeError(error) {
  const code = error && typeof error.code === "string" && ERROR_CODE.test(error.code) ? error.code : "DISCORD_UNAVAILABLE";
  return Object.freeze({ code });
}

export function isDiscordConnectionState(value) {
  return STATES.has(value);
}
