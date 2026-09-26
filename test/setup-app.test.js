import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { parseAppConfig } from "../src/app-config.js";
import { serializeSetupConfig } from "../src/setup-config.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openSetupUrl, startSetupApp, windowsConfigPath, windowsSetupDraftPath, writeSetupConfig } from "../src/setup-app.js";
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
    const next = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json", "X-Nowplaying-Session": app.sessionSecret }, body: JSON.stringify({ action: "next" }) });
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
  const credentialStore = { read: async () => null, remove: async () => true, save: async (key, secret) => { saved.push([key, secret]); } };
  const signIn = { signInNavidrome: async () => ({ provider: "navidrome", identity: { id: "rowan", displayName: "Rowan" }, secret: "nd-secret" }) };
  const draftFile = join(dir, "draft.json");
  const configFile = join(dir, "config.json");
  const app = await startSetupApp({ draftFile, configFile, credentialStore, deviceId: "device-0001", signIn });
  try {
    const api = (path, method, body) => fetch(new URL(path, app.url), { method, headers: { "Content-Type": "application/json", "X-Nowplaying-Session": app.sessionSecret }, body: body && JSON.stringify(body) }).then(async (r) => [r.status, await r.json()]);
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
    assert.equal((await api("/api/setup/draft", "POST", { action: "next" }))[1].draft.step, "review", "card hosting left as Not now");
    assert.equal((await api("/api/setup/draft", "POST", { action: "next" }))[1].draft.step, "complete");
    const configText = await readFile(configFile, "utf8");
    assert.deepEqual(JSON.parse(configText), {
      version: 2,
      servers: [{ provider: "navidrome", serverUrl: "http://127.0.0.1:4533", identity: { id: "rowan", displayName: "Rowan" }, credentialRef: { provider: "navidrome", identityId: "rowan" } }],
      discord: { enabled: false, idleBehavior: "clear", artworkLookup: "musicbrainz" },
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
    const post = (body) => fetch(new URL("/api/setup/draft", app.url), { method: "POST", headers: { "Content-Type": "application/json", "X-Nowplaying-Session": app.sessionSecret }, body: JSON.stringify(body) }).then((r) => r.json());
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

test("Start with Windows shows the current state and Finish applies the choice", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-setup-app-"));
  const applied = [];
  const startup = { isEnabled: async () => true, setEnabled: async (value) => { applied.push(value); } };
  const app = await startSetupApp({ draftFile: join(dir, "draft.json"), startup });
  try {
    const post = (body) => fetch(new URL("/api/setup/draft", app.url), { method: "POST", headers: { "Content-Type": "application/json", "X-Nowplaying-Session": app.sessionSecret }, body: JSON.stringify(body) }).then((r) => r.json());
    // Installer already added the shortcut: the box starts ticked.
    assert.equal((await (await fetch(new URL("/api/setup/draft", app.url))).json()).draft.startWithWindows, true);
    await post({ action: "next" });
    await post({ action: "next", changes: { provider: "plex" } });
    assert.equal((await post({ action: "next", changes: { startWithWindows: false } })).draft.step, "hosting");
    assert.equal((await post({ action: "next" })).draft.step, "review");
    assert.deepEqual(applied, []);
    assert.equal((await post({ action: "next" })).draft.step, "complete");
    assert.deepEqual(applied, [false]);
    const reset = await (await fetch(new URL("/api/setup/draft", app.url), { method: "DELETE", headers: { "Content-Type": "application/json", "X-Nowplaying-Session": app.sessionSecret } })).json();
    assert.equal(reset.draft.startWithWindows, true);
  } finally {
    await app.close();
  }
});

test("a failed startup change keeps the wizard on review", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-setup-app-"));
  const startup = { isEnabled: async () => false, setEnabled: async () => { throw new Error("denied"); } };
  const app = await startSetupApp({ draftFile: join(dir, "draft.json"), startup });
  try {
    const post = (body) => fetch(new URL("/api/setup/draft", app.url), { method: "POST", headers: { "Content-Type": "application/json", "X-Nowplaying-Session": app.sessionSecret }, body: JSON.stringify(body) }).then(async (r) => [r.status, await r.json()]);
    await post({ action: "next" });
    await post({ action: "next", changes: { provider: "plex" } });
    await post({ action: "next", changes: { startWithWindows: true } });
    await post({ action: "next" });
    assert.deepEqual(await post({ action: "next" }), [500, { error: "finish_failed" }]);
    assert.equal((await (await fetch(new URL("/api/setup/draft", app.url))).json()).draft.step, "review");
  } finally {
    await app.close();
  }
});

test("without startup support the choice is not offered", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-setup-app-"));
  const app = await startSetupApp({ draftFile: join(dir, "draft.json") });
  try {
    assert.equal((await (await fetch(new URL("/api/setup/draft", app.url))).json()).draft.startWithWindows, null);
    await assert.rejects(startSetupApp({ draftFile: join(dir, "d2.json"), startup: { isEnabled: async () => false } }), /startup is invalid/);
  } finally {
    await app.close();
  }
});

