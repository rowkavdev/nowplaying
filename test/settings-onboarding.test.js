import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startAppFromConfig } from "../src/app-config.js";
import { createSettingsServers } from "../src/settings-servers.js";
import { createFirstRunSettingsHandler } from "../src/settings-page-handler.js";
import { serializeSetupConfig } from "../src/setup-config.js";

async function fixture() { return join(await mkdtemp(join(tmpdir(), "np-onboard-")), "config.json"); }
const store = { read: async () => null, save: async () => {}, remove: async () => true };
const deviceId = "onboarding-test-device-id";
const post = (url, body) => ({ method: "POST", url, body: JSON.stringify(body), headers: { "sec-fetch-site": "same-origin" } });

test("missing config binds first-run Settings and explicit state", async () => {
  const file = await fixture();
  const app = await startAppFromConfig({ configFile: file, credentialStore: store, deviceId, port: 0, discoverServers: async () => [], onConfigured: async () => {} });
  try {
    assert.equal(app.firstRun, true);
    const page = await fetch(`${app.url}/settings`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Set up NowPlaying/);
    const state = await (await fetch(`${app.url}/api/settings/servers`)).json();
    assert.equal(state.firstRun, true);
    assert.deepEqual(state.servers, []);
    assert.equal((await fetch(`${app.url}/servers.js`)).status, 200);
  } finally { await app.close(); }
});

test("first signed-in server saves valid credential-free config and signals activation", async () => {
  const file = await fixture(); let callbacks = 0; const secrets = [];
  let activated; const activation = new Promise((resolve) => { activated = resolve; });
  const mgmt = createSettingsServers({ file, deviceId, credentialStore: { read: store.read, remove: store.remove, save: async (ref, secret) => { secrets.push({ ref, secret }); } }, onConfigured: () => { callbacks++; activated(); }, discover: async () => [], signIn: {
    signInNavidrome: async () => ({ provider: "navidrome", identity: { id: "rowan", displayName: "Rowan" }, secret: "stored-credential" }),
  } });
  const handler = createFirstRunSettingsHandler({ servers: mgmt.handler });
  const page = await handler({ url: "/settings" });
  assert.equal(page.page, true);
  assert.match(page.body, /VPN may use a private address/);
  const auth = await mgmt.handler(post("/api/setup/signin", { action: "password", provider: "navidrome", baseUrl: "http://10.1.2.3:4533", username: "rowan", password: "not-stored" }));
  assert.equal(auth.status, 200);
  assert.equal(JSON.parse(auth.body).status, "signed_in");
  assert.deepEqual(secrets, [{ ref: { provider: "navidrome", identityId: "rowan" }, secret: "stored-credential" }]);
  const config = JSON.parse(await readFile(file, "utf8"));
  assert.equal(config.servers[0].serverUrl, "http://10.1.2.3:4533");
  assert.doesNotMatch(JSON.stringify(config), /not-stored|stored-credential/);
  await activation;
  assert.equal(callbacks, 1);
  assert.equal(JSON.parse((await mgmt.handler({ url: "/api/settings/servers" })).body).configured, true);
});

test("discovery requires explicit private CIDR for port sweep and cancels", async () => {
  const file = await fixture(); let hosts;
  const mgmt = createSettingsServers({ file, deviceId, credentialStore: store, discover: async ({ hosts: selected }) => { hosts = selected; return []; } });
  assert.equal((await mgmt.handler(post("/api/settings/servers/discover", { subnet: "10.8.0.42" }))).status, 400);
  assert.equal((await mgmt.handler(post("/api/settings/servers/discover", { subnet: "8.8.8.0/24" }))).status, 400);
  assert.equal((await mgmt.handler(post("/api/settings/servers/discover", { subnet: "" }))).status, 200);
  assert.deepEqual(hosts, []);
  assert.equal((await mgmt.handler(post("/api/settings/servers/discover", { subnet: "192.168.1.0/24" }))).status, 200);
  assert.equal(hosts.length, 254);
});

