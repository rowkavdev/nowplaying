#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createAppLogger } from "../src/app-log.js";
import { StartupError, resolveAppPort, startAppFromConfig } from "../src/app-config.js";
import { appPaths } from "../src/app-paths.js";
import { createCredentialStore } from "../src/credential-store.js";
import { createHostedCredentials } from "../src/hosted-credentials.js";
import { createPlatformCredentialAdapter } from "../src/platform-credential-adapter.js";
import { loadOrCreateDeviceId, openLocalSettingsUrl } from "../src/setup-app.js";
import { createStartupRecoveryStore, guardStartup } from "../src/startup-recovery-store.js";

// Linux and macOS entry point (#215): the server and card without the tray.
// Settings open in the browser, sign-ins go to the OS keychain and files live
// where appPaths puts them. Windows keeps scripts/windows-entry.js.

const USAGE = `Usage: nowplaying start [--no-setup]   (opens WebUI Settings the first time)
       nowplaying --version
       nowplaying --help`;

const manifestFile = new URL("../package.json", import.meta.url);
const command = process.argv[2] ?? "help";
const args = process.argv.slice(3);
let recovery;
let liveApp = null;

if (command === "--version" || command === "version") {
  console.log(JSON.parse(await readFile(manifestFile, "utf8")).version);
} else if (command === "start") {
  await start();
} else if (command === "setup") {
  console.error("Setup is in the WebUI. Run `nowplaying start` and open Settings.");
  process.exitCode = 2;
} else if (command === "help" || command === "--help") {
  console.log(USAGE);
} else {
  console.error(`nowplaying: unknown command: ${command}`);
  process.exitCode = 2;
}

async function start() {
  const unknown = args.find((arg) => arg !== "--no-setup");
  if (unknown) { console.error(`nowplaying: unknown start option: ${unknown}`); process.exit(2); }
  const paths = dataPaths();
  const logger = createAppLogger({ file: paths.logFile });
  await logger.event("startup", "starting");
  let app;
  try {
    app = await guardedStart(paths);
    liveApp = app;
    if (app.firstRun && !args.includes("--no-setup")) openLocalSettingsUrl(`${app.url}/settings`);
    if (app.safeMode) await logger.event("startup", "degraded", { level: "warn", code: `SAFE_MODE_${String(recovery?.recovery?.subsystem ?? "unknown").toUpperCase()}` });
  } catch (error) {
    await logger.event("startup", "failed", { level: "error", code: error?.startupCode ?? "START_FAILED" });
    if (error instanceof StartupError) {
      // Startup messages name the Windows command; point at this one instead.
      console.error(error.message.replaceAll("`nowplaying.exe ", "`nowplaying "));
      process.exit(1);
    }
    throw error;
  }
  await logger.event("startup", "ok");
  const close = async () => {
    // A deliberate stop after a successful start is not a crash (#497).
    await recovery?.cleanShutdown?.();
    await liveApp.close();
    await logger.event("startup", "stopped");
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

async function version() {
  try { return JSON.parse(await readFile(manifestFile, "utf8")).version ?? null; }
  catch { return null; }
}

// A missing HOME is a configuration error, not a raw TypeError.
function dataPaths() {
  try { return appPaths(); }
  catch {
    console.error("nowplaying: HOME is not set, so NowPlaying cannot find its data folder. Set HOME and retry.");
    process.exit(1);
  }
}

// Crash-loop protection (#122), as on Windows: after three starts in a row
// that never stayed up, the next one runs in safe mode.
async function guardedStart(paths) {
  recovery?.cancel();
  const store = createStartupRecoveryStore({ file: join(dirname(paths.configFile), "startup-recovery.json") });
  recovery = await guardStartup({ store, start: ({ safeMode }) => startFromConfig(paths, { safeMode }) });
  return recovery.app;
}

async function startFromConfig(paths, { safeMode = false } = {}) {
  const adapter = createPlatformCredentialAdapter();
  const deviceId = await loadOrCreateDeviceId(paths.deviceIdFile);
  const app = await startAppFromConfig({
    deviceId,
    onConfigured: () => { void restartAfterConfiguration(paths); },
    configFile: paths.configFile,
    credentialStore: createCredentialStore({ adapter }),
    hostedCredentials: createHostedCredentials({ adapter }),
    port: resolveAppPort(),
    version: await version(),
    packageType: "source",
    safeMode,
    logFile: paths.logFile,
  });
  if (app.firstRun) { console.log(`NowPlaying Settings: ${app.url}/settings`); return app; }
  console.log(safeMode
    ? `NowPlaying started in safe mode after repeated failed starts: Discord and hosted uploads are off. Use WebUI Settings to go back to normal. Card: ${app.url}/card.svg`
    : `NowPlaying is running. Card: ${app.url}/card.svg`);
  return app;
}

// A successful server save has already answered the browser before this fires.
let restarting = false;
async function restartAfterConfiguration(paths) {
  if (restarting) return;
  restarting = true;
  try {
    await liveApp.close();
    await recovery?.retryNormal();
    const next = await guardedStart(paths);
    liveApp = next;
    console.log(next.firstRun ? `NowPlaying Settings: ${next.url}/settings` : `NowPlaying is running. Card: ${next.url}/card.svg`);
  } catch (error) {
    console.error(`NowPlaying couldn't restart after the settings changed: ${error.message}`);
  } finally { restarting = false; }
}
