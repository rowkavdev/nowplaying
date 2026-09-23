import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openSetupUrl, startSetupApp, windowsConfigPath, windowsSetupDraftPath } from "../src/setup-app.js";
import { stat } from "node:fs/promises";

test("builds the draft path under LOCALAPPDATA", () => {
  assert.equal(windowsSetupDraftPath({ localAppData: "C:\\Users\\R\\AppData\\Local" }), "C:\\Users\\R\\AppData\\Local\\nowplaying\\setup-draft.json");
  assert.throws(() => windowsSetupDraftPath({}), /LOCALAPPDATA/);
  assert.throws(() => windowsSetupDraftPath({ localAppData: "C:\\x", appName: "..\\evil" }), /appName/);
});

test("serves the wizard page and draft API together on a free loopback port", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-setup-app-"));
  const app = await startSetupApp({ draftFile: join(dir, "draft.json"), discover: async () => [{ provider: "navidrome", baseUrl: "http://127.0.0.1:4533", version: "0.53.3" }] });
  try {
    assert.match(app.url, /^http:\/\/127\.0\.0\.1:\d+\/setup$/);
    const page = await fetch(app.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /NowPlaying setup/);
    const api = new URL("/api/setup/draft", app.url);
    const next = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "next" }) });
    assert.equal((await next.json()).draft.step, "provider");
    assert.equal((await fetch(new URL("/other", app.url))).status, 404);
    const found = await (await fetch(new URL("/api/setup/discover", app.url))).json();
    assert.equal(found.servers[0].provider, "navidrome");
  } finally {
    await app.close();
  }
});

test("a sign-in saves the secret to the credential store and only the account to the draft", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-setup-app-"));
  const saved = [];
  const credentialStore = { save: async (key, secret) => { saved.push([key, secret]); } };
  const signIn = { signInNavidrome: async () => ({ provider: "navidrome", identity: { id: "rowan", displayName: "Rowan" }, secret: "nd-secret" }) };
  const draftFile = join(dir, "draft.json");
  const configFile = join(dir, "config.json");
  const app = await startSetupApp({ draftFile, configFile, credentialStore, deviceId: "device-0001", signIn });
  try {
    const api = (path, method, body) => fetch(new URL(path, app.url), { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then(async (r) => [r.status, await r.json()]);
    await api("/api/setup/draft", "POST", { action: "next" });
    assert.equal((await api("/api/setup/draft", "POST", { action: "next", changes: { provider: "navidrome" } }))[1].draft.step, "signin");
    assert.deepEqual(await api("/api/setup/draft", "POST", { action: "next" }), [409, { error: "signin_required" }]);
    const [status, body] = await api("/api/setup/signin", "POST", { action: "password", provider: "navidrome", baseUrl: "http://127.0.0.1:4533", username: "rowan", password: "pw-123" });
    assert.deepEqual([status, body.status], [200, "signed_in"]);
    assert.deepEqual(saved, [[{ provider: "navidrome", identityId: "rowan" }, "nd-secret"]]);
    const draft = (await api("/api/setup/draft", "GET"))[1].draft;
    assert.deepEqual([draft.step, draft.account], ["signin", { provider: "navidrome", id: "rowan", displayName: "Rowan", serverUrl: "http://127.0.0.1:4533" }]);
    assert.doesNotMatch(await readFile(draftFile, "utf8"), /nd-secret|pw-123/);
    assert.equal((await api("/api/setup/draft", "POST", { action: "next" }))[1].draft.step, "discord");
    await assert.rejects(readFile(configFile), { code: "ENOENT" });
    await api("/api/setup/draft", "POST", { action: "next", changes: { discordEnabled: false } });
    assert.equal((await api("/api/setup/draft", "POST", { action: "next" }))[1].draft.step, "complete");
    const configText = await readFile(configFile, "utf8");
    assert.deepEqual(JSON.parse(configText), {
      version: 1,
      provider: "navidrome",
      serverUrl: "http://127.0.0.1:4533",
      identity: { id: "rowan", displayName: "Rowan" },
      credentialRef: { provider: "navidrome", identityId: "rowan" },
      discord: { enabled: false, idleBehavior: "clear" },
    });
    assert.doesNotMatch(configText, /nd-secret|pw-123/);
    if (process.platform !== "win32") assert.equal((await stat(configFile)).mode & 0o777, 0o600);
  } finally {
    await app.close();
  }
});

test("Finish writes no config when sign-in is unavailable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-setup-app-"));
  const configFile = join(dir, "config.json");
  const app = await startSetupApp({ draftFile: join(dir, "draft.json"), configFile });
  try {
    const post = (body) => fetch(new URL("/api/setup/draft", app.url), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    await post({ action: "next" });
    await post({ action: "next", changes: { provider: "plex" } });
    for (let i = 0; i < 2; i += 1) await post({ action: "next" });
    assert.equal((await post({ action: "next" })).draft.step, "complete");
    await assert.rejects(readFile(configFile), { code: "ENOENT" });
  } finally {
    await app.close();
  }
});

test("builds the config path next to the draft", () => {
  assert.equal(windowsConfigPath({ localAppData: "C:\\Users\\R\\AppData\\Local" }), "C:\\Users\\R\\AppData\\Local\\nowplaying\\config.json");
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


test("launches the native window through PowerShell without a shell", async () => {
  const { EventEmitter } = await import("node:events");
  const { runNativeSetup } = await import("../src/setup-app.js");
  let call;
  const spawnProcess = (command, args, options) => {
    const child = new EventEmitter();
    call = { command, args, options };
    setImmediate(() => child.emit("close", 0));
    return child;
  };
  const result = await runNativeSetup("http://127.0.0.1:4567/setup", { scriptPath: "C:\\np\\app\\scripts\\windows-setup.ps1", spawnProcess });
  assert.equal(result.code, 0);
  assert.equal(call.command, "powershell.exe");
  assert.equal(call.options.shell, false);
  assert.deepEqual(call.args.slice(-4), ["-File", "C:\\np\\app\\scripts\\windows-setup.ps1", "-Url", "http://127.0.0.1:4567/setup"]);
  assert.ok(call.args.includes("-STA"));
  for (const bad of ["http://localhost:1/setup", "http://evil.example/setup", "http://127.0.0.1:1/setup?x=;calc"]) {
    assert.throws(() => runNativeSetup(bad, { scriptPath: "x\\windows-setup.ps1", spawnProcess }), /URL/, bad);
  }
  assert.throws(() => runNativeSetup("http://127.0.0.1:1/setup", { scriptPath: "evil.ps1", spawnProcess }), /scriptPath/);
  const failing = () => { const child = new EventEmitter(); setImmediate(() => child.emit("error", new Error("ENOENT"))); return child; };
  await assert.rejects(runNativeSetup("http://127.0.0.1:1/setup", { scriptPath: "x\\windows-setup.ps1", spawnProcess: failing }), /ENOENT/);
});
