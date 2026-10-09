#!/usr/bin/env node
import { createLinuxTray, linuxTrayAvailable, openLinuxWebUiUrl } from "../src/linux-tray.js";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAppLogger } from "../src/app-log.js";
import {
  StartupError,
  resolveAppPort,
  startAppFromConfig,
} from "../src/app-config.js";
import { appPaths } from "../src/app-paths.js";
import { createCredentialStore } from "../src/credential-store.js";
import { createHostedCredentials } from "../src/hosted-credentials.js";
import { createPlatformCredentialAdapter } from "../src/platform-credential-adapter.js";
import { createLinuxStartup, xdgAutostartDir } from "../src/linux-startup.js";
import { createMacosStartup, launchAgentsDir } from "../src/macos-startup.js";
import {
  loadOrCreateDeviceId,
  openLocalSettingsUrl,
} from "../src/setup-app.js";
import {
  createStartupRecoveryStore,
  guardStartup,
} from "../src/startup-recovery-store.js";

// Linux/macOS entry point. Linux graphical sessions also run a native tray.
// Settings open in the browser, sign-ins go to the OS keychain and files live
// where appPaths puts them. Windows keeps scripts/windows-entry.js.

const USAGE = `Usage: nowplaying start [--no-setup] [--no-tray]   (opens WebUI Settings the first time)
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
  console.error(
    "Setup is in the WebUI. Run `nowplaying start` and open Settings.",
  );
  process.exitCode = 2;
} else if (command === "help" || command === "--help") {
  console.log(USAGE);
} else {
  console.error(`nowplaying: unknown command: ${command}`);
  process.exitCode = 2;
}

async function start() {
  const unknown = args.find((arg) => arg !== "--no-setup" && arg !== "--no-tray");
  if (unknown) {
    console.error(`nowplaying: unknown start option: ${unknown}`);
    process.exit(2);
  }
  const paths = dataPaths();
  const logger = createAppLogger({ file: paths.logFile });
  await logger.event("startup", "starting");
  let app;
  try {
    app = await guardedStart(paths);
    liveApp = app;
    if (app.firstRun && !args.includes("--no-setup"))
      (process.platform === "linux" ? openLinuxWebUiUrl : openLocalSettingsUrl)(`${app.url}/settings`);
    if (app.safeMode)
      await logger.event("startup", "degraded", {
        level: "warn",
        code: `SAFE_MODE_${String(recovery?.recovery?.subsystem ?? "unknown").toUpperCase()}`,
      });
  } catch (error) {
    await logger.event("startup", "failed", {
      level: "error",
      code: error?.startupCode ?? "START_FAILED",
    });
    if (error instanceof StartupError) {
      // Startup messages name the Windows command; point at this one instead.
      console.error(
        error.message.replaceAll("`nowplaying.exe ", "`nowplaying "),
      );
      process.exit(1);
    }
    throw error;
  }
  await logger.event("startup", "ok");
  let tray;
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    try {
      tray?.close();
      // A deliberate stop after a successful start is not a crash (#497).
      await recovery?.cleanShutdown?.();
    } finally {
      await liveApp.close();
      await logger.event("startup", "stopped");
    }
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  if (!args.includes("--no-tray") && linuxTrayAvailable()) {
    tray = createLinuxTray({
      url: app.url,
      isFirstRun: () => Boolean(liveApp?.firstRun),
      getUrl: () => liveApp.url,
      script: fileURLToPath(new URL("./linux-tray.py", import.meta.url)),
      icon: fileURLToPath(new URL("../assets/brand/png/icon-512.png", import.meta.url)),
      onQuit: () => { void close(); },
      onUnavailable: () => {
        console.error(`NowPlaying tray unavailable. Web UI is still running: ${app.url}/settings. Check Python GTK/AppIndicator packages and your desktop's indicator support.`);
        void logger.event("tray", "failed", { level: "warn", code: "TRAY_UNAVAILABLE" });
      },
    });
    if (await tray.ready) await logger.event("tray", "ok");
  }
}

async function version() {
  try {
    return JSON.parse(await readFile(manifestFile, "utf8")).version ?? null;
  } catch {
    return null;
  }
}

// A missing HOME is a configuration error, not a raw TypeError.
function dataPaths() {
  try {
    return appPaths();
  } catch {
    console.error(
      "nowplaying: HOME is not set, so NowPlaying cannot find its data folder. Set HOME and retry.",
    );
    process.exit(1);
  }
}

// "Start at login" on Linux and macOS (#215 slice A): the XDG autostart
// entry or LaunchAgent points at this same `node scripts/nowplaying.js
// start` command; packaged builds (slice B) pass their bundle path instead.
// Enabling takes effect at the next login, matching the Windows shortcut.
function platformStartup() {
  const script = fileURLToPath(import.meta.url);
  const args = [script, "start"];
  if (process.platform === "linux")
    return createLinuxStartup({
      autostartDir: xdgAutostartDir(),
      execPath: process.execPath,
      args,
    });
  if (process.platform === "darwin")
    return createMacosStartup({
      launchAgentsDir: launchAgentsDir(),
      programPath: process.execPath,
      programArguments: args,
    });
  return undefined;
}

// Crash-loop protection (#122), as on Windows: after three starts in a row
// that never stayed up, the next one runs in safe mode.
async function guardedStart(paths) {
  recovery?.cancel();
  const store = createStartupRecoveryStore({
    file: join(dirname(paths.configFile), "startup-recovery.json"),
  });
  recovery = await guardStartup({
    store,
    start: ({ safeMode }) => startFromConfig(paths, { safeMode }),
  });
  return recovery.app;
}

async function startFromConfig(paths, { safeMode = false } = {}) {
  const adapter = createPlatformCredentialAdapter();
  const deviceId = await loadOrCreateDeviceId(paths.deviceIdFile);
  const app = await startAppFromConfig({
    deviceId,
    onConfigured: () => {
      void restartAfterConfiguration(paths);
    },
    configFile: paths.configFile,
    credentialStore: createCredentialStore({ adapter }),
    hostedCredentials: createHostedCredentials({ adapter }),
    port: resolveAppPort(),
    version: await version(),
    packageType: "source",
    safeMode,
    logFile: paths.logFile,
    startup: platformStartup(),
  });
  if (app.firstRun) {
    console.log(`NowPlaying Settings: ${app.url}/settings`);
    return app;
  }
  console.log(
    safeMode
      ? `NowPlaying started in safe mode after repeated failed starts: Discord and hosted uploads are off. Use WebUI Settings to go back to normal. Card: ${app.url}/card.svg`
      : `NowPlaying is running. Card: ${app.url}/card.svg`,
  );
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
    console.log(
      next.firstRun
        ? `NowPlaying Settings: ${next.url}/settings`
        : `NowPlaying is running. Card: ${next.url}/card.svg`,
    );
  } catch (error) {
    console.error(
      `NowPlaying couldn't restart after the settings changed: ${error.message}`,
    );
  } finally {
    restarting = false;
  }
}
