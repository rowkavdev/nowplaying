// Provider reconnect backoff (#153). When the media server fails (down,
// unreachable, timing out or refusing the sign-in), polls stop reaching it for
// a while: 5 s after the first failure, doubling up to 2 minutes, each delay
// shortened by a random share of up to `jitter` so restarts don't line up.
// While waiting, getPresence fails straight away with the last error, so the
// card, Discord and the status page all see the same "unreachable" state
// without hammering the server. One success resets it.
export function withProviderBackoff(provider, { baseMs = 5_000, maxMs = 120_000, jitter = 0.2, random = Math.random, now = Date.now } = {}) {
  if (!provider || typeof provider.getPresence !== "function") throw new TypeError("provider: expected a provider");
  if (!Number.isInteger(baseMs) || baseMs < 100 || !Number.isInteger(maxMs) || maxMs < baseMs || maxMs > 3_600_000) throw new RangeError("backoff: baseMs and maxMs are invalid");
  if (typeof jitter !== "number" || !(jitter >= 0 && jitter <= 0.5)) throw new RangeError("jitter: must be between 0 and 0.5");
  if (typeof random !== "function" || typeof now !== "function") throw new TypeError("random and now: expected functions");
  let failures = 0;
  let retryAt = 0;
  let lastError = null;
  const inflight = new Map();

  function delay() {
    const full = Math.min(maxMs, baseMs * 2 ** Math.min(failures, 20));
    const share = Math.min(1, Math.max(0, Number(random()) || 0));
    return Math.round(full * (1 - jitter * share));
  }

  async function poll(args) {
    try {
      const presence = await provider.getPresence(...args);
      failures = 0; retryAt = 0; lastError = null;
      return presence;
    } catch (error) {
      retryAt = now() + delay();
      failures += 1;
      lastError = error;
      throw error;
    }
  }

  function getPresence(...args) {
    if (failures > 0 && now() < retryAt) return Promise.reject(lastError);
    // Callers asking the same thing at the same moment share one request.
    const key = JSON.stringify(args);
    if (!inflight.has(key)) inflight.set(key, poll(args).finally(() => inflight.delete(key)));
    return inflight.get(key);
  }

  function status() {
    return Object.freeze({ failures, nextRetryInMs: failures > 0 ? Math.max(0, retryAt - now()) : 0 });
  }

  return Object.freeze({ ...provider, getPresence, backoff: status });
}
