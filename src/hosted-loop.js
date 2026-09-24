import { createPresence } from "./presence.js";

// Polls the local provider and hands each state to the hosted uploader, which
// decides whether anything needs sending. Runs beside the Discord loop and is
// fully independent of it: an offline host never blocks Discord presence.
//
// Stale state (#343): the hosted card must not keep showing "playing" when the
// app no longer has fresh playback.
// - Provider failing (server down, or waiting in provider backoff) for longer
//   than failAfterMs: push one idle state, then nothing until it recovers.
// - A "playing" session whose position hasn't moved for stuckAfterMs (same
//   rule and default as Discord, #339) is uploaded as idle until it moves.

export function createHostedLoop({
  getPresence, uploader, intervalMs = 15_000, failAfterMs = 60_000, stuckAfterMs = 300_000,
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  if (typeof getPresence !== "function") throw new TypeError("getPresence is required");
  if (typeof uploader?.push !== "function") throw new TypeError("uploader.push is required");
  if (!Number.isInteger(intervalMs) || intervalMs < 1000) throw new RangeError("intervalMs must be at least 1000");
  if (!Number.isInteger(failAfterMs) || failAfterMs < 0) throw new RangeError("failAfterMs is invalid");
  if (!Number.isInteger(stuckAfterMs) || stuckAfterMs < 1000) throw new RangeError("stuckAfterMs must be at least 1000");
  let timer = null;
  let stopped = true;
  let running = null;
  let failingSince = null;
  let clearedForFailure = false;
  let stuck = null;

  function isStuck(presence) {
    if (presence.state !== "playing" || !Number.isFinite(presence.positionMs)) { stuck = null; return false; }
    const key = JSON.stringify([presence.kind, presence.title, presence.subtitle, presence.series, presence.season, presence.episode]);
    if (!stuck || stuck.key !== key || stuck.positionMs !== presence.positionMs) {
      stuck = { key, positionMs: presence.positionMs, since: now() };
      return false;
    }
    return now() - stuck.since >= stuckAfterMs;
  }

  async function push(presence) {
    try { return await uploader.push(presence); } catch { return { sent: false, reason: "upload_failed" }; }
  }

  async function tick() {
    let presence;
    try {
      presence = await getPresence();
    } catch {
      failingSince ??= now();
      if (clearedForFailure || now() - failingSince < failAfterMs) return { sent: false, reason: "provider_error" };
      const result = await push(createPresence({ state: "idle" }));
      // Only stop retrying once the idle state actually reached the host (or
      // the uploader says it already has it).
      if (result.sent || result.reason === "unchanged") clearedForFailure = true;
      return { ...result, cleared: "provider_error" };
    }
    failingSince = null;
    clearedForFailure = false;
    if (!presence) return { sent: false, reason: "no_presence" };
    if (isStuck(presence)) return { ...(await push(createPresence({ state: "idle" }))), cleared: "stuck" };
    return push(presence);
  }

  function schedule() {
    if (stopped) return;
    timer = setTimer(async () => {
      running = tick();
      await running;
      running = null;
      schedule();
    }, intervalMs);
    timer?.unref?.();
  }

  return Object.freeze({
    start() {
      if (!stopped) return;
      stopped = false;
      running = tick().finally(() => { running = null; schedule(); });
    },
    async stop() {
      stopped = true;
      if (timer) clearTimer(timer);
      timer = null;
      if (running) await running.catch(() => {});
    },
    tick,
    status: () => uploader.status?.() ?? null,
  });
}
