export function createDiscordClient({ transport, retryDelayMs = 5_000, minUpdateIntervalMs = 15_000, now = Date.now } = {}) {
  if (!transport || typeof transport.connect !== "function" || typeof transport.setActivity !== "function" || typeof transport.clearActivity !== "function") throw new TypeError("transport: expected connect, setActivity and clearActivity functions");
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 100 || retryDelayMs > 300_000) throw new RangeError("retryDelayMs: must be between 100 and 300000");
  if (!Number.isInteger(minUpdateIntervalMs) || minUpdateIntervalMs < 0 || minUpdateIntervalMs > 300_000) throw new RangeError("minUpdateIntervalMs: must be between 0 and 300000");
  if (typeof now !== "function") throw new TypeError("now: expected a function");
  let connected = false, closed = false, retryAt = 0, lastPublishAt = -Infinity, lastKey;

  async function publish(activity) {
    if (closed) return false;
    const key = stableKey(activity);
    if (key === lastKey) return true;
    if (now() - lastPublishAt < minUpdateIntervalMs) return false;
    if (!connected) {
      if (now() < retryAt) return false;
      try { await transport.connect(); connected = true; }
      catch { retryAt = now() + retryDelayMs; return false; }
    }
    try {
      if (activity === null) await transport.clearActivity(); else await transport.setActivity(activity);
      lastKey = key; lastPublishAt = now(); return true;
    } catch { connected = false; retryAt = now() + retryDelayMs; return false; }
  }

  async function close() { closed = true; connected = false; lastKey = undefined; if (typeof transport.close === "function") await transport.close(); }
  return Object.freeze({ publish, close, get connected() { return connected; } });
}

function stableKey(value) {
  if (value === null) return "null";
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("activity: expected an object or null");
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b))));
}
