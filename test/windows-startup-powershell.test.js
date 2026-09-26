import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rename, writeFile } from "node:fs/promises";
import { join, win32 } from "node:path";
import { tmpdir } from "node:os";
import { createWindowsStartup, runPowerShell } from "../src/windows-startup.js";

function fakeChild() {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout = new EventEmitter();
  child.kill = test.mock.fn();
  return child;
}

function spawnReturning(child) {
  return test.mock.fn(() => child);
}

test("resolves when PowerShell exits 0", async () => {
  const child = fakeChild();
  const spawnProcess = spawnReturning(child);
  const pending = runPowerShell("script", {}, { spawnProcess });
  child.stdout.emit("data", "  C:\\np\\nowplaying.exe  ");
  child.emit("close", 0);
  assert.equal(await pending, "C:\\np\\nowplaying.exe");
  const [exe, args, options] = spawnProcess.mock.calls[0].arguments;
  assert.equal(exe, "powershell.exe");
  assert.ok(args.includes("-NonInteractive"));
  assert.equal(options.shell, false);
});

test("rejects with the trimmed stderr when PowerShell exits non-zero", async () => {
  const child = fakeChild();
  const pending = runPowerShell("script", {}, { spawnProcess: spawnReturning(child) });
  child.stderr.emit("data", "  something broke  ");
  child.emit("close", 3);
  await assert.rejects(pending, /PowerShell exited 3: something broke/);
});

test("rejects when PowerShell cannot start", async () => {
  const child = fakeChild();
  const pending = runPowerShell("script", {}, { spawnProcess: spawnReturning(child) });
  child.emit("error", new Error("spawn powershell.exe ENOENT"));
  await assert.rejects(pending, /ENOENT/);
});

test("kills and rejects when PowerShell overruns the timeout", async () => {
  const child = fakeChild();
  const pending = runPowerShell("script", {}, { spawnProcess: spawnReturning(child), timeoutMs: 10 });
  await assert.rejects(pending, /timed out/);
  assert.equal(child.kill.mock.calls.length, 1);
});

const windows = { skip: process.platform !== "win32" };

test("a moved portable bundle shows the stale shortcut as broken and offers a repair", windows, async () => {
  const appData = await mkdtemp(join(tmpdir(), "np-startup-"));
  const oldDir = join(appData, "old");
  const newDir = join(appData, "new");
  await mkdir(oldDir);
  await writeFile(join(oldDir, "nowplayingw.exe"), "fixture");
  const old = createWindowsStartup({ appData, exePath: join(oldDir, "nowplayingw.exe") });
  const moved = createWindowsStartup({ appData, exePath: join(newDir, "nowplayingw.exe") });
  await old.setEnabled(true);
  assert.deepEqual(await old.status(), { enabled: true, broken: false });
  await rename(oldDir, newDir);
  try {
    assert.deepEqual(await moved.status(), { enabled: false, broken: true });
    assert.equal(await moved.isEnabled(), false);
    await moved.setEnabled(true);
    assert.deepEqual(await moved.status(), { enabled: true, broken: false });
  } finally {
    await moved.setEnabled(false);
  }
});
