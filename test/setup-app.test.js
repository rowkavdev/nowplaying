import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openSetupUrl, startSetupApp, windowsSetupDraftPath } from "../src/setup-app.js";

test("builds the draft path under LOCALAPPDATA", () => {
  assert.equal(windowsSetupDraftPath({ localAppData: "C:\\Users\\R\\AppData\\Local" }), "C:\\Users\\R\\AppData\\Local\\nowplaying\\setup-draft.json");
  assert.throws(() => windowsSetupDraftPath({}), /LOCALAPPDATA/);
  assert.throws(() => windowsSetupDraftPath({ localAppData: "C:\\x", appName: "..\\evil" }), /appName/);
});

test("serves the wizard page and draft API together on a free loopback port", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-setup-app-"));
  const app = await startSetupApp({ draftFile: join(dir, "draft.json") });
  try {
    assert.match(app.url, /^http:\/\/127\.0\.0\.1:\d+\/setup$/);
    const page = await fetch(app.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /NowPlaying setup/);
    const api = new URL("/api/setup/draft", app.url);
    const next = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "next" }) });
    assert.equal((await next.json()).draft.step, "provider");
    assert.equal((await fetch(new URL("/other", app.url))).status, 404);
  } finally {
    await app.close();
  }
});

test("refuses non-loopback hosts", async () => {
  await assert.rejects(startSetupApp({ draftFile: "/tmp/x.json", host: "0.0.0.0" }), /loopback/);
});

test("opens only loopback setup URLs, without a shell", () => {
  const calls = [];
  const spawnProcess = (command, args, options) => { calls.push({ command, args, options }); return { on() {}, unref() {} }; };
  openSetupUrl("http://127.0.0.1:4567/setup", { platform: "win32", spawnProcess });
  assert.deepEqual(calls[0].command, "rundll32.exe");
  assert.deepEqual(calls[0].args, ["url.dll,FileProtocolHandler", "http://127.0.0.1:4567/setup"]);
  assert.equal(calls[0].options.shell, false);
  for (const bad of ["http://evil.example/setup", "file:///C:/Windows/System32/calc.exe", "http://127.0.0.1:1/setup?x=&calc", "http://127.0.0.1:1/other", "http://user@127.0.0.1:1/setup"]) {
    assert.throws(() => openSetupUrl(bad, { platform: "win32", spawnProcess }), /loopback/, bad);
  }
  assert.equal(calls.length, 1);
});
