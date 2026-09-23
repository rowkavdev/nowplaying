// Polls the local provider and hands each state to the hosted uploader, which
// decides whether anything needs sending. Runs beside the Discord loop and is
// fully independent of it: an offline host never blocks Discord presence.

export function createHostedLoop({ getPresence, uploader, intervalMs = 15_000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (typeof getPresence !== "function") throw new TypeError("getPresence is required");
  if (typeof uploader?.push !== "function") throw new TypeError("uploader.push is required");
  if (!Number.isInteger(intervalMs) || intervalMs < 1000) throw new RangeError("intervalMs must be at least 1000");
  let timer = null;
  let stopped = true;
  let running = null;

  async function tick() {
    let presence;
    try { presence = await getPresence(); } catch { return { sent: false, reason: "provider_error" }; }
    if (!presence) return { sent: false, reason: "no_presence" };
    try { return await uploader.push(presence); } catch { return { sent: false, reason: "upload_failed" }; }
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
