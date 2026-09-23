import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { windowsStartupShortcutPath } from "../src/windows-startup.js";

test("uninstall removes the Start with Windows shortcut setup can create", async () => {
  const iss = await readFile(new URL("../scripts/windows-installer.iss", import.meta.url), "utf8");
  const section = iss.split(/^\[UninstallDelete\]$/m)[1]?.split(/^\[/m)[0] ?? "";
  assert.match(section, /^Type: files; Name: "\{userstartup\}\\nowplaying\.lnk"$/m);
  assert.ok(windowsStartupShortcutPath({ appData: "C:\\Users\\a\\AppData\\Roaming" }).endsWith("\\Startup\\nowplaying.lnk"));
});

test("shortcuts and the post-install setup use the no-console launcher", async () => {
  const iss = await readFile(new URL("../scripts/windows-installer.iss", import.meta.url), "utf8");
  const icons = iss.split(/^\[Icons\]$/m)[1]?.split(/^\[/m)[0] ?? "";
  const lines = icons.split("\n").filter((line) => line.startsWith("Name:") && line.includes("Parameters:"));
  assert.equal(lines.length, 3);
  assert.match(icons, /^Name: "\{group\}\\NowPlaying"; /m);
  for (const line of lines) assert.match(line, /Filename: "\{app\}\\nowplayingw\.exe"; Parameters: "start"/);
  const run = iss.split(/^\[Run\]$/m)[1]?.split(/^\[/m)[0] ?? "";
  assert.match(run, /Filename: "\{app\}\\nowplayingw\.exe"; Parameters: "setup"/);
  assert.match(run, /Parameters: "start"; .*Check: not NeedsSetup/);
  assert.doesNotMatch(run, /nowplaying\.exe/);
  assert.match(iss, /^DisableDirPage=no$/m);
  const build = await readFile(new URL("../scripts/build-windows.ps1", import.meta.url), "utf8");
  assert.match(build, /-p:AssemblyName=nowplayingw -p:OutputType=WinExe -p:DefineConstants=NOWPLAYING_GUI/);
});
