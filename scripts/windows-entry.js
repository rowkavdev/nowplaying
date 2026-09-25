import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createAppLogger, windowsLogPath } from "../src/app-log.js";
import { StartupError, resolveAppPort, startAppFromConfig } from "../src/app-config.js";
import { createCredentialStore } from "../src/credential-store.js";
import { createHostedCredentials } from "../src/hosted-credentials.js";
import { loadOrCreateDeviceId, openLocalSettingsUrl, windowsConfigPath } from "../src/setup-app.js";
import { createWindowsCredentialAdapter } from "../src/windows-credential-adapter.js";
import { createWindowsStartup } from "../src/windows-startup.js";
import { parseStartArgs } from "../src/first-run.js";
import { createRestartRequests, runTraySession } from "../src/tray-session.js";
import { createStartupRecoveryStore, guardStartup } from "../src/startup-recovery-store.js";
import { spawn } from "node:child_process";

// Declared before any top-level await so the start path below can use it.
let recovery;
const restartRequests = createRestartRequests();

const command = process.argv[2] ?? "help";

if (command === "--version" || command === "version") {
  // A damaged or incomplete bundle (files moved, partial uninstall) has no
  // manifest: say so plainly instead of dumping an ENOENT stack (#500).
  let manifest;
  try { manifest = JSON.parse(await readFile(resolve("app", "package.json"), "utf8")); }
  catch { console.error("nowplaying: cannot read app/package.json - the install looks incomplete. Reinstall NowPlaying."); process.exit(1); }
  console.log(manifest.version);
} else if (command === "start") {
  const logger = createAppLogger();
  await logger.event("startup", "starting");
  let app;
  let startArgs;
  let legacyModule;
  const configFile = windowsDataPaths().configFile;
  try {
    try { startArgs = parseStartArgs(process.argv.slice(3)); }
    catch (error) { console.error(`nowplaying: ${error.message}`); process.exit(2); }
    // An explicit config module wins. Older installs may have a config module.
    legacyModule = startArgs.module ?? (!existsSync(configFile) && existsSync(resolve("nowplaying.config.mjs")) ? "nowplaying.config.mjs" : null);
    if (legacyModule) {
      // Hand-written config module (advanced / pre-wizard setups).
      const configPath = resolve(legacyModule);
      let config;
      try { config = (await import(pathToFileURL(configPath).href)).default; }
      catch (error) { error.startupCode = "CONFIG_LOAD_FAILED"; throw error; }
      if (!config || typeof config.start !== "function") throw Object.assign(new TypeError("config default export must provide start()"), { startupCode: "CONFIG_INVALID" });
      app = await config.start();
      if (!app || typeof app.close !== "function") throw Object.assign(new TypeError("config start() must return an app with close()"), { startupCode: "APP_INVALID" });
    } else {
      app = await guardedStart(configFile);
      if (app.firstRun && startArgs.setup) openLocalSettingsUrl(`${app.url}/settings`);
      if (app.safeMode) await logger.event("startup", "degraded", { level: "warn", code: `SAFE_MODE_${String(recovery?.recovery?.subsystem ?? "unknown").toUpperCase()}` });
    }
  } catch (error) {
    await logger.event("startup", "failed", { level: "error", code: error?.startupCode ?? "START_FAILED" });
    if (error instanceof StartupError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  await logger.event("startup", "ok");
  const close = async () => {
    // A deliberate stop after a successful start is not a crash (#497).
    await recovery?.cleanShutdown?.();
    await (recovery?.app ?? app).close();
    await logger.event("startup", "stopped");
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  // The tray stays open while a WebUI configuration change restarts the app.
  if (process.platform === "win32" && !legacyModule && startArgs.tray && existsSync(resolve("nowplaying.exe"))) {
    const session = await runTraySession({
      app,
      runTray: (current) => runTrayProcess(`${current.url}/`),
      restartApp: async () => { await recovery?.retryNormal(); return guardedStart(configFile); },
      onRestart: (current) => { app = current; },
      restartRequests,
    });
    await logger.event("tray", session.outcome, session.outcome === "restart-failed" ? { level: "error", code: session.error?.startupCode ?? "START_FAILED" } : {});
    if (session.outcome === "quit") { await recovery?.cleanShutdown?.(); await logger.event("startup", "stopped"); process.exit(0); }
    if (session.outcome === "restart-failed") { console.error(session.error?.message ?? "NowPlaying couldn't restart."); process.exit(1); }
  }
} else if (command === "setup") {
  console.error("Setup is in the WebUI. Run `nowplaying.exe start` and open Settings.");
  process.exitCode = 2;
} else if (command === "help" || command === "--help") {
  console.log("Usage: nowplaying.exe start            (opens WebUI Settings the first time)\n       nowplaying.exe start [--no-setup] [--no-tray]\n       nowplaying.exe start <config.mjs>\n       nowplaying.exe --version\n       nowplaying.exe --help");
} else {
  console.error(`nowplaying: unknown command: ${command}`);
  process.exitCode = 2;
}

// %LOCALAPPDATA% may be absent in a damaged profile or service context.
function windowsDataPaths() {
  try { return { configFile: windowsConfigPath({ localAppData: process.env.LOCALAPPDATA }) }; }
  catch {
    console.error("nowplaying: LOCALAPPDATA is not set, so NowPlaying cannot find its data folder. Sign in again or repair the user profile, then retry.");
    process.exit(1);
  }
}

// "Start with Windows" is offered only from the installed/portable bundle,
// where the launchers sit next to the app folder. The shortcut uses the
// no-console launcher when the bundle has it. Setup and the settings page
// share it.
function windowsStartup() {
  const launcher = existsSync(resolve("nowplayingw.exe")) ? resolve("nowplayingw.exe") : resolve("nowplaying.exe");
  return process.platform === "win32" && process.env.APPDATA && existsSync(launcher)
    ? createWindowsStartup({ appData: process.env.APPDATA, exePath: launcher })
    : undefined;
}

// Crash-loop protection for the installed app (#122): after three starts in a
// row that never stayed up, the next one runs in safe mode.
async function guardedStart(configFile) {
  recovery?.cancel();
  const store = createStartupRecoveryStore({ file: resolve(dirname(configFile), "startup-recovery.json") });
  recovery = await guardStartup({ store, start: ({ safeMode }) => startFromWebConfig(configFile, { safeMode }) });
  return recovery.app;
}

async function startFromWebConfig(configFile, { safeMode = false } = {}) {
  const adapter = createWindowsCredentialAdapter();
  const credentialStore = createCredentialStore({ adapter });
  const hostedCredentials = createHostedCredentials({ adapter });
  const manifest = JSON.parse(await readFile(resolve("app", "package.json"), "utf8").catch(() => "{}"));
  // build-info.json is written by build-windows.ps1; a source checkout has none.
  let build = null;
  try { build = JSON.parse(await readFile(resolve("app", "build-info.json"), "utf8")); } catch { build = null; }
  const packageType = existsSync(resolve("unins000.exe")) ? "installer" : "portable";
  const deviceId = await loadOrCreateDeviceId(resolve(dirname(configFile), "device-id"));
  const app = await startAppFromConfig({ configFile, credentialStore, hostedCredentials, deviceId, onConfigured: () => {
    if (process.platform === "win32" && existsSync(resolve("nowplaying.exe")) && !process.argv.includes("--no-tray")) restartRequests.request();
    else void restartWithoutTray(configFile);
  }, port: resolveAppPort(), version: typeof manifest.version === "string" ? manifest.version : null, build, packageType, safeMode, startup: windowsStartup(), logFile: process.env.LOCALAPPDATA ? windowsLogPath({ localAppData: process.env.LOCALAPPDATA }) : null });
  if (app.firstRun) { console.log(`NowPlaying Settings: ${app.url}/settings`); return app; }
  console.log(safeMode
    ? `NowPlaying started in safe mode after repeated failed starts: Discord and hosted uploads are off. Change your settings in the WebUI to go back to normal. Card: ${app.url}/card.svg`
    : `NowPlaying is running. Card: ${app.url}/card.svg`);
  return app;
}

// Runs the tray icon and resolves with its exit code (0 quit).
function runTrayProcess(dashboardUrl) {
  const scriptPath = fileURLToPath(new URL("./windows-tray.ps1", import.meta.url));
  const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-STA", "-WindowStyle", "Hidden", "-File", scriptPath, "-DashboardUrl", dashboardUrl];
  return new Promise((resolvePromise, reject) => {
    const child = spawn("powershell.exe", args, { shell: false, windowsHide: true, stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise(code));
  });
}

let restartingWithoutTray = false;
async function restartWithoutTray(configFile) {
  if (restartingWithoutTray) return;
  restartingWithoutTray = true;
  try {
    await recovery?.app?.close();
    await recovery?.retryNormal();
    const next = await guardedStart(configFile);
    console.log(next.firstRun ? `NowPlaying Settings: ${next.url}/settings` : `NowPlaying is running. Card: ${next.url}/card.svg`);
  } catch (error) { console.error(`NowPlaying couldn't restart after settings changed: ${error.message}`); }
  finally { restartingWithoutTray = false; }
}