test("adding a second server keeps current settings and never writes a password", async () => {
  const file = await fixture();
  await writeFile(file, serializeSetupConfig({
    servers: [{ provider: "jellyfin", serverUrl: "http://192.168.1.20:8096", identity: { id: "first", displayName: "One" } }],
    credentialStored: true, discordEnabled: false, discordIdleBehavior: "recent", discordArtworkLookup: "off",
    privacy: { redactTitles: true }, card: { theme: "paper" }, hostedEnabled: false,
  }));
  const mgmt = createSettingsServers({ file, deviceId, credentialStore: store, onConfigured: () => {}, signIn: {
    signInNavidrome: async () => ({ provider: "navidrome", identity: { id: "two", displayName: "Two" }, secret: "new-secret" }),
  } });
  const auth = await mgmt.handler(post("/api/setup/signin", { action: "password", provider: "navidrome", baseUrl: "http://192.168.1.30:4533", username: "two", password: "unsaved-password" }));
  assert.equal(auth.status, 200);
  const config = JSON.parse(await readFile(file, "utf8"));
  assert.equal(config.servers.length, 2);
  assert.equal(config.servers[0].identity.id, "first");
  assert.equal(config.servers[1].identity.id, "two");
  assert.equal(config.discord.enabled, false);
  assert.equal(config.discord.idleBehavior, "recent");
  assert.equal(config.privacy.redactTitles, true);
  assert.equal(config.card.theme, "paper");
  assert.doesNotMatch(JSON.stringify(config), /new-secret|unsaved-password/);
  const last = await mgmt.handler({ method: "DELETE", url: "/api/settings/servers", body: JSON.stringify({ provider: "jellyfin", id: "first" }) });
  assert.equal(last.status, 200);
  assert.equal((await mgmt.handler({ method: "DELETE", url: "/api/settings/servers", body: JSON.stringify({ provider: "navidrome", id: "two" }) })).status, 409);
});

test("cancelled discovery stays distinct from a completed empty scan and does not replace cached results", async () => {
  const file = await fixture();
  let finish, started;
  const scanning = new Promise((resolve) => { started = resolve; });
  let calls = 0;
  const mgmt = createSettingsServers({ file, deviceId, credentialStore: store,
    discover: ({ signal }) => {
      calls++;
      if (calls === 1) return Promise.resolve([{ provider: "plex", baseUrl: "http://127.0.0.1:32400" }]);
      if (calls === 3) return Promise.resolve([{ provider: "emby", baseUrl: "http://10.0.0.2:8096" }]);
      started(signal);
      return new Promise((resolve) => { finish = resolve; });
    },
  });
  const first = JSON.parse((await mgmt.handler(post("/api/settings/servers/discover", { subnet: "" }))).body);
  assert.equal(first.servers.length, 1);
  const pending = mgmt.handler(post("/api/settings/servers/discover", { subnet: "192.168.1.0/24" }));
  const signal = await scanning;
  assert.equal((await mgmt.handler(post("/api/settings/servers/cancel", {}))).status, 200);
  assert.equal(signal.aborted, true);
  // A transport that resolves despite abort must not turn partial results into a completed scan.
  finish([{ provider: "emby", baseUrl: "http://10.0.0.2:8096" }]);
  assert.deepEqual(JSON.parse((await pending).body), { cancelled: true });
  assert.deepEqual(JSON.parse((await mgmt.handler({ url: "/api/settings/servers" })).body).discovered, first.servers);
  assert.deepEqual(JSON.parse((await mgmt.handler(post("/api/settings/servers/discover", { subnet: "" }))).body).servers, [{ provider: "emby", baseUrl: "http://10.0.0.2:8096" }]);
});

