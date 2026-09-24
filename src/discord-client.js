import { reconnectDelay } from "./discord-convergence.js";

// retryDelayMs is the first reconnect delay; it doubles on each failure up to
// maxRetryDelayMs, and resets once Discord answers. Each delay is shortened by
// a random share of up to `jitter` (#153), so several copies started together
// (after a reboot or a Discord update) don't all retry at the same moment.
export function createDiscordClient({ transport, retryDelayMs = 5_000, maxRetryDelayMs = 60_000, minUpdateIntervalMs = 15_000, jitter = 0.2, random = Math.random, now = Date.now } = {}) {
  if (!transport || typeof transport.connect !== "function" || typeof transport.setActivity !== "function" || typeof transport.clearActivity !== "function") throw new TypeError("transport: expected connect, setActivity and clearActivity functions");
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 100 || retryDelayMs > 300_000) throw new RangeError("retryDelayMs: must be between 100 and 300000");
  if (!Number.isInteger(minUpdateIntervalMs) || minUpdateIntervalMs < 0 || minUpdateIntervalMs > 300_000) throw new RangeError("minUpdateIntervalMs: must be between 0 and 300000");
  if (!Number.isInteger(maxRetryDelayMs) || maxRetryDelayMs < retryDelayMs || maxRetryDelayMs > 600_000) throw new RangeError("maxRetryDelayMs: must be between retryDelayMs and 600000");
  if (typeof jitter !== "number" || !(jitter >= 0 && jitter <= 0.5)) throw new RangeError("jitter: must be between 0 and 0.5");
  if (typeof random !== "function") throw new TypeError("random: expected a function");
  if (typeof now !== "function") throw new TypeError("now: expected a function");
  let connected = false, closed = false, retryAt = 0, lastPublishAt = -Infinity, lastKey;
  let failures = 0, lastPublishedAt = null, lastError = null;

  function failed(code) {
    connected = false;
    lastError = code;
    const delay = reconnectDelay(failures, { baseMs: retryDelayMs, maxMs: maxRetryDelayMs });
    const share = Math.min(1, Math.max(0, Number(random()) || 0));
    retryAt = now() + Math.round(delay * (1 - jitter * share));
    failures += 1;
    return false;
  }

  async function publish(activity) {
    if (closed) return false;
    // Discord went away (quit or restart): forget what it was showing so the
    // same activity is sent again once it's back.
    if (connected && transport.connected === false) { connected = false; lastKey = undefined; }
    const key = stableKey(activity);
    if (key === lastKey) return true;
    if (now() - lastPublishAt < minUpdateIntervalMs) return false;
    if (!connected) {
      if (now() < retryAt) return false;
      try { await transport.connect(); connected = true; }
      catch { return failed("DISCORD_NOT_RUNNING"); }
    }
    try {
      if (activity === null) await transport.clearActivity(); else await transport.setActivity(activity);
      lastKey = key; lastPublishAt = now(); failures = 0; lastError = null;
      lastPublishedAt = new Date(now()).toISOString();
      return true;
    } catch { return failed("DISCORD_PUBLISH_FAILED"); }
  }

  async function close() { closed = true; connected = false; lastKey = undefined; if (typeof transport.close === "function") await transport.close(); }
  // Privacy-safe: a state word, a timestamp and a fixed error code. Never the
  // activity text or the underlying error message.
  function status() {
    const state = closed ? "closed" : connected ? "ready" : failures > 0 ? "degraded" : "disconnected";
    return Object.freeze({ state, lastPublishedAt, lastError, nextRetryInMs: !connected && failures > 0 ? Math.max(0, retryAt - now()) : 0 });
  }

  return Object.freeze({ publish, close, status, get connected() { return connected; } });
}

function stableKey(value) {
  if (value === null) return "null";
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("activity: expected an object or null");
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b))));
}
