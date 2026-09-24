import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StartupError, createProviderFromConfig, loadAppConfig, parseAppConfig, startAppFromConfig } from "../src/app-config.js";
import { serializeSetupConfig } from "../src/setup-config.js";

const JELLYFIN = { provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "Rowan" }, credentialStored: true };

async function configFile(input = JELLYFIN) {
  const dir = await mkdtemp(join(tmpdir(), "np-app-config-"));
  const file = join(dir, "config.json");
  await writeFile(file, typeof input === "string" ? input : serializeSetupConfig(input));
  return file;
}

function fakeStore(secrets = {}) {
  const reads = [];
  return { reads, read: async (ref) => { reads.push(ref); return secrets[`${ref.provider}:${ref.identityId}`] ?? null; } };
}

const code = (startupCode) => (error) => error instanceof StartupError && error.startupCode === startupCode;

test("reads the wizard's config back exactly", async () => {
  const config = await loadAppConfig(await configFile());
  assert.deepEqual(config, {
    version: 2,
    servers: [{ provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "Rowan" }, credentialRef: { provider: "jellyfin", identityId: "u1" } }],
    discord: { enabled: true, idleBehavior: "clear", artworkLookup: "off" },
  });
  // The rest of the app still reads the first server directly (#252).
  assert.equal(config.provider, "jellyfin");
  assert.equal(config.serverUrl, "http://127.0.0.1:8096");
  assert.deepEqual(config.credentialRef, { provider: "jellyfin", identityId: "u1" });
});

test("keeps the album art lookup choice, and older configs without it stay off", async () => {
  const on = await loadAppConfig(await configFile({ ...JELLYFIN, discordArtworkLookup: "musicbrainz" }));
  assert.equal(on.discord.artworkLookup, "musicbrainz");
  const old = JSON.parse(serializeSetupConfig(JELLYFIN));
  delete old.discord.artworkLookup;
  assert.equal((await loadAppConfig(await configFile(JSON.stringify(old)))).discord.artworkLookup, "off");
  const bad = { ...old, discord: { ...old.discord, artworkLookup: "itunes" } };
  await assert.rejects(loadAppConfig(await configFile(JSON.stringify(bad))), code("CONFIG_INVALID"));
});

test("a missing config says to run setup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-app-config-"));
  await assert.rejects(loadAppConfig(join(dir, "config.json")), (error) => code("CONFIG_MISSING")(error) && /nowplaying\.exe setup/.test(error.message));
});

test("a damaged, tampered or credential-bearing config is refused", async () => {
  const good = JSON.parse(serializeSetupConfig(JELLYFIN));
  const server = good.servers[0];
  const withServer = (changes) => JSON.stringify({ ...good, servers: [{ ...server, ...changes }] });
  for (const bad of [
    "{nope", "[]", JSON.stringify({ ...good, version: 3 }), JSON.stringify({ ...good, version: 1 }), withServer({ provider: "other" }),
    withServer({ credentialRef: { provider: "jellyfin", identityId: "someone-else" } }), withServer({ credentialRef: undefined }),
    withServer({ serverUrl: undefined }), withServer({ serverUrl: "http://u:p@x" }), withServer({ token: "s3cret" }),
    JSON.stringify({ ...good, token: "s3cret" }), JSON.stringify({ ...good, provider: "jellyfin" }),
    JSON.stringify({ ...good, servers: [] }), JSON.stringify({ ...good, servers: [server, server] }),
    JSON.stringify({ ...good, servers: Array.from({ length: 9 }, (_, i) => ({ ...server, identity: { id: `u${i}`, displayName: "x" }, credentialRef: { provider: "jellyfin", identityId: `u${i}` } })) }),
    "x".repeat(20000),
  ]) {
    assert.throws(() => parseAppConfig(bad), code("CONFIG_INVALID"), bad.slice(0, 60));
  }
});

