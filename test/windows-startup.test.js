import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWindowsStartup, windowsStartupShortcutPath } from "../src/windows-startup.js";

const windows = { skip: process.platform !== "win32" };

test("the startup shortcut is the installer's {userstartup}\\nowplaying.lnk", () => {
  assert.equal(
    windowsStartupShortcutPath({ appData: "C:\\Users\\R\\AppData\\Roaming" }),
    "C:\\Users\\R\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\nowplaying.lnk",
  );
  assert.throws(() => windowsStartupShortcutPath({}), /APPDATA/);
});

test("rejects a launcher path that isn't an absolute .exe", () => {
  assert.throws(() => createWindowsStartup({ appData: "C:\\x", exePath: "nowplaying.exe" }), /exePath/);
  assert.throws(() => createWindowsStartup({ appData: "C:\\x", exePath: "C:\\x\\nowplaying.cmd" }), /exePath/);
});

test("turning it on passes paths to PowerShell only through the environment", async () => {
  const calls = [];
  const startup = createWindowsStartup({ appData: "C:\\Users\\R\\AppData\\Roaming", exePath: "C:\\Program Files\\nowplaying\\nowplaying.exe", run: async (script, env) => { calls.push([script, env]); } });
  await startup.setEnabled(true);
  assert.equal(calls.length, 1);
  const [script, env] = calls[0];
  assert.doesNotMatch(script, /Program Files|Roaming/);
  assert.match(script, /\$link\.Arguments = 'start'/);
  assert.deepEqual(env, {
    NP_SHORTCUT: startup.shortcut,
    NP_TARGET: "C:\\Program Files\\nowplaying\\nowplaying.exe",
    NP_WORKDIR: "C:\\Program Files\\nowplaying",
  });
  await assert.rejects(startup.setEnabled("yes"), /boolean/);
});

test("turning it off removes the shortcut, and is fine when there is none", windows, async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-startup-"));
  const exePath = join(dir, "nowplaying.exe");
  await writeFile(exePath, "fixture");
  const startup = createWindowsStartup({ appData: dir, exePath, run: async () => exePath });
  assert.equal(await startup.isEnabled(), false);
  await startup.setEnabled(false);
  await mkdir(join(startup.shortcut, ".."), { recursive: true });
  await writeFile(startup.shortcut, "x");
  assert.equal(await startup.isEnabled(), true);
  await startup.setEnabled(false);
  assert.equal(await startup.isEnabled(), false);
});

// Windows CI: a real shortcut through WScript.Shell, read back, then removed.
test("writes a real startup shortcut to nowplaying.exe start, then removes it", windows, async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-startup-"));
  const exePath = join(dir, "App Folder", "nowplaying.exe");
  await mkdir(join(dir, "App Folder"));
  await writeFile(exePath, "fixture");
  const startup = createWindowsStartup({ appData: dir, exePath });
  await startup.setEnabled(true);
  assert.equal(await startup.isEnabled(), true);
  assert.deepEqual(await startup.status(), { enabled: true, broken: false });
  assert.ok((await stat(startup.shortcut)).size > 0);
  const { execFileSync } = await import("node:child_process");
  const read = execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
    "$l = (New-Object -ComObject WScript.Shell).CreateShortcut($env:NP_SHORTCUT); @{ target = $l.TargetPath; args = $l.Arguments; dir = $l.WorkingDirectory } | ConvertTo-Json -Compress"],
  { env: { ...process.env, NP_SHORTCUT: startup.shortcut }, encoding: "utf8", windowsHide: true });
  assert.deepEqual(JSON.parse(read), { target: exePath, args: "start", dir: join(dir, "App Folder") });
  await startup.setEnabled(false);
  assert.equal(await startup.isEnabled(), false);
  await assert.rejects(readFile(startup.shortcut), { code: "ENOENT" });
});


test("moved portable folder reports a stale shortcut and repairs it on Save", windows, async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-startup-move-"));
  const oldDir = join(dir, "old");
  const newDir = join(dir, "new");
  await mkdir(oldDir);
  await writeFile(join(oldDir, "nowplayingw.exe"), "fixture");
  const old = createWindowsStartup({ appData: dir, exePath: join(oldDir, "nowplayingw.exe") });
  const moved = createWindowsStartup({ appData: dir, exePath: join(newDir, "nowplayingw.exe") });
  await old.setEnabled(true);
  try {
    assert.deepEqual(await old.status(), { enabled: true, broken: false });
    await rename(oldDir, newDir);
    assert.deepEqual(await moved.status(), { enabled: false, broken: true });
    assert.equal(await moved.isEnabled(), false);
    await moved.setEnabled(true);
    assert.deepEqual(await moved.status(), { enabled: true, broken: false });
  } finally { await moved.setEnabled(false); }
});


test("a different existing executable never counts as this install", windows, async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-startup-other-"));
  const oldDir = join(dir, "old");
  const newDir = join(dir, "new");
  await mkdir(oldDir); await mkdir(newDir);
  await writeFile(join(oldDir, "nowplayingw.exe"), "old");
  await writeFile(join(newDir, "nowplayingw.exe"), "new");
  const old = createWindowsStartup({ appData: dir, exePath: join(oldDir, "nowplayingw.exe") });
  const other = createWindowsStartup({ appData: dir, exePath: join(newDir, "nowplayingw.exe") });
  await old.setEnabled(true);
  try {
    assert.deepEqual(await old.status(), { enabled: true, broken: false });
    assert.deepEqual(await other.status(), { enabled: false, broken: true });
  } finally { await old.setEnabled(false); }
});


test("matching path text without an executable is still a broken shortcut", windows, async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-startup-missing-"));
  const exePath = join(dir, "missing", "nowplayingw.exe");
  const startup = createWindowsStartup({ appData: dir, exePath });
  await startup.setEnabled(true);
  try { assert.deepEqual(await startup.status(), { enabled: false, broken: true }); }
  finally { await startup.setEnabled(false); }
});

test("8.3 alias and expanded Windows shortcut target name the same file", windows, async (t) => {
  const { execFileSync } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "np-startup-alias-"));
  const longDir = join(dir, "Long Folder Name");
  await mkdir(longDir);
  await writeFile(join(longDir, "nowplayingw.exe"), "fixture");
  const shortDir = execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
    "(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:NP_DIR).ShortPath"],
  { env: { ...process.env, NP_DIR: longDir }, encoding: "utf8", windowsHide: true }).trim();
  if (shortDir.toLowerCase() === longDir.toLowerCase()) return t.skip("8.3 aliases unavailable on this volume");
  const shortExe = join(shortDir, "nowplayingw.exe");
  const startup = createWindowsStartup({ appData: dir, exePath: shortExe });
  await startup.setEnabled(true);
  try {
    const target = execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
      "(New-Object -ComObject WScript.Shell).CreateShortcut($env:NP_SHORTCUT).TargetPath"],
    { env: { ...process.env, NP_SHORTCUT: startup.shortcut }, encoding: "utf8", windowsHide: true }).trim();
    assert.notEqual(target.toLowerCase(), shortExe.toLowerCase(), "WScript expanded the 8.3 alias");
    assert.deepEqual(await startup.status(), { enabled: true, broken: false });
  } finally { await startup.setEnabled(false); }
});
