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
