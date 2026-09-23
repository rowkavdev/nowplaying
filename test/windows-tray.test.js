import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// Windows CI: builds the real tray menu in self-test mode (never shown).
const SCRIPT = fileURLToPath(new URL("../scripts/windows-tray.ps1", import.meta.url));
const ICON = fileURLToPath(new URL("../assets/nowplaying.ico", import.meta.url));
const windows = { skip: process.platform !== "win32" };

function selfTest(scriptPath, extra = []) {
  const out = execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-STA", "-File", scriptPath, "-SelfTest", ...extra], { encoding: "utf8", windowsHide: true });
  return JSON.parse(out);
}

test("tray menu offers Run setup again when the app can restart", windows, () => {
  const result = selfTest(SCRIPT, ["-CanRunSetup"]);
  assert.deepEqual(result.items, ["NowPlaying: starting...", "", "Open dashboard", "Run setup again", "Open log folder", "", "Quit NowPlaying"]);
});

test("tray menu hides Run setup again otherwise", windows, () => {
  assert.deepEqual(selfTest(SCRIPT).items, ["NowPlaying: starting...", "", "Open dashboard", "Open log folder", "", "Quit NowPlaying"]);
});

test("tray finds the icon in the bundle layout (app\\scripts next to assets)", windows, async () => {
  const bundle = await mkdtemp(join(tmpdir(), "np-tray-"));
  await mkdir(join(bundle, "app", "scripts"), { recursive: true });
  await mkdir(join(bundle, "assets"), { recursive: true });
  const script = join(bundle, "app", "scripts", "windows-tray.ps1");
  await copyFile(SCRIPT, script);
  await copyFile(ICON, join(bundle, "assets", "nowplaying.ico"));
  const result = selfTest(script);
  // Compare long paths: %TEMP% can be an 8.3 short path (RUNNER~1) on runners.
  const expected = await realpath(join(bundle, "assets", "nowplaying.ico"));
  assert.equal((await realpath(result.icon)).toLowerCase(), expected.toLowerCase());
});
