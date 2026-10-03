import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createLinuxTray, linuxTrayAvailable, openLinuxWebUiUrl, linuxDesktopEnv } from "../src/linux-tray.js";

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stdin = new PassThrough();
  child.kill = () => { child.emit("close", null); };
  return child;
}
const options = (child, over = {}) => ({
  url: "http://127.0.0.1:47832", script: "/app/scripts/linux-tray.py",
  icon: "/app/assets/icon.png", spawnProcess: () => child, readyTimeoutMs: 30,
  ...over,
});

test("tray is Linux graphical-session only, never started by headless CI", () => {
  assert.equal(linuxTrayAvailable({ platform: "linux", env: { DISPLAY: ":1" } }), true);
  assert.equal(linuxTrayAvailable({ platform: "linux", env: { WAYLAND_DISPLAY: "wayland-0" } }), true);
  assert.equal(linuxTrayAvailable({ platform: "linux", env: {} }), false);
  assert.equal(linuxTrayAvailable({ platform: "darwin", env: { DISPLAY: ":1" } }), false);
});

test("ready handshake, split menu events, and Quit close exactly once", async () => {
  const child = fakeChild(); const opened = [];
  let command; let quits = 0;
  const tray = createLinuxTray(options(child, {
    spawnProcess: (...args) => { command = args; return child; },
    openUrl: (url) => opened.push(url), onQuit: () => { quits++; },
  }));
  child.stdout.write("rea"); child.stdout.write("dy\nsettings\nlogs\nopen\nquit\nquit\n");
  assert.equal(await tray.ready, true);
  assert.deepEqual(opened, ["http://127.0.0.1:47832/settings", "http://127.0.0.1:47832/logs", "http://127.0.0.1:47832"]);
  assert.equal(quits, 1);
  assert.equal(command[0], "python3");
  assert.equal(command[2].shell, false);
  assert.equal(command[2].stdio[2], "ignore");
  tray.close();
});

test("missing Python and nonzero exits report unavailable, never quit the server", async () => {
  for (const error of [true, false]) {
    const child = fakeChild(); let quits = 0;
    const tray = createLinuxTray(options(child, { onQuit: () => { quits++; } }));
    child.emit(error ? "error" : "close", error ? new Error("ENOENT") : 2);
    assert.equal(await tray.ready, false);
    assert.equal(quits, 0);
    tray.close();
  }
});

test("timeout stops a stuck tray helper, not the app", async () => {
  const tray = createLinuxTray(options(fakeChild()));
  assert.equal(await tray.ready, false);
  tray.close();
});

test("reject external URLs and ignore unexpected helper output", async () => {
  assert.throws(() => createLinuxTray(options(fakeChild(), { url: "https://outside.example" })), /loopback/);
  const child = fakeChild(); const opened = [];
  const tray = createLinuxTray(options(child, { openUrl: (url) => opened.push(url) }));
  child.stdout.write("ready\nhttps://outside.example\n");
  assert.equal(await tray.ready, true);
  assert.deepEqual(opened, []);
  tray.close();
});

test("closing before ready settles ready and ignores subsequent menu actions", async () => {
  const child = fakeChild(); let quits = 0;
  const tray = createLinuxTray(options(child, { onQuit: () => { quits++; } }));
  tray.close();
  assert.equal(await tray.ready, false);
  child.stdout.write("quit\n");
  assert.equal(quits, 0);
});

test("real WebUI opener validates all menu destinations and filters child secrets", () => {
  for (const path of ["/", "/settings", "/logs"]) {
    let call;
    openLinuxWebUiUrl(`http://127.0.0.1:47832${path}`, { spawnProcess: (...args) => { call = args; return fakeChild(); }, env: { HOME: "/tmp/home", DISPLAY: ":1", GH_TOKEN: "must-not-pass" } });
    assert.equal(call[0], "xdg-open");
    assert.equal(call[1][0], `http://127.0.0.1:47832${path}`);
    assert.equal(call[2].env.GH_TOKEN, undefined);
  }
  for (const url of ["http://outside.example/", "http://127.0.0.1/private", "http://127.0.0.1/logs?token=x"])
    assert.throws(() => openLinuxWebUiUrl(url), /allowed loopback/);
  assert.deepEqual(linuxDesktopEnv({ HOME: "/home/u", XDG_RUNTIME_DIR: "/run/u", GH_TOKEN: "no", OPENROUTER_API_KEY: "no" }), { HOME: "/home/u", XDG_RUNTIME_DIR: "/run/u" });
});

test("tray subprocess env excludes tokens and opener exceptions cannot crash app", async () => {
  const child = fakeChild(); let call;
  const tray = createLinuxTray(options(child, { env: { DISPLAY: ":1", GH_TOKEN: "no" }, spawnProcess: (...args) => { call = args; return child; }, openUrl: () => { throw new Error("browser unavailable"); } }));
  assert.equal(call[2].env.GH_TOKEN, undefined);
  assert.doesNotThrow(() => child.stdout.write("ready\nopen\nlogs\n"));
  assert.equal(await tray.ready, true);
  tray.close();
});

test("real helper ignoring TERM is killed within the bounded shutdown window", { skip: process.platform === "win32", timeout: 3000 }, async () => {
  let child;
  const tray = createLinuxTray(options(null, { readyTimeoutMs: 1500, killTimeoutMs: 40, spawnProcess: () => {
    child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); process.stdout.write('ready\\n'); setInterval(()=>{},1000);"], { stdio: ["pipe", "pipe", "ignore"] });
    return child;
  } }));
  try {
    assert.equal(await tray.ready, true);
    const exited = once(child, "close");
    tray.close();
    assert.equal(child.stdin.writableEnded, true);
    const [code, signal] = await exited;
    assert.equal(code, null);
    assert.equal(signal, "SIGKILL");
  } finally { child.kill("SIGKILL"); }
});

test("first-run menu opens setup until the live app is configured", async () => {
  const child = fakeChild(); const opened = []; let firstRun = true; let url = "http://127.0.0.1:47832";
  const tray = createLinuxTray(options(child, { isFirstRun: () => firstRun, getUrl: () => url, openUrl: (url) => opened.push(url) }));
  child.stdout.write("ready\nopen\nlogs\n");
  await tray.ready;
  firstRun = false;
  url = "http://127.0.0.1:47833";
  child.stdout.write("logs\n");
  assert.deepEqual(opened, ["http://127.0.0.1:47832/settings", "http://127.0.0.1:47832/settings", "http://127.0.0.1:47833/logs"]);
  tray.close();
});
