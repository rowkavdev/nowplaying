import { spawn } from "node:child_process";
import { win32 } from "node:path";
import { createHttpServer } from "./http-server.js";
import { createSetupDraftHandler } from "./setup-draft-handler.js";
import { createSetupDraftStore } from "./setup-draft-store.js";
import { createSetupPageHandler } from "./setup-page-handler.js";
import { createSetupDiscoveryHandler } from "./setup-discovery.js";

export function windowsSetupDraftPath({ localAppData, appName = "nowplaying" } = {}) {
  if (typeof localAppData !== "string" || !localAppData.trim()) throw new TypeError("LOCALAPPDATA is required");
  if (!/^[A-Za-z0-9._-]+$/.test(appName)) throw new TypeError("appName is invalid");
  return win32.join(win32.resolve(localAppData), appName, "setup-draft.json");
}

// Starts the first-run wizard on a loopback-only port and returns its URL.
// Port 0 lets the OS pick a free port so a busy 3000 never blocks setup.
export async function startSetupApp({ draftFile, host = "127.0.0.1", port = 0, discover } = {}) {
  const page = createSetupPageHandler();
  const draft = createSetupDraftHandler({ store: createSetupDraftStore({ file: draftFile }) });
  const discovery = createSetupDiscoveryHandler(discover ? { discover } : {});
  const app = createHttpServer({ host, port, handler: async (request) => (await page(request)) ?? (await discovery(request)) ?? (await draft(request)) });
  const address = await app.listen();
  const authority = address.family === "IPv6" ? `[${address.address}]` : address.address;
  return Object.freeze({ url: `http://${authority}:${address.port}/setup`, close: () => app.close() });
}

// Opens a loopback setup URL in the default browser without a shell, so the URL
// can never be interpreted as a command.
export function openSetupUrl(url, { platform = process.platform, spawnProcess = spawn } = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || !["127.0.0.1", "[::1]", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/setup" || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new TypeError("setup URL must be a loopback /setup URL");
  }
  const [command, args] = platform === "win32" ? ["rundll32.exe", ["url.dll,FileProtocolHandler", parsed.href]]
    : platform === "darwin" ? ["open", [parsed.href]]
    : ["xdg-open", [parsed.href]];
  const child = spawnProcess(command, args, { detached: true, stdio: "ignore", shell: false, windowsHide: true });
  child.on?.("error", () => {});
  child.unref?.();
  return parsed.href;
}
