import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyDiscordChanges, applyHostedChanges, createAppSettingsStore, discordSettingsView, hostedSettingsView } from "../src/app-settings.js";
import { parseAppConfig, startAppFromConfig } from "../src/app-config.js";
import { serializeSetupConfig } from "../src/setup-config.js";

const JELLYFIN = { provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "Rowan" }, credentialStored: true, discordArtworkLookup: "musicbrainz", hostedEnabled: true };

async function configFile(input = JELLYFIN) {
  const dir = await mkdtemp(join(tmpdir(), "np-app-settings-"));
  const file = join(dir, "config.json");
  await writeFile(file, serializeSetupConfig(input));
  return file;
}

test("shows the Discord settings with defaults for older configs", () => {
  const config = parseAppConfig(serializeSetupConfig({ ...JELLYFIN, discordArtworkLookup: undefined }));
  assert.deepEqual({ ...discordSettingsView(config) }, { enabled: true, timestamps: "both", artworkLookup: "off", idleBehavior: "clear" });
});

test("applies Discord changes and keeps everything else", () => {
  const before = parseAppConfig(serializeSetupConfig(JELLYFIN));
  const { config } = applyDiscordChanges(before, { enabled: false, timestamps: "remaining" });
  assert.deepEqual({ ...config.discord }, { enabled: false, idleBehavior: "clear", artworkLookup: "musicbrainz", timestamps: "remaining" });
  assert.deepEqual(config.identity, before.identity);
  assert.equal(config.serverUrl, before.serverUrl);
  assert.deepEqual({ ...config.hosted }, { ...before.hosted });
});

test("changes what Discord shows when nothing is playing", () => {
  const before = parseAppConfig(serializeSetupConfig(JELLYFIN));
  for (const idleBehavior of ["grace", "show", "recent", "clear"]) {
    const { config } = applyDiscordChanges(before, { idleBehavior });
    assert.equal(config.discord.idleBehavior, idleBehavior);
    assert.equal(discordSettingsView(config).idleBehavior, idleBehavior);
    assert.equal(config.discord.artworkLookup, "musicbrainz");
  }
  // Other Discord saves keep the chosen idle behaviour.
  const kept = applyDiscordChanges(applyDiscordChanges(before, { idleBehavior: "recent" }).config, { timestamps: "none" }).config;
  assert.equal(kept.discord.idleBehavior, "recent");
});

test("rejects unknown keys and bad values", () => {
  const config = parseAppConfig(serializeSetupConfig(JELLYFIN));
  assert.throws(() => applyDiscordChanges(config, { token: "x" }), TypeError);
  assert.throws(() => applyDiscordChanges(config, {}), TypeError);
  assert.throws(() => applyDiscordChanges(config, []), TypeError);
  assert.throws(() => applyDiscordChanges(config, { timestamps: "forever" }), TypeError);
  assert.throws(() => applyDiscordChanges(config, { artworkLookup: "itunes" }), TypeError);
  assert.throws(() => applyDiscordChanges(config, { enabled: "yes" }), TypeError);
  assert.throws(() => applyDiscordChanges(config, { idleBehavior: "forever" }), TypeError);
});

test("saves to config.json in one step and leaves no temp files", async () => {
  const file = await configFile();
  const store = createAppSettingsStore({ file });
  await Promise.all([store.updateDiscord({ timestamps: "none" }), store.updateDiscord({ artworkLookup: "off" })]);
  const saved = parseAppConfig(await readFile(file, "utf8"));
  assert.equal(saved.discord.timestamps, "none");
  assert.equal(saved.discord.artworkLookup, "off");
  assert.deepEqual(await readdir(join(file, "..")), ["config.json"]);
  await assert.rejects(store.updateDiscord({ timestamps: "forever" }), TypeError);
  assert.equal(parseAppConfig(await readFile(file, "utf8")).discord.timestamps, "none");
});

