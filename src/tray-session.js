// Keeps the tray and the running app together for `nowplaying.exe start`.
// The tray reports what the user picked through its exit code.
export const TRAY_EXIT = Object.freeze({ quit: 0, setup: 3 });

// Resolves with how the session ended:
//   "quit"           - the user chose Quit; the app is closed
//   "tray-failed"    - the tray couldn't start or crashed; the app keeps running
//   "restart-failed" - setup ran but the app couldn't start again (error attached)
//
// setupRequests (optional, from createSetupRequests) lets the settings page
// ask for setup too.

// Setup requests from the settings page (#253): request() is called by the
// app; the session waits on next(). Requests made while setup is already
// open are dropped by clear().
export function createSetupRequests() {
  let waiting = null;
  let queued = false;
  return Object.freeze({
    request() {
      if (waiting) { const wake = waiting; waiting = null; wake(); } else queued = true;
    },
    next() {
      if (queued) { queued = false; return Promise.resolve(); }
      return new Promise((resolve) => { waiting = resolve; });
    },
    clear() { queued = false; },
  });
}

export async function runTraySession({ app, runTray, runSetup, restartApp, onRestart = () => {}, setupRequests = null } = {}) {
  if (typeof app?.close !== "function" || typeof runTray !== "function" || typeof runSetup !== "function" || typeof restartApp !== "function") {
    throw new TypeError("app, runTray, runSetup and restartApp are required");
  }
  let current = app;
  let tray = null;
  // "Run setup again" (tray) and "Add or remove servers" (settings page)
  // both land here: the app keeps serving while setup is open, then
  // restarts so the new settings take effect. The tray only points at the
  // app's address, so a settings-page restart leaves it running.
  async function setupAndRestart() {
    try { await runSetup(); } catch { /* the window couldn't open; keep the current settings */ }
    await current.close();
    try {
      current = await restartApp();
    } catch (error) {
      return error;
    }
    setupRequests?.clear();
    onRestart(current);
    return null;
  }
  for (;;) {
    if (!tray) tray = Promise.resolve().then(() => runTray(current)).then((code) => ({ code }), () => ({ failed: true }));
    const page = setupRequests ? setupRequests.next().then(() => ({ page: true })) : new Promise(() => {});
    const event = await Promise.race([tray, page]);
    if (event.page) {
      const error = await setupAndRestart();
      if (error) return Object.freeze({ outcome: "restart-failed", app: null, error });
      continue;
    }
    tray = null;
    if (event.failed) return Object.freeze({ outcome: "tray-failed", app: current });
    if (event.code === TRAY_EXIT.quit) {
      await current.close();
      return Object.freeze({ outcome: "quit", app: null });
    }
    if (event.code !== TRAY_EXIT.setup) return Object.freeze({ outcome: "tray-failed", app: current });
    const error = await setupAndRestart();
    if (error) return Object.freeze({ outcome: "restart-failed", app: null, error });
  }
}
