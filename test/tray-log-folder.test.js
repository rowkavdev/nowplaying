import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { windowsLogFolder, windowsLogPath } from "../src/app-log.js";

const script = await readFile(new URL("../scripts/windows-tray.ps1", import.meta.url), "utf8");

test("log folder is the parent of the rotating log file", () => {
  const localAppData = "C:\\Users\\rowan\\AppData\\Local";
  assert.equal(windowsLogFolder({ localAppData }), "C:\\Users\\rowan\\AppData\\Local\\nowplaying\\logs");
  assert.equal(windowsLogPath({ localAppData }).startsWith(`${windowsLogFolder({ localAppData })}\\`), true);
  assert.throws(() => windowsLogFolder({}), /LOCALAPPDATA is required/);
});

test("tray offers Open log folder at the same fixed per-user path", () => {
  assert.match(script, /Items\.Add\('Open log folder'\)/);
  assert.match(script, /Join-Path \$env:LOCALAPPDATA 'nowplaying\\logs'/);
  assert.match(script, /Start-Process -FilePath 'explorer\.exe'/);
});

test("log folder action takes no path from overridable settings", () => {
  const action = script.slice(script.indexOf("Open log folder"), script.indexOf("Exit tray"));
  assert.doesNotMatch(action, /NOWPLAYING_|\$DashboardUrl|param\(/);
  assert.doesNotMatch(action, /Invoke-Expression|iex /i);
});
