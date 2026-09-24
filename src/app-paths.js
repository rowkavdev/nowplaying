import { posix, win32 } from "node:path";
import { windowsLogPath } from "./app-log.js";
import { windowsConfigPath, windowsSetupDraftPath } from "./setup-app.js";

// Where NowPlaying keeps its files on each OS (#215). Windows is unchanged
// (%LOCALAPPDATA%\nowplaying). Linux follows the XDG base directory spec;
// macOS uses Application Support for data and Library/Logs for the log.
// Nothing here creates folders; callers do that when they write.
export function appPaths({ platform = process.platform, env = process.env, home = env?.HOME, appName = "nowplaying" } = {}) {
  if (platform === "win32") {
    const localAppData = env?.LOCALAPPDATA;
    const draftFile = windowsSetupDraftPath({ localAppData, appName });
    return Object.freeze({
      configFile: windowsConfigPath({ localAppData, appName }),
      draftFile,
      deviceIdFile: win32.join(win32.dirname(draftFile), "device-id"),
      logFile: windowsLogPath({ localAppData, appName }),
    });
  }
  if (typeof home !== "string" || !posix.isAbsolute(home)) throw new TypeError("HOME is required");
  let dataDir;
  let logDir;
  if (platform === "darwin") {
    dataDir = posix.join(home, "Library", "Application Support", appName);
    logDir = posix.join(home, "Library", "Logs", appName);
  } else {
    dataDir = posix.join(xdg(env?.XDG_CONFIG_HOME) ?? posix.join(home, ".config"), appName);
    logDir = posix.join(xdg(env?.XDG_STATE_HOME) ?? posix.join(home, ".local", "state"), appName, "logs");
  }
  return Object.freeze({
    configFile: posix.join(dataDir, "config.json"),
    draftFile: posix.join(dataDir, "setup-draft.json"),
    deviceIdFile: posix.join(dataDir, "device-id"),
    logFile: posix.join(logDir, "nowplaying.log"),
  });
}

// The XDG spec says relative paths in these variables are invalid and must be ignored.
function xdg(value) {
  return typeof value === "string" && posix.isAbsolute(value) ? value : null;
}
