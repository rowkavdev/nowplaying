// Keeps the tray and the running app together for `nowplaying.exe start`.
// The tray reports what the user picked through its exit code.
export const TRAY_EXIT = Object.freeze({ quit: 0, setup: 3 });

// Resolves with how the session ended:
//   "quit"           - the user chose Quit; the app is closed
//   "tray-failed"    - the tray couldn't start or crashed; the app keeps running
//   "restart-failed" - setup ran but the app couldn't start again (error attached)
export async function runTraySession({ app, runTray, runSetup, restartApp, onRestart = () => {} } = {}) {
  if (typeof app?.close !== "function" || typeof runTray !== "function" || typeof runSetup !== "function" || typeof restartApp !== "function") {
    throw new TypeError("app, runTray, runSetup and restartApp are required");
  }
  let current = app;
  for (;;) {
    let code;
    try { code = await runTray(current); } catch { return Object.freeze({ outcome: "tray-failed", app: current }); }
    if (code === TRAY_EXIT.quit) {
      await current.close();
      return Object.freeze({ outcome: "quit", app: null });
    }
    if (code !== TRAY_EXIT.setup) return Object.freeze({ outcome: "tray-failed", app: current });
    // "Run setup again": the app keeps serving while setup is open, then
    // restarts so the new settings take effect.
    try { await runSetup(); } catch { /* the window couldn't open; keep the current settings */ }
    await current.close();
    try {
      current = await restartApp();
    } catch (error) {
      return Object.freeze({ outcome: "restart-failed", app: null, error });
    }
    onRestart(current);
  }
}
