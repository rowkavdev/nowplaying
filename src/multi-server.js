// Several media servers (#252). Every signed-in server is polled together,
// each with its own backoff, and the latest result for each is kept so the
// status page can show them all.
//
// Which server's playback Discord and the card show is still an open product
// question on #252. Until it is decided, getPresence returns the first
// server's result exactly as before, so a one-server setup behaves the same.
export function createMultiServerProvider(entries, { now = Date.now } = {}) {
  if (!Array.isArray(entries) || entries.length < 1) throw new TypeError("servers: expected at least one server");
  for (const entry of entries) {
    if (!entry?.server || typeof entry.server.provider !== "string") throw new TypeError("servers: each entry needs its server");
    if (!entry.unavailable && typeof entry.provider?.getPresence !== "function") throw new TypeError("servers: each entry needs a provider");
  }
  const latest = entries.map((entry) => (entry.unavailable
    ? { state: "unavailable", reason: entry.unavailable, at: null }
    : { state: "waiting", at: null }));
  let inflight = null;

  async function pollAll() {
    return Promise.all(entries.map(async (entry, index) => {
      if (entry.unavailable) return latest[index];
      try {
        const presence = await entry.provider.getPresence();
        latest[index] = { state: "ok", presence, at: now() };
      } catch (error) {
        latest[index] = { state: "error", error, at: now() };
      }
      return latest[index];
    }));
  }

  async function getPresence() {
    // Callers asking at the same moment share one round of requests.
    inflight ??= pollAll().finally(() => { inflight = null; });
    const [primary] = await inflight;
    if (primary.state === "error") throw primary.error;
    return primary.presence;
  }

  // Per-server view for the status page: no secrets, no raw errors.
  function servers() {
    return Object.freeze(entries.map((entry, index) => {
      const result = latest[index];
      return Object.freeze({
        provider: entry.server.provider,
        displayName: entry.server.identity?.displayName ?? null,
        state: result.state === "ok" ? (result.presence?.state ?? "idle") : result.state,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.state === "error" && typeof result.error?.code === "string" ? { reason: result.error.code } : {}),
        checkedAt: result.at,
      });
    }));
  }

  // Anything else the first server's provider offers stays available.
  return Object.freeze({ ...(entries[0].provider ?? {}), getPresence, servers });
}