test("the wizard writes album art lookup on by default and off when unticked", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-setup-app-"));
  const file = join(dir, "config.json");
  const draft = { provider: "jellyfin", account: { provider: "jellyfin", id: "u1", displayName: "Rowan", serverUrl: "http://127.0.0.1:8096" }, discordEnabled: true, discordIdleBehavior: "clear" };
  await writeSetupConfig(file, draft);
  assert.equal(JSON.parse(await readFile(file, "utf8")).discord.artworkLookup, "musicbrainz");
  await writeSetupConfig(file, { ...draft, discordArtworkLookup: false });
  assert.equal(JSON.parse(await readFile(file, "utf8")).discord.artworkLookup, "off");
});

test("the setup server rejects writes without this run's session secret", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-setup-session-"));
  const app = await startSetupApp({ draftFile: join(dir, "draft.json") });
  try {
    assert.match(app.sessionSecret, /^[A-Za-z0-9_-]{43}$/);
    const api = new URL("/api/setup/draft", app.url);
    const denied = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "next" }) });
    assert.equal(denied.status, 403);
    const page = await fetch(app.url);
    const cookie = page.headers.get("set-cookie");
    assert.match(cookie, /^nowplaying_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict$/);
    const allowed = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie.split(";")[0] }, body: JSON.stringify({ action: "next" }) });
    assert.equal(allowed.status, 200);
    const other = await startSetupApp({ draftFile: join(dir, "draft2.json") });
    try { assert.notEqual(other.sessionSecret, app.sessionSecret); } finally { await other.close(); }
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the native window gets the session secret through its environment, not argv", async () => {
  const { EventEmitter } = await import("node:events");
  const { runNativeSetup } = await import("../src/setup-app.js");
  let call;
  const spawnProcess = (command, args, options) => { call = { args, options }; const child = new EventEmitter(); setImmediate(() => child.emit("close", 0)); return child; };
  const secret = "a".repeat(43);
  await runNativeSetup("http://127.0.0.1:4567/setup", { scriptPath: "C:\\np\\windows-setup.ps1", sessionSecret: secret, env: { PATH: "x" }, spawnProcess });
  assert.deepEqual(call.options.env, { PATH: "x", NOWPLAYING_SETUP_SESSION: secret });
  assert.ok(!call.args.some((arg) => arg.includes(secret)));
  assert.throws(() => runNativeSetup("http://127.0.0.1:4567/setup", { scriptPath: "C:\\np\\windows-setup.ps1", sessionSecret: "short", spawnProcess }), /sessionSecret/);
});