test("builds each provider from the stored sign-in, scoped to the signed-in user", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers });
    if (String(url).includes("/status/sessions")) return Response.json({ MediaContainer: { Metadata: [{ type: "track", title: "Theirs", User: { title: "someone" } }] } });
    if (String(url).includes("/Sessions")) return Response.json([]);
    return Response.json({ "subsonic-response": { status: "ok", nowPlaying: { entry: [] } } });
  };
  const plex = createProviderFromConfig(parseAppConfig(serializeSetupConfig({ ...JELLYFIN, provider: "plex", serverUrl: "http://127.0.0.1:32400" })), "plex-token", { fetchImpl });
  assert.equal((await plex.getPresence()).state, "idle", "another user's session must not show");
  assert.equal(calls[0].headers["X-Plex-Token"], "plex-token");
  const jellyfin = createProviderFromConfig(parseAppConfig(serializeSetupConfig(JELLYFIN)), "jf-token", { fetchImpl });
  await jellyfin.getPresence();
  assert.equal(calls[1].headers["X-Emby-Token"], "jf-token");
  const navidrome = createProviderFromConfig(parseAppConfig(serializeSetupConfig({ ...JELLYFIN, provider: "navidrome", identity: { id: "rowan", displayName: "rowan" } })), JSON.stringify({ token: "t0k", salt: "s4lt" }), { fetchImpl });
  await navidrome.getPresence();
  assert.match(calls[2].url, /u=rowan&t=t0k&s=s4lt/);
  assert.throws(() => createProviderFromConfig(navidrome && parseAppConfig(serializeSetupConfig({ ...JELLYFIN, provider: "navidrome" })), "not json"), code("CREDENTIAL_MISSING"));
});

