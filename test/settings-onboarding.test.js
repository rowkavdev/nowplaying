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
const store = { read: async () => "secret", save: async () => {} };
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
  const mgmt = createSettingsServers({ file, deviceId, credentialStore: { read: store.read, save: async (ref, secret) => { secrets.push({ ref, secret }); } }, onConfigured: () => { callbacks++; }, discover: async () => [], signIn: {
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
  await new Promise((resolve) => setTimeout(resolve, 550));
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
