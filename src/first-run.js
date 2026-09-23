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
