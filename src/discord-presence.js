import { createDiscordController } from "./discord-controller.js";

// Polls the media server and keeps Discord in step, following the idle
// choice saved by setup:
//   clear  - clear the status as soon as nothing is playing
//   grace  - keep the last status for a short grace period, then clear
//   show   - show "Nothing playing"
//   recent - keep showing what played last (without a running timer)
export const IDLE_BEHAVIORS = Object.freeze(["clear", "grace", "show", "recent"]);
const ACTIVE = new Set(["playing", "paused"]);

export function createDiscordPresenceLoop({
  getPresence, client, idleBehavior = "clear", artwork,
  intervalMs = 15_000, graceMs = 120_000, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  if (typeof getPresence !== "function") throw new TypeError("getPresence is required");
  if (!client || typeof client.publish !== "function") throw new TypeError("discord client.publish is required");
  if (!IDLE_BEHAVIORS.includes(idleBehavior)) throw new TypeError("idleBehavior is invalid");
  if (!Number.isInteger(intervalMs) || intervalMs < 1000) throw new RangeError("intervalMs must be at least 1000");
  if (!Number.isInteger(graceMs) || graceMs < 0) throw new RangeError("graceMs is invalid");

  const live = createDiscordController({ client, settings: { idleBehavior: idleBehavior === "show" ? "show" : "clear" }, ...(artwork ? { artwork } : {}) });
  const frozen = createDiscordController({ client, settings: { timestamps: "none" }, ...(artwork ? { artwork } : {}) });
  let lastActive = null;
  let idleSince = null;
  let timer = null;
  let stopped = true;
  let running = null;

  async function tick() {
    let presence;
    try { presence = await getPresence(); } catch { presence = null; }
    // A server we can't reach counts as idle, so a stale status never lingers.
    const active = presence && ACTIVE.has(presence.state);
    if (active) {
      lastActive = presence;
      idleSince = null;
      return Object.freeze({ action: "publish", ...(await live.publish(presence)) });
    }
    idleSince ??= now();
    if (idleBehavior === "show" && presence) return Object.freeze({ action: "publish", ...(await live.publish(presence)) });
    if (idleBehavior === "recent" && lastActive) return Object.freeze({ action: "recent", ...(await frozen.publish({ ...lastActive, state: "paused" })) });
    if (idleBehavior === "grace" && lastActive && now() - idleSince < graceMs) return Object.freeze({ action: "grace" });
    return Object.freeze({ action: "clear", published: await live.clear() });
  }

  function schedule() {
    if (stopped) return;
    timer = setTimer(async () => {
      running = tick().catch(() => null);
      await running;
      running = null;
      schedule();
    }, intervalMs);
    timer?.unref?.();
  }

  return Object.freeze({
    tick,
    start() {
      if (!stopped) return;
      stopped = false;
      running = tick().catch(() => null).finally(() => { running = null; schedule(); });
    },
    async stop() {
      stopped = true;
      if (timer) clearTimer(timer);
      timer = null;
      if (running) await running;
      try { await client.publish(null); } catch { /* Discord may already be gone */ }
      if (typeof client.close === "function") await client.close();
    },
  });
}