test("the running app saves Discord settings from its own page only", async () => {
  const file = await configFile();
  const app = await startAppFromConfig({ configFile: file, credentialStore: { read: async () => "jf-token" }, port: 0, fetchImpl: async () => Response.json([]), discord: { env: {}, builtInClientId: "" } });
  try {
    const page = await fetch(`${app.url}/settings`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /script-src 'self'/);
    const cookie = page.headers.get("set-cookie").split(";")[0];
    assert.deepEqual((await (await fetch(`${app.url}/api/settings`)).json()).discord, { enabled: true, timestamps: "both", artworkLookup: "musicbrainz", idleBehavior: "clear" });
    const put = (headers, body = { discord: { enabled: false, timestamps: "elapsed" } }) => fetch(`${app.url}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    // No session cookie, or a request from another site: refused, nothing saved.
    assert.equal((await put({})).status, 403);
    assert.equal((await put({ Cookie: cookie, Origin: "http://evil.example" })).status, 403);
    assert.equal(parseAppConfig(await readFile(file, "utf8")).discord.enabled, true);
    assert.equal((await put({ Cookie: cookie }, { discord: { timestamps: "forever" } })).status, 400);
    assert.equal((await put({ Cookie: cookie }, { privacy: { mode: "public" } })).status, 400);
    assert.equal((await put({ Cookie: cookie }, { discord: { enabled: true }, hosted: { enabled: true } })).status, 400);
    const saved = await put({ Cookie: cookie });
    assert.equal(saved.status, 200);
    assert.deepEqual((await saved.json()).discord, { enabled: false, timestamps: "elapsed", artworkLookup: "musicbrainz", idleBehavior: "clear" });
    assert.equal(parseAppConfig(await readFile(file, "utf8")).discord.timestamps, "elapsed");
    const refresh = await fetch(`${app.url}/api/settings/discord/refresh-artwork`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{}" });
    assert.deepEqual([refresh.status, await refresh.json()], [200, { dropped: 0 }]);
    // Applied without a restart: Discord is now off.
    assert.equal(app.discord, "off");
    assert.equal((await (await fetch(`${app.url}/api/status`)).json()).discord.enabled, false);
  } finally {
    await app.close();
  }
});

test("turns the hosted card on and off without touching the rest", () => {
  const before = parseAppConfig(serializeSetupConfig({ ...JELLYFIN, hostedEnabled: undefined }));
  assert.equal(before.hosted, undefined);
  const on = applyHostedChanges(before, { enabled: true }).config;
  assert.deepEqual({ ...on.hosted }, { enabled: true });
  assert.deepEqual({ ...on.discord }, { ...before.discord });
  const custom = parseAppConfig(serializeSetupConfig({ ...JELLYFIN, hostedUrl: "https://card.example.com" }));
  assert.deepEqual({ ...applyHostedChanges(custom, { enabled: false }).config.hosted }, { enabled: false, url: "https://card.example.com" });
  assert.throws(() => applyHostedChanges(before, { url: "https://evil.example" }), TypeError);
  assert.throws(() => applyHostedChanges(before, { enabled: "yes" }), TypeError);
  assert.deepEqual({ ...hostedSettingsView(before) }, { enabled: false });
});

function fakeHostedService() {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push(`${init.method ?? "GET"} ${path}`);
    if (path === "/api/register") return Response.json({ cardId: "c".repeat(22), deviceId: "d".repeat(22), token: "t".repeat(32) });
    if (path === "/api/ingest") return Response.json({ ok: true });
    if (path === "/api/revoke") return Response.json({ revoked: true });
    return Response.json([]);
  };
  let stored = null;
  const credentials = { load: async () => stored, save: async (value) => { stored = value; }, clear: async () => { stored = null; } };
  return { calls, fetchImpl, credentials, stored: () => stored };
}

test("the settings page turns the hosted card on, shows its link and disconnects", async () => {
  const file = await configFile({ ...JELLYFIN, hostedEnabled: false });
  const service = fakeHostedService();
  const app = await startAppFromConfig({ configFile: file, credentialStore: { read: async () => "jf-token" }, port: 0, fetchImpl: service.fetchImpl, hostedCredentials: service.credentials, discord: { env: {}, builtInClientId: "" } });
  try {
    const cookie = (await fetch(`${app.url}/settings`)).headers.get("set-cookie").split(";")[0];
    const call = (path, method, body) => fetch(`${app.url}${path}`, { method, headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
    assert.deepEqual((await (await fetch(`${app.url}/api/settings`)).json()).hosted, { enabled: false, state: "off", lastSuccessAt: null, error: null, cardUrl: null });
    const on = await (await call("/api/settings", "PUT", { hosted: { enabled: true } })).json();
    assert.equal(on.hosted.enabled, true);
    assert.equal(on.hosted.cardUrl, `https://nowplaying-hosted.vercel.app/card/${"c".repeat(22)}.svg`);
    assert.equal(app.hosted, "on");
    assert.equal(parseAppConfig(await readFile(file, "utf8")).hosted.enabled, true);
    assert.ok(service.stored());
    const off = await call("/api/settings/hosted/disconnect", "POST", {});
    assert.equal(off.status, 200);
    assert.deepEqual((await off.json()).hosted, { enabled: false, state: "off", lastSuccessAt: null, error: null, cardUrl: null });
    assert.ok(service.calls.includes("DELETE /api/revoke"));
    assert.equal(service.stored(), null);
    assert.equal(app.hosted, "off");
    assert.equal(parseAppConfig(await readFile(file, "utf8")).hosted.enabled, false);
    // Disconnect without the page's cookie is refused.
    assert.equal((await fetch(`${app.url}/api/settings/hosted/disconnect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 403);
  } finally {
    await app.close();
  }
});

test("the settings page turns Start with Windows on and off through the shared shortcut", async () => {
  const file = await configFile();
  let enabled = false;
  const startup = { isEnabled: async () => enabled, setEnabled: async (value) => { enabled = value; } };
  const app = await startAppFromConfig({ configFile: file, credentialStore: { read: async () => "jf-token" }, port: 0, fetchImpl: async () => Response.json([]), discord: { env: {}, builtInClientId: "" }, startup });
  try {
    const cookie = (await fetch(`${app.url}/settings`)).headers.get("set-cookie").split(";")[0];
    const put = (body) => fetch(`${app.url}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
    assert.deepEqual((await (await fetch(`${app.url}/api/settings`)).json()).startup, { available: true, startWithWindows: false });
    const on = await put({ startup: { startWithWindows: true } });
    assert.deepEqual([on.status, (await on.json()).startup], [200, { available: true, startWithWindows: true }]);
    assert.equal(enabled, true);
    assert.equal((await put({ startup: { startWithWindows: "yes" } })).status, 400);
    assert.equal((await put({ startup: { startWithWindows: false, path: "C:\\evil.exe" } })).status, 400);
    const before = await readFile(file, "utf8");
    await put({ startup: { startWithWindows: false } });
    assert.equal(enabled, false);
    assert.equal(await readFile(file, "utf8"), before);
  } finally {
    await app.close();
  }
});

test("Start with Windows is hidden when the build can't offer it", async () => {
  const app = await startAppFromConfig({ configFile: await configFile(), credentialStore: { read: async () => "jf-token" }, port: 0, fetchImpl: async () => Response.json([]), discord: { env: {}, builtInClientId: "" } });
  try {
    const cookie = (await fetch(`${app.url}/settings`)).headers.get("set-cookie").split(";")[0];
    assert.deepEqual((await (await fetch(`${app.url}/api/settings`)).json()).startup, { available: false, startWithWindows: false });
    const put = await fetch(`${app.url}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ startup: { startWithWindows: true } }) });
    assert.equal(put.status, 400);
  } finally {
    await app.close();
  }
});

test("settings changes keep every server in a multi-server config (#252)", () => {
  const config = parseAppConfig(serializeSetupConfig({
    servers: [
      { provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "Rowan" } },
      { provider: "navidrome", serverUrl: "http://127.0.0.1:4533", identity: { id: "rowan", displayName: "rowan" } },
    ],
    credentialStored: true,
  }));
  const { config: next, text } = applyDiscordChanges(config, { enabled: false });
  assert.equal(next.discord.enabled, false);
  assert.deepEqual(next.servers, config.servers);
  assert.deepEqual(JSON.parse(text).servers.map((s) => s.provider), ["jellyfin", "navidrome"]);
  assert.deepEqual(applyHostedChanges(config, { enabled: true }).config.servers, config.servers);
});