test("starts the card server from config and the credential store", async () => {
  const store = fakeStore({ "jellyfin:u1": "jf-token" });
  const fetchImpl = async () => Response.json([]);
  const app = await startAppFromConfig({ configFile: await configFile(), credentialStore: store, port: 0, fetchImpl, discord: { env: {}, builtInClientId: "" } });
  try {
    assert.equal(app.discord, "no_app_id");
    assert.deepEqual(store.reads.filter((ref) => ref.provider !== "youtube"), [{ provider: "jellyfin", identityId: "u1" }]);
    assert.match(app.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const health = await fetch(`${app.url}/healthz`);
    assert.deepEqual([health.status, await health.text()], [200, "ok\n"]);
    const card = await fetch(`${app.url}/card.svg`);
    assert.equal(card.status, 200);
    assert.match(await card.text(), /<svg/);
    const page = await fetch(`${app.url}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /script-src 'self'/);
    const status = await (await fetch(`${app.url}/api/status`)).json();
    assert.equal(status.server.state, "connected");
    assert.equal(status.server.type, "Jellyfin");
    assert.deepEqual({ ...status.discord }, { enabled: true, state: "no_app_id", lastPublishedAt: null, error: null });
  } finally {
    await app.close();
  }
});

test("a missing or unreadable sign-in says to sign in again", async () => {
  const file = await configFile();
  await assert.rejects(startAppFromConfig({ configFile: file, credentialStore: fakeStore(), port: 0 }), (error) => code("CREDENTIAL_MISSING")(error) && /sign in again/.test(error.message));
  await assert.rejects(startAppFromConfig({ configFile: file, credentialStore: { read: async () => { throw new Error("vault s3cret"); } }, port: 0 }), (error) => code("CREDENTIAL_READ_FAILED")(error) && !/s3cret/.test(error.message));
});

test("a port the OS refuses is reported with how to pick another", async (t) => {
  // Port 1 needs admin rights on Linux and macOS; skip where the probe binds.
  const probe = createServer();
  const refused = await new Promise((resolve) => probe.once("error", (error) => resolve(error.code === "EACCES")).listen(1, "127.0.0.1", () => probe.close(() => resolve(false))));
  if (!refused) { t.skip("port 1 is bindable here"); return; }
  await assert.rejects(startAppFromConfig({ configFile: await configFile(), credentialStore: fakeStore({ "jellyfin:u1": "jf-token" }), port: 1 }), (error) => code("PORT_BLOCKED")(error) && error.message.includes("port 1") && error.message.includes("NOWPLAYING_PORT"));
});

test("a busy port is reported plainly", async () => {
  const blocker = createServer();
  await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const { port } = blocker.address();
  try {
    await assert.rejects(startAppFromConfig({ configFile: await configFile(), credentialStore: fakeStore({ "jellyfin:u1": "jf-token" }), port }), (error) => code("PORT_IN_USE")(error) && error.message.includes(String(port)));
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});

for (const provider of ["jellyfin", "emby"]) {
  test(`${provider}: follows the signed-in user by stable ID, not display name`, async () => {
    const item = (name) => ({ Type: "Audio", Name: name, Artists: ["A"], Album: "B", RunTimeTicks: 1_000_000_000 });
    let sessions = [];
    const fetchImpl = async () => Response.json(sessions);
    const config = parseAppConfig(serializeSetupConfig({ ...JELLYFIN, provider, identity: { id: "a1b2c3d4-0000-0000-0000-000000000001", displayName: "Rowan" } }));
    const app = createProviderFromConfig(config, "token", { fetchImpl });

    // Two people called Rowan on a shared server: only ours shows.
    sessions = [
      { UserId: "ffff0000000000000000000000000002", UserName: "Rowan", NowPlayingItem: item("Theirs"), PlayState: { IsPaused: false } },
      { UserId: "A1B2C3D4000000000000000000000001", UserName: "Rowan", NowPlayingItem: item("Mine"), PlayState: { IsPaused: false } },
    ];
    assert.equal((await app.getPresence()).title, "Mine");

    // Renamed on the server: still tracked.
    sessions = [{ UserId: "a1b2c3d4000000000000000000000001", UserName: "Rowan K", NowPlayingItem: item("Renamed"), PlayState: { IsPaused: false } }];
    assert.equal((await app.getPresence()).title, "Renamed");

    // Someone else took the old name, or our user was deleted: idle, never theirs.
    sessions = [{ UserId: "ffff0000000000000000000000000002", UserName: "Rowan", NowPlayingItem: item("Theirs"), PlayState: { IsPaused: false } }];
    assert.equal((await app.getPresence()).state, "idle");

    // Sessions without a UserId never match.
    sessions = [{ UserName: "Rowan", NowPlayingItem: item("No id"), PlayState: { IsPaused: false } }];
    assert.equal((await app.getPresence()).state, "idle");
  });
}

test("plex: follows the signed-in user by plex.tv ID, and the owner's local id 1 only for the owner's token", async () => {
  let sessions = [];
  let ownerToken = true;
  const accountChecks = [];
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/accounts")) { accountChecks.push(url); return new Response("{}", { status: ownerToken ? 200 : 401 }); }
    return Response.json({ MediaContainer: { Metadata: sessions } });
  };
  const track = (title, User) => ({ type: "track", title, grandparentTitle: "A", duration: 1000, viewOffset: 0, Player: { state: "playing" }, User });
  const config = parseAppConfig(serializeSetupConfig({ ...JELLYFIN, provider: "plex", serverUrl: "http://127.0.0.1:32400", identity: { id: "123456", displayName: "Rowan" } }));

  // Shared user with a duplicate name: matched by ID, never by name.
  let app = createProviderFromConfig(config, "plex-token", { fetchImpl });
  sessions = [track("Theirs", { id: "999", title: "Rowan" }), track("Mine", { id: "123456", title: "Rowan K" })];
  assert.equal((await app.getPresence()).title, "Mine");
  sessions = [track("Theirs", { id: "999", title: "Rowan" })];
  assert.equal((await app.getPresence()).state, "idle");
  assert.equal(accountChecks.length, 0);

  // Owner: the server calls them "1". Confirmed once via /accounts.
  sessions = [track("Owner plays", { id: "1", title: "Someone else's name" })];
  assert.equal((await app.getPresence()).title, "Owner plays");
  assert.equal((await app.getPresence()).title, "Owner plays");
  assert.equal(accountChecks.length, 1);

  // A shared user's token can't list /accounts, so the owner's session is not theirs.
  ownerToken = false;
  app = createProviderFromConfig(config, "plex-token", { fetchImpl });
  assert.equal((await app.getPresence()).state, "idle");
});

test("start-up migration leaves a current config alone and refuses a newer one (#120)", async () => {
  const { migrateAppConfig } = await import("../src/app-config.js");
  const dir = await mkdtemp(join(tmpdir(), "np-migrate-"));
  const file = join(dir, "config.json");
  await writeFile(file, serializeSetupConfig(JELLYFIN));
  assert.equal((await migrateAppConfig(file)).status, "current");
  assert.equal((await readdir(dir)).length, 1);
  await writeFile(file, JSON.stringify({ ...JSON.parse(serializeSetupConfig(JELLYFIN)), version: 3 }));
  await assert.rejects(loadAppConfig(file), code("CONFIG_TOO_NEW"));
  assert.equal(JSON.parse(await readFile(file, "utf8")).version, 3);
  await writeFile(file, JSON.stringify({ ...JSON.parse(serializeSetupConfig(JELLYFIN)), version: 0 }));
  await assert.rejects(loadAppConfig(file), code("CONFIG_INVALID"));
  assert.deepEqual((await readdir(dir)).sort(), ["config.json"]);
});

test("safe mode runs the card and status page but keeps Discord and hosted uploads off", async () => {
  const store = fakeStore({ "jellyfin:u1": "jf-token" });
  const fetchImpl = async () => Response.json([]);
  const config = { ...JELLYFIN, discordEnabled: true };
  const app = await startAppFromConfig({ configFile: await configFile(config), credentialStore: store, port: 0, fetchImpl, safeMode: true, discord: { env: {}, builtInClientId: "123456789012345678", createTransport: () => { throw new Error("Discord must not start in safe mode"); } } });
  try {
    assert.equal(app.safeMode, true);
    assert.equal(app.discord, "safe_mode");
    assert.equal(app.hosted, "safe_mode");
    assert.equal((await fetch(`${app.url}/card.svg`)).status, 200);
    assert.equal((await fetch(`${app.url}/healthz`)).status, 200);
  } finally {
    await app.close();
  }
});

test("safe mode is offline: it starts without the sign-in and never polls the server (#122)", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return Response.json([]); };
  const brokenStore = { read: async () => { throw new Error("vault s3cret"); } };
  const app = await startAppFromConfig({ configFile: await configFile(), credentialStore: brokenStore, port: 0, fetchImpl, safeMode: true, discord: { env: {}, builtInClientId: "" } });
  try {
    assert.equal((await fetch(`${app.url}/card.svg`)).status, 200);
    const status = await (await fetch(`${app.url}/api/status`)).json();
    assert.equal(status.server.state, "safe_mode");
    assert.deepEqual(app.status.tray(), { status: "degraded", action: "open_troubleshooting", text: "NowPlaying: safe mode - run setup again" });
    assert.equal((await fetch(`${app.url}/api/diagnostics`)).status, 200);
    assert.equal(calls, 0);
  } finally {
    await app.close();
  }
});

test("a down server is retried with backoff, not on every request, and recovers (#153)", async () => {
  let time = 0, calls = 0, up = false;
  const fetchImpl = async () => {
    calls += 1;
    if (!up) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    return Response.json([]);
  };
  const app = await startAppFromConfig({ configFile: await configFile(), credentialStore: fakeStore({ "jellyfin:u1": "jf-token" }), port: 0, fetchImpl,
    discord: { env: {}, builtInClientId: "" }, providerBackoff: { now: () => time, random: () => 0 } });
  try {
    for (let i = 0; i < 5; i += 1) await fetch(`${app.url}/card.svg`);
    assert.equal(calls, 1);
    const down = await (await fetch(`${app.url}/api/status`)).json();
    assert.equal(down.server.state, "unreachable");
    time = 5_000;
    await fetch(`${app.url}/card.svg`);
    assert.equal(calls, 2);
    time = 14_999;
    await fetch(`${app.url}/card.svg`);
    assert.equal(calls, 2);
    up = true;
    time = 15_000;
    await fetch(`${app.url}/card.svg`);
    assert.equal(calls, 3);
    const back = await (await fetch(`${app.url}/api/status`)).json();
    assert.equal(back.server.state, "connected");
  } finally {
    await app.close();
  }
});

test("a v1 single-server config is migrated to a v2 servers list, with a backup (#252)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-migrate-v1-"));
  const file = join(dir, "config.json");
  const v1 = {
    version: 1, provider: "jellyfin", serverUrl: "http://127.0.0.1:8096",
    identity: { id: "u1", displayName: "Rowan" }, credentialRef: { provider: "jellyfin", identityId: "u1" },
    discord: { enabled: false, idleBehavior: "show", artworkLookup: "musicbrainz", timestamps: "elapsed" },
    hosted: { enabled: true }, privacy: { hideArtwork: true },
  };
  await writeFile(file, JSON.stringify(v1));
  const config = await loadAppConfig(file);
  assert.equal(config.version, 2);
  assert.deepEqual(config.servers, [{ provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "Rowan" }, credentialRef: { provider: "jellyfin", identityId: "u1" } }]);
  assert.deepEqual(config.discord, v1.discord);
  assert.equal(config.hosted.enabled, true);
  assert.equal(config.privacy.hideArtwork, true);
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(saved.version, 2);
  assert.equal("provider" in saved, false);
  const backups = (await readdir(dir)).filter((name) => name.startsWith("config.json.backup-"));
  assert.equal(backups.length, 1);
  assert.deepEqual(JSON.parse(await readFile(join(dir, backups[0]), "utf8")), v1);
});

test("a v1 config that fails validation after migration is left untouched", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-migrate-v1-bad-"));
  const file = join(dir, "config.json");
  const bad = JSON.stringify({ version: 1, provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "R" }, credentialRef: { provider: "jellyfin", identityId: "other" } });
  await writeFile(file, bad);
  await assert.rejects(loadAppConfig(file), code("CONFIG_INVALID"));
  assert.equal(await readFile(file, "utf8"), bad);
});

test("several servers load, and the app runs from the first one for now", async () => {
  const text = serializeSetupConfig({
    servers: [
      { provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "Rowan" } },
      { provider: "navidrome", serverUrl: "http://192.168.1.5:4533", identity: { id: "rowan", displayName: "rowan" } },
    ],
    credentialStored: true,
  });
  const config = parseAppConfig(text);
  assert.deepEqual(config.servers.map((s) => s.provider), ["jellyfin", "navidrome"]);
  assert.deepEqual(config.servers[1].credentialRef, { provider: "navidrome", identityId: "rowan" });
  assert.equal(config.provider, "jellyfin");
  assert.equal(JSON.parse(JSON.stringify(config)).provider, undefined);
});

test("polls every signed-in server; a second server's missing sign-in doesn't stop the start (#252)", async () => {
  const servers = [
    { provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "Rowan" } },
    { provider: "emby", serverUrl: "http://127.0.0.1:8920", identity: { id: "e1", displayName: "RowanE" } },
    { provider: "plex", serverUrl: "http://127.0.0.1:32400", identity: { id: "p1", displayName: "RowanP" } },
  ];
  const store = fakeStore({ "jellyfin:u1": "jf-token", "emby:e1": "emby-token" });
  const hosts = [];
  const fetchImpl = async (url) => { hosts.push(new URL(url).port); return Response.json([]); };
  const app = await startAppFromConfig({ configFile: await configFile({ servers, credentialStored: true }), credentialStore: store, port: 0, fetchImpl, discord: { env: {}, builtInClientId: "" } });
  try {
    assert.deepEqual(store.reads.map((ref) => ref.provider).filter((p) => p !== "youtube"), ["jellyfin", "emby", "plex"]);
    const status = await (await fetch(`${app.url}/api/status`)).json();
    assert.equal(status.server.type, "Jellyfin");
    assert.ok(hosts.includes("8096") && hosts.includes("8920"), "both signed-in servers are polled");
    assert.ok(!hosts.includes("32400"), "a server without a saved sign-in is not polled");
    assert.deepEqual(app.servers().map((s) => [s.provider, s.state, s.reason ?? null]), [
      ["jellyfin", "idle", null],
      ["emby", "idle", null],
      ["plex", "unavailable", "CREDENTIAL_MISSING"],
    ]);
  } finally {
    await app.close();
  }
});

test("the YouTube extension bridge feeds the card, with a stored pairing token (#136)", async () => {
  const secrets = { "jellyfin:u1": "jf-token" };
  const store = { read: async (ref) => secrets[`${ref.provider}:${ref.identityId}`] ?? null, save: async (ref, secret) => { secrets[`${ref.provider}:${ref.identityId}`] = secret; } };
  const fetchImpl = async () => Response.json([]);
  const app = await startAppFromConfig({ configFile: await configFile(), credentialStore: store, port: 0, fetchImpl, discord: { env: {}, builtInClientId: "" } });
  try {
    const token = secrets["youtube:extension"];
    assert.ok(token && token.length >= 32);
    const post = (headers, body) => fetch(`${app.url}/bridge/youtube`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    const event = { tabId: "tab1", videoId: "dQw4w9WgXcQ", title: "Bridge Video", channel: "Bridge Channel", state: "playing", positionMs: 1000, durationMs: 60000 };
    const origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    assert.equal((await post({ Origin: origin }, event)).status, 401);
    assert.equal((await post({ Origin: "https://evil.example", Authorization: `Bearer ${token}` }, event)).status, 403);
    assert.equal((await post({ Origin: origin, Authorization: `Bearer ${token}` }, event)).status, 204);
    assert.match(await (await fetch(`${app.url}/card.svg`)).text(), /Bridge Video/);
    // Settings page reads and resets the token; other callers can't.
    assert.equal((await fetch(`${app.url}/api/settings/youtube/pairing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 403);
    const cookie = (await fetch(`${app.url}/settings`)).headers.get("set-cookie").split(";")[0];
    const own = { Cookie: cookie, Origin: app.url, "Content-Type": "application/json" };
    const read = await fetch(`${app.url}/api/settings/youtube/pairing`, { method: "POST", headers: own, body: "{}" });
    assert.deepEqual(await read.json(), { token });
    const reset = await (await fetch(`${app.url}/api/settings/youtube/pairing/reset`, { method: "POST", headers: own, body: "{}" })).json();
    assert.ok(reset.token.length >= 32 && reset.token !== token);
    assert.equal(secrets["youtube:extension"], reset.token);
    assert.equal((await post({ Origin: origin, Authorization: `Bearer ${token}` }, event)).status, 401);
    assert.doesNotMatch(await (await fetch(`${app.url}/card.svg`)).text(), /Bridge Video/);
    assert.equal((await post({ Origin: origin, Authorization: `Bearer ${reset.token}` }, event)).status, 204);
  } finally {
    await app.close();
  }
});

test("settings page can ask the host to open setup for servers (#253)", async () => {
  let asked = 0;
  const store = { read: async (ref) => (ref.provider === "jellyfin" ? "jf-token" : null) };
  const start = (extra) => startAppFromConfig({ configFile: undefined, credentialStore: store, port: 0, fetchImpl: async () => Response.json([]), discord: { env: {}, builtInClientId: "" }, ...extra });
  const app = await start({ configFile: await configFile(), requestSetup: () => { asked += 1; } });
  const plain = await start({ configFile: await configFile() });
  try {
    const cookie = (await fetch(`${app.url}/settings`)).headers.get("set-cookie").split(";")[0];
    const own = { Cookie: cookie, "Content-Type": "application/json" };
    assert.equal((await fetch(`${app.url}/api/settings/servers/setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 403);
    assert.equal(asked, 0);
    assert.deepEqual((await (await fetch(`${app.url}/api/settings`)).json()).setup, { available: true });
    assert.equal((await (await fetch(`${plain.url}/api/settings`)).json()).setup, undefined);
    const res = await fetch(`${app.url}/api/settings/servers/setup`, { method: "POST", headers: own, body: "{}" });
    assert.deepEqual([res.status, await res.json()], [202, { opening: true }]);
    assert.equal(asked, 1);
    assert.equal((await fetch(`${app.url}/api/settings/servers/setup`, { headers: own })).status, 405);
    // No host to open setup (dev checkout, hand-written config): not offered.
    const plainCookie = (await fetch(`${plain.url}/settings`)).headers.get("set-cookie").split(";")[0];
    assert.equal((await fetch(`${plain.url}/api/settings/servers/setup`, { method: "POST", headers: { Cookie: plainCookie, "Content-Type": "application/json" }, body: "{}" })).status, 404);
  } finally {
    await app.close();
    await plain.close();
  }
});

test("the local card embeds the server's album art, and a failed fetch leaves it out (#449)", async () => {
  const sharp = (await import("sharp")).default;
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#f28c28" } }).png().toBuffer();
  const session = { UserId: "u1", PlayState: { IsPaused: false, PositionTicks: 0 }, NowPlayingItem: { Id: "item1", Type: "Audio", Name: "Song", Artists: ["Artist"], ImageTags: { Primary: "tag1" }, RunTimeTicks: 1_000_000_000 } };
  for (const artworkWorks of [true, false]) {
    const requests = [];
    const fetchImpl = async (url, init = {}) => {
      requests.push({ url: String(url), token: init.headers?.["X-Emby-Token"] ?? null });
      if (String(url).endsWith("/Sessions")) return Response.json([session]);
      if (!artworkWorks) return new Response("nope", { status: 500 });
      return new Response(png, { status: 200, headers: { "Content-Type": "image/png" } });
    };
    const app = await startAppFromConfig({ configFile: await configFile(), credentialStore: fakeStore({ "jellyfin:u1": "jf-token" }), port: 0, fetchImpl, discord: { env: {}, builtInClientId: "" } });
    try {
      const svg = await (await fetch(`${app.url}/card.svg`)).text();
      assert.match(svg, />Song</);
      assert.equal(/<image href="data:image\/png;base64,/.test(svg), artworkWorks);
      assert.equal(/<linearGradient id="bg"/.test(svg), artworkWorks, "the art tints the background (#447)");
      const art = requests.find((request) => request.url.includes("/Items/item1/Images/Primary"));
      assert.ok(art, "artwork was requested from the server");
      assert.equal(art.token, "jf-token");
    } finally {
      await app.close();
    }
  }
});

test("reads a config saved with a UTF-8 byte order mark (Notepad, PowerShell 5)", async () => {
  const file = await configFile(`\uFEFF${serializeSetupConfig(JELLYFIN)}`);
  const config = await loadAppConfig(file);
  assert.equal(config.provider, "jellyfin");
  assert.equal(config.serverUrl, "http://127.0.0.1:8096");
  // Only a leading mark is allowed; one anywhere else is still invalid.
  assert.throws(() => parseAppConfig(`{\uFEFF${serializeSetupConfig(JELLYFIN).slice(1)}`), code("CONFIG_INVALID"));
});
