import test from "node:test";
import assert from "node:assert/strict";
import { appPaths } from "../src/app-paths.js";
import { windowsLogPath } from "../src/app-log.js";
import { windowsConfigPath, windowsSetupDraftPath } from "../src/setup-app.js";

test("Windows paths are exactly what they were (#215)", () => {
  const env = { LOCALAPPDATA: "C:\\Users\\Rowan\\AppData\\Local" };
  const paths = appPaths({ platform: "win32", env });
  assert.equal(paths.configFile, windowsConfigPath({ localAppData: env.LOCALAPPDATA }));
  assert.equal(paths.draftFile, windowsSetupDraftPath({ localAppData: env.LOCALAPPDATA }));
  assert.equal(paths.deviceIdFile, "C:\\Users\\Rowan\\AppData\\Local\\nowplaying\\device-id");
  assert.equal(paths.logFile, windowsLogPath({ localAppData: env.LOCALAPPDATA }));
});

test("Linux follows XDG, with the usual fallbacks", () => {
  assert.deepEqual({ ...appPaths({ platform: "linux", env: {}, home: "/home/rowan" }) }, {
    configFile: "/home/rowan/.config/nowplaying/config.json",
    draftFile: "/home/rowan/.config/nowplaying/setup-draft.json",
    deviceIdFile: "/home/rowan/.config/nowplaying/device-id",
    logFile: "/home/rowan/.local/state/nowplaying/logs/nowplaying.log",
  });
  const custom = appPaths({ platform: "linux", env: { XDG_CONFIG_HOME: "/cfg", XDG_STATE_HOME: "/state" }, home: "/home/rowan" });
  assert.equal(custom.configFile, "/cfg/nowplaying/config.json");
  assert.equal(custom.logFile, "/state/nowplaying/logs/nowplaying.log");
  const relative = appPaths({ platform: "linux", env: { XDG_CONFIG_HOME: "cfg", XDG_STATE_HOME: "./state" }, home: "/home/rowan" });
  assert.equal(relative.configFile, "/home/rowan/.config/nowplaying/config.json", "relative XDG values are ignored");
  assert.equal(relative.logFile, "/home/rowan/.local/state/nowplaying/logs/nowplaying.log");
});

test("macOS uses Application Support and Library/Logs", () => {
  const paths = appPaths({ platform: "darwin", env: {}, home: "/Users/rowan" });
  assert.equal(paths.configFile, "/Users/rowan/Library/Application Support/nowplaying/config.json");
  assert.equal(paths.draftFile, "/Users/rowan/Library/Application Support/nowplaying/setup-draft.json");
  assert.equal(paths.logFile, "/Users/rowan/Library/Logs/nowplaying/nowplaying.log");
});

test("a missing or relative HOME is refused rather than writing next to the app", () => {
  assert.throws(() => appPaths({ platform: "linux", env: {}, home: undefined }), /HOME is required/);
  assert.throws(() => appPaths({ platform: "darwin", env: {}, home: "rowan" }), /HOME is required/);
  assert.throws(() => appPaths({ platform: "win32", env: {} }), /LOCALAPPDATA is required/);
});
