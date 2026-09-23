import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
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
    discord: { enabled: true, idleBehavior: "clear" },
  });
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
