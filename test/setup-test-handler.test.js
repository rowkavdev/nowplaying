import test from "node:test";
import assert from "node:assert/strict";
import { createSetupTestHandler } from "../src/setup-test-handler.js";
import { createSetupPageHandler } from "../src/setup-page-handler.js";

const ACCOUNT = { provider: "jellyfin", id: "u1", displayName: "Rowan", serverUrl: "http://192.168.1.20:8096" };
const store = (draft) => ({ load: async () => ({ draft }) });
const creds = (secret = "jf-api-key", fail = false) => ({ reads: [], async read(ref) { this.reads.push(ref); if (fail) throw new Error("vault locked: jf-api-key"); return secret; } });
const post = (handler) => handler({ method: "POST", url: "/api/setup/test", body: "{}" });
const read = (response) => JSON.parse(response.body);
const LEAKS = /jf-api-key|192\.168|8096|Rowan|u1|vault locked/;

function providerThat(getPresence) {
  const seen = [];
  return { seen, create: (config, secret, options) => { seen.push({ config, secret, options }); return { getPresence }; } };
}

test("connected: reads the saved sign-in by reference and reports only a status", async () => {
  const credentialStore = creds();
  const provider = providerThat(async () => ({ state: "playing" }));
  const handler = createSetupTestHandler({ store: store({ provider: "jellyfin", account: ACCOUNT }), credentialStore, createProvider: provider.create, fetchImpl: () => {} });
  const response = await post(handler);
  assert.equal(response.status, 200);
  assert.deepEqual(read(response), { ok: true, status: "connected", activity: "playing" });
  assert.deepEqual(credentialStore.reads, [{ provider: "jellyfin", identityId: "u1" }]);
  assert.equal(provider.seen[0].secret, "jf-api-key");
  assert.equal(provider.seen[0].config.serverUrl, ACCOUNT.serverUrl);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.doesNotMatch(response.body, LEAKS);
});

test("separates authentication, network and other server failures", async () => {
  const cases = [
    [async () => { throw new Error("Jellyfin request failed: 401"); }, "authentication_failed"],
    [async () => { throw Object.assign(new Error("connect ECONNREFUSED 192.168.1.20:8096"), { code: "ECONNREFUSED" }); }, "unreachable"],
    [async () => { throw new TypeError("fetch failed"); }, "unreachable"],
    [async () => { throw new Error("Jellyfin request failed: 500 at http://192.168.1.20:8096"); }, "connection_failed"],
  ];
  for (const [getPresence, status] of cases) {
    const handler = createSetupTestHandler({ store: store({ provider: "jellyfin", account: ACCOUNT }), credentialStore: creds(), createProvider: providerThat(getPresence).create });
    const response = await post(handler);
    assert.equal(read(response).status, status);
    assert.equal(read(response).ok, false);
    assert.doesNotMatch(response.body, LEAKS);
  }
});

test("reports setup problems without contacting the server", async () => {
  const never = providerThat(async () => { throw new Error("should not be called"); });
  const notSignedIn = await post(createSetupTestHandler({ store: store({ provider: "plex", account: null }), credentialStore: creds(), createProvider: never.create }));
  assert.equal(notSignedIn.status, 409);
  assert.equal(read(notSignedIn).status, "not_signed_in");
  const switched = await post(createSetupTestHandler({ store: store({ provider: "plex", account: ACCOUNT }), credentialStore: creds(), createProvider: never.create }));
  assert.equal(read(switched).status, "not_signed_in");
  const noServer = await post(createSetupTestHandler({ store: store({ provider: "plex", account: { provider: "plex", id: "7", displayName: "rowan" } }), credentialStore: creds(), createProvider: never.create }));
  assert.equal(read(noServer).status, "missing_server");
  const locked = await post(createSetupTestHandler({ store: store({ provider: "jellyfin", account: ACCOUNT }), credentialStore: creds("x", true), createProvider: never.create }));
  assert.equal(read(locked).status, "credential_unavailable");
  assert.doesNotMatch(locked.body, LEAKS);
  const empty = await post(createSetupTestHandler({ store: store({ provider: "jellyfin", account: ACCOUNT }), credentialStore: creds(""), createProvider: never.create }));
  assert.equal(read(empty).status, "credential_unavailable");
  assert.equal(never.seen.length, 0);
});

test("only answers POST on its own path", async () => {
  const handler = createSetupTestHandler({ store: store({}), credentialStore: creds() });
  assert.equal(await handler({ method: "POST", url: "/api/setup/draft" }), null);
  const get = await handler({ method: "GET", url: "/api/setup/test" });
  assert.equal(get.status, 405);
  assert.equal(get.headers.Allow, "POST");
  assert.equal((await handler({ method: "POST", url: "/api/setup/test?x=1" })).status, 400);
  assert.throws(() => createSetupTestHandler({ store: store({}) }), TypeError);
});

test("a store failure is a generic 500", async () => {
  const handler = createSetupTestHandler({ store: { load: async () => { throw new Error("disk: C:\\Users\\rowan"); } }, credentialStore: creds() });
  const response = await post(handler);
  assert.equal(response.status, 500);
  assert.deepEqual(read(response), { error: "test_failed" });
});

test("the setup page offers Test connection once signed in", async () => {
  const source = (await createSetupPageHandler()({ method: "GET", url: "/setup/app.js" })).body;
  assert.match(source, /TEST_API = "\/api\/setup\/test"/);
  assert.match(source, /id: "connectionTest", textContent: "Test connection"/);
  assert.match(source, /role: "status"/);
});

test("startSetupApp serves the connection test when a credential store is supplied", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { startSetupApp } = await import("../src/setup-app.js");
  const dir = await mkdtemp(join(tmpdir(), "np-test-"));
  const app = await startSetupApp({ draftFile: join(dir, "draft.json"), credentialStore: { save: async () => ({}), read: async () => "x" }, deviceId: "device-0123456789" });
  try {
    const url = new URL("/api/setup/test", app.url);
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-nowplaying-session": app.sessionSecret }, body: "{}" });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).status, "not_signed_in");
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});

test("rate-limits tests so the endpoint can't hammer the media server", async () => {
  let clock = 0;
  const provider = providerThat(async () => ({ state: "idle" }));
  const handler = createSetupTestHandler({ store: store({ provider: "jellyfin", account: ACCOUNT }), credentialStore: creds(), createProvider: provider.create, now: () => clock });
  for (let i = 0; i < 10; i += 1) assert.equal((await post(handler)).status, 200);
  const limited = await post(handler);
  assert.equal(limited.status, 429);
  assert.deepEqual(read(limited), { ok: false, status: "too_many_tests" });
  assert.equal(provider.seen.length, 10);
  clock += 60_000;
  assert.equal((await post(handler)).status, 200);
});

test("runs one test at a time", async () => {
  let release;
  let calls = 0;
  const provider = providerThat(() => (calls++ === 0 ? new Promise((resolve) => { release = () => resolve({ state: "idle" }); }) : Promise.resolve({ state: "idle" })));
  const handler = createSetupTestHandler({ store: store({ provider: "jellyfin", account: ACCOUNT }), credentialStore: creds(), createProvider: provider.create });
  const first = post(handler);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await post(handler)).status, 429);
  release();
  assert.equal((await first).status, 200);
  assert.equal((await post(handler)).status, 200);
});
