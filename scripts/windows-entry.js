import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createAppLogger } from "../src/app-log.js";
import { openSetupUrl, runNativeSetup, startSetupApp, windowsSetupDraftPath } from "../src/setup-app.js";

const command = process.argv[2] ?? "help";

if (command === "--version" || command === "version") {
  const manifest = JSON.parse(await readFile(resolve("app", "package.json"), "utf8"));
  console.log(manifest.version);
} else if (command === "start") {
  const logger = createAppLogger();
  await logger.event("startup", "starting");
  let app;
  try {
    const configPath = resolve(process.argv[3] ?? "nowplaying.config.mjs");
    let config;
    try { config = (await import(pathToFileURL(configPath).href)).default; }
    catch (error) { error.startupCode = "CONFIG_LOAD_FAILED"; throw error; }
    if (!config || typeof config.start !== "function") throw Object.assign(new TypeError("config default export must provide start()"), { startupCode: "CONFIG_INVALID" });
    app = await config.start();
    if (!app || typeof app.close !== "function") throw Object.assign(new TypeError("config start() must return an app with close()"), { startupCode: "APP_INVALID" });
  } catch (error) {
    await logger.event("startup", "failed", { level: "error", code: error?.startupCode ?? "START_FAILED" });
    throw error;
  }
  await logger.event("startup", "ok");
  const close = async () => {
    await app.close();
    await logger.event("startup", "stopped");
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
} else if (command === "setup") {
  const draftFile = windowsSetupDraftPath({ localAppData: process.env.LOCALAPPDATA });
  const setup = await startSetupApp({ draftFile });
  const close = async () => { await setup.close(); };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  const flags = new Set(process.argv.slice(3));
  let native = process.platform === "win32" && !flags.has("--browser") && !flags.has("--no-open");
  if (native) {
    try {
      const { code } = await runNativeSetup(setup.url, { scriptPath: fileURLToPath(new URL("./windows-setup.ps1", import.meta.url)) });
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
  console.log("Usage: nowplaying.exe start [config.mjs]\n       nowplaying.exe setup [--browser | --no-open]\n       nowplaying.exe --version\n       nowplaying.exe --help");
} else {
  console.error(`nowplaying: unknown command: ${command}`);
  process.exitCode = 2;
}
