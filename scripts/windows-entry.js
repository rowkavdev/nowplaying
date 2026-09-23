import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createAppLogger } from "../src/app-log.js";
import { StartupError, resolveAppPort, startAppFromConfig } from "../src/app-config.js";
import { createCredentialStore } from "../src/credential-store.js";
import { loadOrCreateDeviceId, openSetupUrl, runNativeSetup, startSetupApp, windowsConfigPath, windowsSetupDraftPath } from "../src/setup-app.js";
import { createWindowsCredentialAdapter } from "../src/windows-credential-adapter.js";
import { createWindowsStartup } from "../src/windows-startup.js";
import { ensureConfigured, parseStartArgs } from "../src/first-run.js";
import { runTraySession } from "../src/tray-session.js";
import { spawn } from "node:child_process";

const command = process.argv[2] ?? "help";

if (command === "--version" || command === "version") {
  const manifest = JSON.parse(await readFile(resolve("app", "package.json"), "utf8"));
  console.log(manifest.version);
} else if (command === "start") {
  const logger = createAppLogger();
  await logger.event("startup", "starting");
  let app;
  let startArgs;
  let legacyModule;
  const configFile = windowsConfigPath({ localAppData: process.env.LOCALAPPDATA });
  try {
    try { startArgs = parseStartArgs(process.argv.slice(3)); }
    catch (error) { console.error(`nowplaying: ${error.message}`); process.exit(2); }
    // An explicit config module wins. With no argument, the wizard's config is
    // used; installs from before the wizard keep their nowplaying.config.mjs.
    legacyModule = startArgs.module ?? (!existsSync(configFile) && existsSync(resolve("nowplaying.config.mjs")) ? "nowplaying.config.mjs" : null);
    // First launch: no config yet, so open setup instead of failing. `start
    // --no-setup` (scripts, CI) keeps the plain "run setup" message.
    if (!legacyModule && startArgs.setup && process.platform === "win32" && !existsSync(configFile)) {
      console.log("NowPlaying isn't set up yet. Opening setup...");
      const outcome = await ensureConfigured({ configExists: () => existsSync(configFile), runSetup: () => openSetupWindow() });
      await logger.event("startup", "first_run_setup", { code: outcome });
    }
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
      // The config written by `nowplaying.exe setup`; the sign-in comes from Credential Manager.
      app = await startFromWizardConfig(configFile);
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
    await app.close();
    await logger.event("startup", "stopped");
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  // The tray runs alongside the installed app (not hand-written configs, not
  // dev checkouts). Quit closes the app; "Run setup again" restarts it.
  if (process.platform === "win32" && !legacyModule && startArgs.tray && existsSync(resolve("nowplaying.exe"))) {
    const session = await runTraySession({
      app,
      runTray: (current) => runTrayProcess(`${current.url}/`),
      runSetup: () => openSetupWindow(),
      restartApp: () => startFromWizardConfig(configFile),
      onRestart: (current) => { app = current; },
    });
    await logger.event("tray", session.outcome, session.outcome === "restart-failed" ? { level: "error", code: session.error?.startupCode ?? "START_FAILED" } : {});
    if (session.outcome === "quit") { await logger.event("startup", "stopped"); process.exit(0); }
    if (session.outcome === "restart-failed") { console.error(session.error?.message ?? "NowPlaying couldn't restart."); process.exit(1); }
  }
} else if (command === "setup") {
  const setup = await startSetup();
  const close = async () => { await setup.close(); };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  const flags = new Set(process.argv.slice(3));
  let native = process.platform === "win32" && !flags.has("--browser") && !flags.has("--no-open");
  if (native) {
    try {
      const { code } = await runNativeSetup(setup.url, { sessionSecret: setup.sessionSecret, scriptPath: fileURLToPath(new URL("./windows-setup.ps1", import.meta.url)) });
      if (code === 0) await close();
      else native = false; // the window failed to start or crashed: keep the server and use the browser page
    } catch {
      native = false; // PowerShell unavailable or blocked: use the browser page instead
    }
  }
  if (!native) {
    console.log(`NowPlaying setup is open at ${setup.url}`);
    if (!flags.has("--no-open")) openSetupUrl(setup.url);
  }
} else if (command === "help" || command === "--help") {
  console.log("Usage: nowplaying.exe start            (runs from the setup config; opens setup the first time)\n       nowplaying.exe start [--no-setup] [--no-tray]\n       nowplaying.exe start <config.mjs>\n       nowplaying.exe setup [--browser | --no-open]\n       nowplaying.exe --version\n       nowplaying.exe --help");
} else {
  console.error(`nowplaying: unknown command: ${command}`);
  process.exitCode = 2;
}

async function startSetup() {
  const draftFile = windowsSetupDraftPath({ localAppData: process.env.LOCALAPPDATA });
  const deviceId = await loadOrCreateDeviceId(resolve(dirname(draftFile), "device-id"));
  const manifest = JSON.parse(await readFile(resolve("app", "package.json"), "utf8").catch(() => "{}"));
  const credentialStore = createCredentialStore({ adapter: createWindowsCredentialAdapter() });
  const configFile = windowsConfigPath({ localAppData: process.env.LOCALAPPDATA });
  // "Start with Windows" is offered only from the installed/portable bundle,
  // where the launchers sit next to the app folder. The shortcut uses the
  // no-console launcher when the bundle has it.
  const launcher = existsSync(resolve("nowplayingw.exe")) ? resolve("nowplayingw.exe") : resolve("nowplaying.exe");
  const startup = process.platform === "win32" && process.env.APPDATA && existsSync(launcher)
    ? createWindowsStartup({ appData: process.env.APPDATA, exePath: launcher })
    : undefined;
  return startSetupApp({ draftFile, configFile, credentialStore, deviceId, version: manifest.version, startup });
}

// Shows the native setup window and resolves true once it closes normally.
async function openSetupWindow() {
  const setup = await startSetup();
  try {
    const { code } = await runNativeSetup(setup.url, { sessionSecret: setup.sessionSecret, scriptPath: fileURLToPath(new URL("./windows-setup.ps1", import.meta.url)) });
    return code === 0;
  } finally {
    await setup.close();
  }
}

async function startFromWizardConfig(configFile) {
  const credentialStore = createCredentialStore({ adapter: createWindowsCredentialAdapter() });
  const manifest = JSON.parse(await readFile(resolve("app", "package.json"), "utf8").catch(() => "{}"));
  // build-info.json is written by build-windows.ps1; a source checkout has none.
  let build = null;
  try { build = JSON.parse(await readFile(resolve("app", "build-info.json"), "utf8")); } catch { build = null; }
  const packageType = existsSync(resolve("unins000.exe")) ? "installer" : "portable";
  const app = await startAppFromConfig({ configFile, credentialStore, port: resolveAppPort(), version: typeof manifest.version === "string" ? manifest.version : null, build, packageType });
  console.log(`NowPlaying is running. Card: ${app.url}/card.svg`);
  return app;
}

// Runs the tray icon and resolves with its exit code (0 quit, 3 run setup).
function runTrayProcess(dashboardUrl) {
  const scriptPath = fileURLToPath(new URL("./windows-tray.ps1", import.meta.url));
  const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-STA", "-WindowStyle", "Hidden", "-File", scriptPath, "-DashboardUrl", dashboardUrl, "-CanRunSetup"];
  return new Promise((resolvePromise, reject) => {
    const child = spawn("powershell.exe", args, { shell: false, windowsHide: true, stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise(code));
  });
}