test("the wizard writes every server signed in during setup, oldest first (#252)", async () => {
  const { parseAppConfig } = await import("../src/app-config.js");
  const dir = await mkdtemp(join(tmpdir(), "np-setup-app-"));
  const file = join(dir, "config.json");
  const nav = { provider: "navidrome", id: "rowan", displayName: "Rowan", serverUrl: "http://127.0.0.1:4533" };
  const jf = { provider: "jellyfin", id: "u1", displayName: "Rowan", serverUrl: "http://127.0.0.1:8096" };
  await writeSetupConfig(file, { provider: "jellyfin", account: jf, servers: [nav] });
  const text = await readFile(file, "utf8");
  assert.deepEqual(JSON.parse(text).servers.map((s) => [s.provider, s.serverUrl, s.credentialRef.identityId]), [
    ["navidrome", "http://127.0.0.1:4533", "rowan"],
    ["jellyfin", "http://127.0.0.1:8096", "u1"],
  ]);
  assert.equal(parseAppConfig(text).servers.length, 2);
});

test("the wizard writes the optional Spotify block from the draft (#135)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-setup-app-"));
  const file = join(dir, "config.json");
  const account = { provider: "jellyfin", id: "u1", displayName: "Rowan", serverUrl: "http://127.0.0.1:8096" };
  await writeSetupConfig(file, { provider: "jellyfin", account, spotify: { clientId: "0123456789abcdef0123456789abcdef", identity: { id: "rowan", displayName: "Rowan" } } });
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(saved.spotify, { clientId: "0123456789abcdef0123456789abcdef", identity: { id: "rowan", displayName: "Rowan" }, credentialRef: { provider: "spotify", identityId: "rowan" } });
  await writeSetupConfig(file, { provider: "jellyfin", account });
  assert.equal(JSON.parse(await readFile(file, "utf8")).spotify, undefined);
});

test("running setup again keeps settings it doesn't own", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-setup-app-"));
  const file = join(dir, "config.json");
  const account = { provider: "jellyfin", id: "u1", displayName: "Rowan", serverUrl: "http://127.0.0.1:8096" };
  const card = { theme: "paper", radius: 0, textAlign: "middle", fieldOrder: ["title", "subtitle", "state"] };
  const privacy = { redactTitles: true, hideArtwork: false, hideProgress: true, suppressMediaKinds: ["movie"] };
  await writeFile(file, serializeSetupConfig({
    servers: [{ provider: "jellyfin", serverUrl: account.serverUrl, identity: { id: "u1", displayName: "Rowan" } }],
    credentialStored: true, discordTimestamps: "none", hostedEnabled: true, privacy, card,
  }));
  const nav = { provider: "navidrome", id: "n1", displayName: "rowan", serverUrl: "http://127.0.0.1:4533" };
  await writeSetupConfig(file, { provider: "navidrome", account: nav, servers: [account], discordEnabled: false, discordIdleBehavior: "show", discordArtworkLookup: false });
  const saved = parseAppConfig(await readFile(file, "utf8"));
  assert.deepEqual(saved.servers.map((server) => server.provider), ["jellyfin", "navidrome"], "setup still owns the server list");
  assert.deepEqual([saved.discord.enabled, saved.discord.idleBehavior, saved.discord.artworkLookup], [false, "show", "off"], "and the Discord basics");
  assert.equal(saved.discord.timestamps, "none");
  assert.equal(saved.hosted.enabled, true);
  assert.deepEqual(JSON.parse(JSON.stringify(saved.privacy)), privacy);
  assert.deepEqual(JSON.parse(JSON.stringify(saved.card)), card);
});

test("a broken existing config is replaced rather than blocking setup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-setup-app-"));
  const file = join(dir, "config.json");
  await writeFile(file, "{ not json");
  const account = { provider: "jellyfin", id: "u1", displayName: "Rowan", serverUrl: "http://127.0.0.1:8096" };
  await writeSetupConfig(file, { provider: "jellyfin", account });
  const saved = parseAppConfig(await readFile(file, "utf8"));
  assert.equal(saved.servers[0].identity.id, "u1");
  assert.equal(saved.card, undefined);
});

