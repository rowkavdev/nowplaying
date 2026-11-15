// Several media servers (#252). Every signed-in server is polled together,
// each with its own backoff, and the latest result for each is kept so the
// status page can show them all.
//
// Which server wins (Rowan, 24 Sept): the most recent request. The server
// whose playback started or resumed last wins; playing beats paused. With
// nothing playing use an idle answer from a reachable server.
import { classifyFailure } from "./resilient-card.js";
import { presenceItemKey } from "./presence-identity.js";
import { nextPresenceActivityOrder, PRESENCE_ACTIVITY_ORDER } from "./presence-activity.js";

// At the 15-second refresh cadence, a delayed but healthy server's last
// sample should remain eligible while its next poll is in flight.
const MAX_PENDING_SAMPLE_AGE_MS = 30_000;

export function createMultiServerProvider(entries, { now = Date.now, elapsedNow = () => performance.now(), settleMs = 200 } = {}) {
  if (!Array.isArray(entries) || entries.length < 1) throw new TypeError("servers: expected at least one server");
  for (const entry of entries) {
    if (!entry?.server || typeof entry.server.provider !== "string") throw new TypeError("servers: each entry needs its server");
    if (!entry.unavailable && typeof entry.provider?.getPresence !== "function") throw new TypeError("servers: each entry needs a provider");
  }
  const latest = entries.map((entry) => (entry.unavailable
    ? { state: "unavailable", reason: entry.unavailable, at: null }
    : { state: "waiting", at: null }));
  // When each server last started something: playback began, resumed, or
  // moved to a different item.
  // Activity order is process-local. Wall time can move backward while the
  // app is running, but a new request must still outrank an older one.
  const activeOrder = entries.map(() => null);
  // Errors remain visible in latest but do not prove playback stopped.
  const lastSuccessful = entries.map(() => null);
  const polls = entries.map(() => null);
  const activityByPresence = new WeakMap();
  let inflight = null;

  function noteActivity(index, before, presence) {
    const was = before;
    if (presence?.state !== "playing" && presence?.state !== "paused") return;
    const wasActive = was?.state === "playing" || was?.state === "paused";
    const newItem = !wasActive || presenceItemKey(was) !== presenceItemKey(presence);
    const resumed = presence.state === "playing" && was?.state !== "playing";
    if (newItem || resumed) activeOrder[index] = nextPresenceActivityOrder();
  }

  async function poll(entry, index) {
    try {
      const presence = await entry.provider.getPresence();
      noteActivity(index, lastSuccessful[index], presence);
      lastSuccessful[index] = presence;
      latest[index] = { state: "ok", presence, at: now(), elapsed: elapsedNow() };
    } catch (error) {
      latest[index] = { state: "error", error, at: now() };
    }
    return latest[index];
  }

  async function pollAll() {
    const results = [];
    let timer;
    let finish;
    const enough = new Promise((resolve) => { finish = resolve; });
    const done = Promise.all(entries.map(async (entry, index) => {
      if (entry.unavailable) { results[index] = latest[index]; return; }
      polls[index] ??= poll(entry, index).finally(() => { polls[index] = null; });
      const result = await polls[index];
      results[index] = result;
      // Once a server answers, give the rest a short window to answer too.
      // Unfinished polls can update the status rows and be reused by the next
      // call without holding up the card or starting duplicate requests.
      if (result.state === "ok" && timer === undefined) timer = setTimeout(finish, settleMs);
    }));
    try {
      await Promise.race([done, enough]);
      const time = elapsedNow();
      return pick(latest.map((previous, index) => results[index] ??
        (previous.state === "ok" && time - previous.elapsed <= MAX_PENDING_SAMPLE_AGE_MS ? previous : null)));
    } finally { clearTimeout(timer); }
  }

  function getPresence() {
    // Callers asking at the same moment share one round of requests.
    inflight ??= pollAll().finally(() => { inflight = null; });
    return inflight;
  }

  function pick(results) {
    let best = -1;
    for (const wanted of ["playing", "paused"]) {
      results.forEach((result, index) => {
        if (result?.state !== "ok" || result.presence?.state !== wanted) return;
        if (best === -1 || (activeOrder[index] ?? -Infinity) > (activeOrder[best] ?? -Infinity)) best = index;
      });
      if (best !== -1) {
        const presence = results[best].presence;
        activityByPresence.set(presence, activeOrder[best]);
        return presence;
      }
    }
    // An idle response still shows the state of a reachable server.
    const answered = results.find((result) => result?.state === "ok");
    if (answered) return answered.presence;
    const failed = results.find((result) => result?.state === "error");
    if (failed) throw failed.error;
    throw new Error("No media server is available");
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
        ...(result.state === "error" ? { reason: classifyFailure(result.error) } : {}),
        checkedAt: result.at,
      });
    }));
  }

  // Anything else the first server's provider offers stays available.
  return Object.freeze({ ...(entries[0].provider ?? {}), getPresence, servers,
    [PRESENCE_ACTIVITY_ORDER]: (presence) => activityByPresence.get(presence) ?? null,
  });
}
