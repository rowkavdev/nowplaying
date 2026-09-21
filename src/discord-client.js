export function createDiscordClient({ transport, retryDelayMs = 5_000, now = Date.now } = {}) {
  if (!transport || typeof transport.connect !== "function" || typeof transport.setActivity !== "function" || typeof transport.clearActivity !== "function") {
    throw new TypeError("transport: expected connect, setActivity and clearActivity functions");
  }
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 100 || retryDelayMs > 300_000) throw new RangeError("retryDelayMs: must be between 100 and 300000");
  if (typeof now !== "function") throw new TypeError("now: expected a function");
  let connected = false;
  let closed = false;
  let retryAt = 0;

  async function publish(activity) {
    if (closed) return false;
    if (!connected) {
      if (now() < retryAt) return false;
      try { await transport.connect(); connected = true; }
      catch { retryAt = now() + retryDelayMs; return false; }
    }
    try {
      if (activity === null) await transport.clearActivity();
      else await transport.setActivity(activity);
      return true;
    } catch {
      connected = false;
      retryAt = now() + retryDelayMs;
      return false;
    }
  }

  async function close() {
    closed = true;
    connected = false;
    if (typeof transport.close === "function") await transport.close();
  }

  return Object.freeze({ publish, close, get connected() { return connected; } });
}
