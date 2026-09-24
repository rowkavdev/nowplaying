// What `nowplaying.exe start` does when there is no config yet: open setup,
// and carry on only if setup actually wrote the config.
//
// Resolves with one of:
//   "configured"        - a config was already there; setup was not opened
//   "setup-finished"    - setup ran and the config now exists
//   "setup-cancelled"   - setup ran but was closed before Finish
//   "setup-unavailable" - the setup window could not be shown
export async function ensureConfigured({ configExists, runSetup } = {}) {
  if (typeof configExists !== "function" || typeof runSetup !== "function") throw new TypeError("configExists and runSetup are required");
  if (await configExists()) return "configured";
  let shown;
  try { shown = await runSetup(); } catch { shown = false; }
  if (!shown) return "setup-unavailable";
  return (await configExists()) ? "setup-finished" : "setup-cancelled";
}

// Splits `start` arguments into an optional config module and flags.
export function parseStartArgs(args = []) {
  const flags = new Set(args.filter((arg) => arg.startsWith("--")));
  const unknown = [...flags].filter((flag) => flag !== "--no-setup" && flag !== "--no-tray");
  if (unknown.length) throw new TypeError(`unknown start option: ${unknown[0]}`);
  const positional = args.filter((arg) => !arg.startsWith("--"));
  if (positional.length > 1) throw new TypeError("start takes at most one config module");
  return Object.freeze({ module: positional[0] ?? null, setup: !flags.has("--no-setup"), tray: !flags.has("--no-tray") });
}

// First launch in the browser (#271): open the local setup page once in the
// default browser, then wait until setup writes the config (or give up after
// timeoutMs). Resolves true once the page was opened, like runSetup above;
// ensureConfigured then checks whether the config exists. The short grace
// period lets the page show its "done" state before the setup server closes.
export async function runBrowserSetup({ url, openUrl, configExists, timeoutMs = 30 * 60_000, pollMs = 1000, graceMs = 2000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now } = {}) {
  if (typeof url !== "string" || typeof openUrl !== "function" || typeof configExists !== "function") throw new TypeError("url, openUrl and configExists are required");
  openUrl(url);
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (await configExists()) {
      await sleep(graceMs);
      return true;
    }
    await sleep(pollMs);
  }
  return true;
}
