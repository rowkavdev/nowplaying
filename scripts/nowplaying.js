#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createAppLogger } from "../src/app-log.js";
import { StartupError, resolveAppPort, startAppFromConfig } from "../src/app-config.js";
import { appPaths } from "../src/app-paths.js";
import { createCredentialStore } from "../src/credential-store.js";
import { ensureConfigured, runBrowserSetup } from "../src/first-run.js";
import { createHostedCredentials } from "../src/hosted-credentials.js";
import { createPlatformCredentialAdapter } from "../src/platform-credential-adapter.js";
import { loadOrCreateDeviceId, openSetupUrl, startSetupApp } from "../src/setup-app.js";
import { createStartupRecoveryStore, guardStartup } from "../src/startup-recovery-store.js";

// Linux and macOS entry point (#215): the server and card without the tray.
// Setup runs in the browser, sign-ins go to the OS keychain and files live
// where appPaths puts them. Windows keeps scripts/windows-entry.js.

const USAGE = `Usage: nowplaying start [--no-setup]   (opens setup in the browser the first time)
       nowplaying setup [--no-open]
       nowplaying --version
       nowplaying --help`;

const manifestFile = new URL("../package.json", import.meta.url);
const command = process.argv[2] ?? "help";
const args = process.argv.slice(3);
let recovery;

if (command === "--version" || command === "version") {
  console.log(JSON.parse(await readFile(manifestFile, "utf8")).version);
} else if (command === "start") {
  await start();
} else if (command === "setup") {
  await setup();
} else if (command === "help" || command === "--help") {
  console.log(USAGE);
} else {
  console.error(`nowplaying: unknown command: ${command}`);
  process.exitCode = 2;
}

async function start() {
  const unknown = args.find((arg) => arg !== "--no-setup");
  if (unknown) { console.error(`nowplaying: unknown start option: ${unknown}`); process.exit(2); }
  const paths = appPaths();
  const logger = createAppLogger({ file: paths.logFile });
  await logger.event("startup", "starting");
  let app;
  try {
    if (!args.includes("--no-setup") && !existsSync(paths.configFile)) {
      console.log("NowPlaying isn't set up yet. Opening setup in your browser...");
      const outcome = await ensureConfigured({ configExists: () => existsSync(paths.configFile), runSetup: () => browserSetup(paths) });
      await logger.event("startup", "first_run_setup", { code: outcome });
    }
    app = await guardedStart(paths);
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
    await app.close();
    await logger.event("startup", "stopped");
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

async function setup() {
  const unknown = args.find((arg) => arg !== "--no-open");
  if (unknown) { console.error(`nowplaying: unknown setup option: ${unknown}`); process.exit(2); }
  const server = await startSetup(appPaths());
  const close = async () => { await server.close(); };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  console.log(`NowPlaying setup is open at ${server.url}`);
  if (!args.includes("--no-open")) openSetupUrl(server.url);
}

async function version() {
  try { return JSON.parse(await readFile(manifestFile, "utf8")).version ?? null; }
  catch { return null; }
}

async function startSetup(paths) {
  const deviceId = await loadOrCreateDeviceId(paths.deviceIdFile);
  const adapter = createPlatformCredentialAdapter();
  const credentialStore = createCredentialStore({ adapter });
  return startSetupApp({ draftFile: paths.draftFile, configFile: paths.configFile, credentialStore, hostedCredentials: createHostedCredentials({ adapter }), deviceId, version: await version() });
}

// Opens the setup page and resolves once setup has written the config (or timed out).
async function browserSetup(paths) {
  const server = await startSetup(paths);
  // Printed too, for headless boxes where no browser opens.
  console.log(`Setup: ${server.url}`);
  try {
    return await runBrowserSetup({ url: server.url, openUrl: (url) => openSetupUrl(url), configExists: () => existsSync(paths.configFile) });
  } finally {
    await server.close();
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
  const app = await startAppFromConfig({
    configFile: paths.configFile,
    credentialStore: createCredentialStore({ adapter }),
    hostedCredentials: createHostedCredentials({ adapter }),
    port: resolveAppPort(),
    version: await version(),
    packageType: "source",
    safeMode,
    logFile: paths.logFile,
  });
  console.log(safeMode
    ? `NowPlaying started in safe mode after repeated failed starts: Discord and hosted uploads are off. Run \`nowplaying setup\` to go back to normal. Card: ${app.url}/card.svg`
    : `NowPlaying is running. Card: ${app.url}/card.svg`);
  return app;
}