test("cancelled discovery reports cancellation even when transport rejects on abort", async () => {
  const file = await fixture();
  let started;
  const scanning = new Promise((resolve) => { started = resolve; });
  const mgmt = createSettingsServers({ file, deviceId, credentialStore: store,
    discover: ({ signal }) => new Promise((_, reject) => {
      started(); signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  const pending = mgmt.handler(post("/api/settings/servers/discover", { subnet: "" }));
  await scanning;
  await mgmt.handler(post("/api/settings/servers/cancel", {}));
  assert.deepEqual(JSON.parse((await pending).body), { cancelled: true });
});

test("a rejected post-config restart is exposed to the first-run page", async () => {
  const file = await fixture();
  let attempted;
  const restart = new Promise((resolve) => { attempted = resolve; });
  const mgmt = createSettingsServers({ file, deviceId, credentialStore: store,
    onConfigured: () => { attempted(); throw Error("port in use"); },
    signIn: { signInNavidrome: async () => ({ provider: "navidrome", identity: { id: "u1", displayName: "User" }, secret: "token" }) },
  });
  const auth = await mgmt.handler(post("/api/setup/signin", { action: "password", provider: "navidrome", baseUrl: "http://127.0.0.1:4533", username: "u1", password: "password" }));
  assert.equal(auth.status, 200);
  await restart;
  await new Promise((resolve) => setImmediate(resolve));
  const state = JSON.parse((await mgmt.handler({ url: "/api/settings/servers" })).body);
  assert.equal(state.configured, true);
  assert.equal(state.activationFailed, true);
  assert.equal(state.servers.length, 1);
});

test("a ninth server is rejected before Plex sign-in and saves no credential", async () => {
  const file = await fixture();
  const servers = Array.from({ length: 8 }, (_, i) => ({ provider: "plex", serverUrl: `http://127.0.0.1:${32400 + i}`, identity: { id: `u${i}`, displayName: `User ${i}` } }));
  const original = serializeSetupConfig({ servers, credentialStored: true });
  await writeFile(file, original);
  let started = 0; const stored = [];
  const mgmt = createSettingsServers({ file, deviceId, credentialStore: { read: async () => null, remove: async () => true, save: async (ref) => { stored.push(ref); } },
    signIn: { startPlexPin: async () => { started++; return { pinId: 123, authUrl: "https://app.plex.tv/auth#test" }; } } });
  const response = await mgmt.handler(post("/api/setup/signin", { action: "start", provider: "plex", baseUrl: "http://127.0.0.1:32499" }));
  assert.deepEqual([response.status, JSON.parse(response.body)], [409, { error: "too_many_servers" }]);
  assert.equal(started, 0);
  assert.deepEqual(stored, []);
  assert.equal(await readFile(file, "utf8"), original);
});

test("Plex cannot start without an address in the Settings flow", async () => {
  const file = await fixture(); let started = 0;
  const mgmt = createSettingsServers({ file, deviceId, credentialStore: store,
    signIn: { startPlexPin: async () => { started++; return { pinId: 123, authUrl: "https://app.plex.tv/auth#test" }; } } });
  const response = await mgmt.handler(post("/api/setup/signin", { action: "start", provider: "plex" }));
  assert.deepEqual([response.status, JSON.parse(response.body)], [400, { error: "invalid_server_url" }]);
  assert.equal(started, 0);
});

test("at capacity, reconnecting an existing account succeeds but a different identity cannot be added", async () => {
  const file = await fixture();
  const servers = Array.from({ length: 8 }, (_, i) => ({ provider: "navidrome", serverUrl: `http://127.0.0.1:${4533 + i}`, identity: { id: `u${i}`, displayName: `User ${i}` } }));
  await writeFile(file, serializeSetupConfig({ servers, credentialStored: true }));
  const values = new Map([["navidrome:u0", "old-secret"]]);
  const key = (ref) => `${ref.provider}:${ref.identityId}`;
  const credentials = { read: async (ref) => values.get(key(ref)) ?? null, remove: async (ref) => values.delete(key(ref)), save: async (ref, secret) => { values.set(key(ref), secret); } };
  let identityId = "u0";
  const mgmt = createSettingsServers({ file, deviceId, credentialStore: credentials, signIn: {
    signInNavidrome: async () => ({ provider: "navidrome", identity: { id: identityId, displayName: identityId }, secret: "new-secret" }),
  } });
  const body = { action: "password", provider: "navidrome", baseUrl: "http://127.0.0.1:4533", username: "u0", password: "new-password" };
  const success = await mgmt.handler(post("/api/setup/signin", body));
  assert.equal(success.status, 200);
  assert.equal(values.get("navidrome:u0"), "new-secret");
  assert.equal(JSON.parse(await readFile(file, "utf8")).servers.length, 8);
  identityId = "new-account";
  const failed = await mgmt.handler(post("/api/setup/signin", body));
  assert.deepEqual([failed.status, JSON.parse(failed.body)], [409, { error: "too_many_servers" }]);
  assert.equal(values.has("navidrome:new-account"), false);
  assert.equal(values.get("navidrome:u0"), "new-secret");
  assert.doesNotMatch(await readFile(file, "utf8"), /new-password|new-secret/);
  assert.equal(JSON.parse(await readFile(file, "utf8")).servers.length, 8);
});


test("a failed pre-save callback leaves config and existing sign-in intact", async () => {
  const file = await fixture();
  const original = serializeSetupConfig({ servers: [{ provider: "navidrome", serverUrl: "http://127.0.0.1:4533", identity: { id: "u1", displayName: "User" } }], credentialStored: true });
  await writeFile(file, original);
  const values = new Map([["navidrome:u1", "old-token"]]); const refKey = (ref) => `${ref.provider}:${ref.identityId}`;
  let restarted = false;
  const mgmt = createSettingsServers({ file, deviceId,
    credentialStore: { read: async (ref) => values.get(refKey(ref)) ?? null, remove: async (ref) => values.delete(refKey(ref)), save: async (ref, secret) => { values.set(refKey(ref), secret); } },
    beforeRestart: async () => { throw Error("optional services failed"); },
    onConfigured: async () => { restarted = true; },
    signIn: { signInNavidrome: async () => ({ provider: "navidrome", identity: { id: "u1", displayName: "User" }, secret: "signed-in-token" }) },
  });
  const response = await mgmt.handler(post("/api/setup/signin", { action: "password", provider: "navidrome", baseUrl: "http://127.0.0.1:4533", username: "u1", password: "not-saved" }));
  assert.deepEqual([response.status, JSON.parse(response.body)], [500, { error: "draft_update_failed" }]);
  assert.equal(await readFile(file, "utf8"), original);
  assert.equal(values.get("navidrome:u1"), "old-token");
  assert.equal(restarted, false);
});

test("a failed pre-save callback removes a newly acquired credential", async () => {
  const file = await fixture();
  const values = new Map(); const refKey = (ref) => `${ref.provider}:${ref.identityId}`;
  const mgmt = createSettingsServers({ file, deviceId,
    credentialStore: { read: async (ref) => values.get(refKey(ref)) ?? null, remove: async (ref) => values.delete(refKey(ref)), save: async (ref, secret) => { values.set(refKey(ref), secret); } },
    beforeRestart: async () => { throw Error("optional services failed"); },
    signIn: { signInNavidrome: async () => ({ provider: "navidrome", identity: { id: "u1", displayName: "User" }, secret: "signed-in-token" }) },
  });
  const response = await mgmt.handler(post("/api/setup/signin", { action: "password", provider: "navidrome", baseUrl: "http://127.0.0.1:4533", username: "u1", password: "not-saved" }));
  assert.deepEqual([response.status, JSON.parse(response.body)], [500, { error: "draft_update_failed" }]);
  assert.equal(values.has("navidrome:u1"), false);
  await assert.rejects(readFile(file, "utf8"), { code: "ENOENT" });
});
