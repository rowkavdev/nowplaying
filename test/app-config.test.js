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
    version: 1, provider: "jellyfin", serverUrl: "http://127.0.0.1:8096",
    identity: { id: "u1", displayName: "Rowan" }, credentialRef: { provider: "jellyfin", identityId: "u1" },
    discord: { enabled: true, idleBehavior: "clear", artworkLookup: "off" },
  });
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
  for (const bad of [
    "{nope", "[]", JSON.stringify({ ...good, version: 2 }), JSON.stringify({ ...good, provider: "other" }),
    JSON.stringify({ ...good, credentialRef: { provider: "jellyfin", identityId: "someone-else" } }),
    JSON.stringify({ ...good, serverUrl: undefined }), JSON.stringify({ ...good, serverUrl: "http://u:p@x" }),
    JSON.stringify({ ...good, token: "s3cret" }), "x".repeat(20000),
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
    assert.deepEqual(store.reads, [{ provider: "jellyfin", identityId: "u1" }]);
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
  await writeFile(file, JSON.stringify({ ...JSON.parse(serializeSetupConfig(JELLYFIN)), version: 2 }));
  await assert.rejects(loadAppConfig(file), code("CONFIG_TOO_NEW"));
  assert.equal(JSON.parse(await readFile(file, "utf8")).version, 2);
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