test("setup on an installed app starts from the installed config and Finish clears the draft", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-setup-app-"));
  const draftFile = join(dir, "draft.json");
  const configFile = join(dir, "config.json");
  const card = { theme: "paper" };
  await writeFile(configFile, serializeSetupConfig({
    servers: [
      { provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "Rowan" } },
      { provider: "navidrome", serverUrl: "http://127.0.0.1:4533", identity: { id: "n1", displayName: "rowan" } },
    ],
    credentialStored: true, discordEnabled: false, discordIdleBehavior: "show", discordArtworkLookup: "musicbrainz", discordTimestamps: "none", card,
    spotify: { clientId: "0123456789abcdef0123456789abcdef", identity: { id: "rowan", displayName: "Rowan" } },
  }));
  const before = parseAppConfig(await readFile(configFile, "utf8"));
  const app = await startSetupApp({ draftFile, configFile, credentialStore: { save: async () => {} }, deviceId: "device-0001" });
  try {
    const api = (method, body) => fetch(new URL("/api/setup/draft", app.url), { method, headers: { "Content-Type": "application/json", "X-Nowplaying-Session": app.sessionSecret }, body: body && JSON.stringify(body) }).then(async (r) => [r.status, await r.json()]);
    const [, opened] = await api("GET");
    assert.equal(opened.draft.step, "welcome");
    assert.deepEqual(opened.draft.account, { provider: "navidrome", id: "n1", displayName: "rowan", serverUrl: "http://127.0.0.1:4533" });
    assert.deepEqual(opened.draft.servers, [{ provider: "jellyfin", id: "u1", displayName: "Rowan", serverUrl: "http://127.0.0.1:8096" }]);
    assert.deepEqual([opened.draft.discordEnabled, opened.draft.discordIdleBehavior, opened.draft.discordArtworkLookup], [false, "show", true]);
    assert.equal(opened.draft.spotify.identity.id, "rowan");
    let step = opened.draft.step;
    for (let i = 0; i < 8 && step !== "complete"; i += 1) {
      const [status, body] = await api("POST", { action: "next" });
      assert.equal(status, 200, JSON.stringify(body));
      step = body.draft.step;
    }
    assert.equal(step, "complete");
    const after = parseAppConfig(await readFile(configFile, "utf8"));
    assert.deepEqual(JSON.parse(JSON.stringify(after)), JSON.parse(JSON.stringify(before)), "finishing without changes leaves the config as it was");
    await assert.rejects(readFile(draftFile), { code: "ENOENT" });
    assert.equal((await api("GET"))[1].draft.step, "welcome", "the next run starts again from the config");
  } finally {
    await app.close();
  }
});

test("a draft in progress wins over the installed config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-setup-app-"));
  const draftFile = join(dir, "draft.json");
  const configFile = join(dir, "config.json");
  await writeFile(configFile, serializeSetupConfig({ servers: [{ provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "Rowan" } }], credentialStored: true }));
  await writeFile(draftFile, JSON.stringify({ version: 1, step: "provider", provider: "navidrome" }));
  const app = await startSetupApp({ draftFile, configFile, credentialStore: { save: async () => {} }, deviceId: "device-0001" });
  try {
    const body = await (await fetch(new URL("/api/setup/draft", app.url))).json();
    assert.deepEqual([body.resumed, body.draft.step, body.draft.provider, body.draft.account], [true, "provider", "navidrome", null]);
  } finally {
    await app.close();
  }
});

