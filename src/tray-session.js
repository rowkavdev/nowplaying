// Keeps the tray and running app together. Configuration changes request a
// restart after their API response has been sent; they never open a wizard.
export const TRAY_EXIT = Object.freeze({ quit: 0 });

export function createRestartRequests() {
  let waiting = null;
  let queued = false;
  return Object.freeze({
    request() { if (waiting) { const wake = waiting; waiting = null; wake(); } else queued = true; },
    next() { if (queued) { queued = false; return Promise.resolve(); } return new Promise((resolve) => { waiting = resolve; }); },
    clear() { queued = false; },
  });
}

export async function runTraySession({ app, runTray, restartApp, onRestart = () => {}, restartRequests = null } = {}) {
  if (typeof app?.close !== "function" || typeof runTray !== "function" || typeof restartApp !== "function") {
    throw new TypeError("app, runTray and restartApp are required");
  }
  let current = app;
  let tray = null;
  for (;;) {
    if (!tray) tray = Promise.resolve().then(() => runTray(current)).then((code) => ({ code }), () => ({ failed: true }));
    const page = restartRequests ? restartRequests.next().then(() => ({ page: true })) : new Promise(() => {});
    const event = await Promise.race([tray, page]);
    if (event.page) {
      await current.close();
      try { current = await restartApp(); }
      catch (error) { return Object.freeze({ outcome: "restart-failed", app: null, error }); }
      restartRequests.clear();
      onRestart(current);
      continue;
    }
    tray = null;
    if (event.failed || event.code !== TRAY_EXIT.quit) return Object.freeze({ outcome: "tray-failed", app: current });
    await current.close();
    return Object.freeze({ outcome: "quit", app: null });
  }
}