// #141: switching provider on an installed app, and signing in again with a
// new secret (credential rotation), both through the real setup server.
async function rerunSetup({ configFile, draftFile, credentialStore, signIn }, steps) {
  const app = await startSetupApp({ draftFile, configFile, credentialStore, deviceId: "device-0001", signIn });
  const api = (path, body) => fetch(new URL(path, app.url), { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", "X-Nowplaying-Session": app.sessionSecret }, body: body && JSON.stringify(body) }).then(async (r) => [r.status, await r.json()]);
  try { return await steps(api); } finally { await app.close(); }
}

test("setup again can switch provider and keeps the card, privacy and hosted settings (#141)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-setup-app-"));
  const configFile = join(dir, "config.json");
  const card = { theme: "paper" };
  const privacy = { redactTitles: true, hideArtwork: false, hideProgress: false, suppressMediaKinds: [] };
  await writeFile(configFile, serializeSetupConfig({
    servers: [{ provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "Rowan" } }],
    credentialStored: true, hostedEnabled: true, card, privacy,
  }));
  const saved = [];
  const credentialStore = { read: async () => null, remove: async () => true, save: async (key, secret) => { saved.push([key, secret]); } };
  const signIn = { signInNavidrome: async () => ({ provider: "navidrome", identity: { id: "rowan", displayName: "Rowan" }, secret: "nd-secret" }) };
  await rerunSetup({ configFile, draftFile: join(dir, "draft.json"), credentialStore, signIn }, async (api) => {
    await api("/api/setup/draft", { action: "next" });
    const [, picked] = await api("/api/setup/draft", { action: "next", changes: { provider: "navidrome" } });
    assert.equal(picked.draft.step, "signin");
    assert.equal(picked.draft.account, null, "the old Jellyfin account doesn't carry over to Navidrome");
    assert.deepEqual(await api("/api/setup/draft", { action: "next" }), [409, { error: "signin_required" }]);
    const [status] = await api("/api/setup/signin", { action: "password", provider: "navidrome", baseUrl: "http://127.0.0.1:4533", username: "rowan", password: "pw-123" });
    assert.equal(status, 200);
    let step = "signin";
    for (let i = 0; i < 8 && step !== "complete"; i += 1) step = (await api("/api/setup/draft", { action: "next" }))[1].draft.step;
    assert.equal(step, "complete");
  });
  const after = parseAppConfig(await readFile(configFile, "utf8"));
  assert.deepEqual(after.servers.map((server) => [server.provider, server.identity.id]), [["navidrome", "rowan"]]);
  assert.equal(after.hosted.enabled, true);
  assert.deepEqual(JSON.parse(JSON.stringify(after.card)), card);
  assert.deepEqual(JSON.parse(JSON.stringify(after.privacy)), privacy);
  assert.deepEqual(saved, [[{ provider: "navidrome", identityId: "rowan" }, "nd-secret"]]);
  assert.doesNotMatch(await readFile(configFile, "utf8"), /nd-secret|pw-123/);
});

test("signing in again replaces the stored secret and leaves the config pointing at the same entry (#141)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-setup-app-"));
  const configFile = join(dir, "config.json");
  await writeFile(configFile, serializeSetupConfig({
    servers: [{ provider: "navidrome", serverUrl: "http://127.0.0.1:4533", identity: { id: "rowan", displayName: "Rowan" } }],
    credentialStored: true,
  }));
  const before = await readFile(configFile, "utf8");
  const vault = new Map([["navidrome/rowan", "old-secret"]]);
  const credentialStore = { read: async (key) => vault.get(`${key.provider}/${key.identityId}`) ?? null, remove: async (key) => vault.delete(`${key.provider}/${key.identityId}`), save: async (key, secret) => { vault.set(`${key.provider}/${key.identityId}`, secret); } };
  const signIn = { signInNavidrome: async () => ({ provider: "navidrome", identity: { id: "rowan", displayName: "Rowan" }, secret: "new-secret" }) };
  await rerunSetup({ configFile, draftFile: join(dir, "draft.json"), credentialStore, signIn }, async (api) => {
    await api("/api/setup/draft", { action: "next" });
    await api("/api/setup/draft", { action: "next", changes: { provider: "navidrome" } });
    const [status, body] = await api("/api/setup/signin", { action: "password", provider: "navidrome", baseUrl: "http://127.0.0.1:4533", username: "rowan", password: "new-pw" });
    assert.deepEqual([status, body.status], [200, "signed_in"]);
    let step = "signin";
    for (let i = 0; i < 8 && step !== "complete"; i += 1) step = (await api("/api/setup/draft", { action: "next" }))[1].draft.step;
    assert.equal(step, "complete");
  });
  assert.deepEqual([...vault], [["navidrome/rowan", "new-secret"]], "one entry, now holding the new secret");
  const after = await readFile(configFile, "utf8");
  assert.deepEqual(parseAppConfig(after).servers[0].credentialRef, parseAppConfig(before).servers[0].credentialRef);
  assert.doesNotMatch(after, /secret|new-pw/);
});
