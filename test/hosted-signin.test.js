import { streamJsonFixture } from "./helpers/stream-json-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createHostedGitHubSignIn } from "../src/hosted-signin.js";
import { createHostedCredentials } from "../src/hosted-credentials.js";
import { createHostedUploader } from "../src/hosted-uploader.js";
import { createMemoryRedis } from "../hosted/lib/redis.js";
import { createService } from "../hosted/lib/service.js";
import { createSetupHostedHandler } from "../src/setup-hosted-handler.js";

const DEV = "d".repeat(22);
const TOK = "t".repeat(43);

function memAdapter() {
  const m = new Map();
  return { m, setPassword: async (s, a, v) => { m.set(`${s}/${a}`, v); }, getPassword: async (s, a) => m.get(`${s}/${a}`) ?? null, deletePassword: async (s, a) => { m.delete(`${s}/${a}`); } };
}

function github({ tokenReplies }) {
  const calls = [];
  const replies = [...tokenReplies];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const reply = (data, status = 200) => (streamJsonFixture({ ok: status < 400, status, json: async () => data }));
    if (url === "https://github.com/login/device/code") return reply({ device_code: "dc", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 });
    if (url === "https://github.com/login/oauth/access_token") return reply(replies.shift());
    if (url.endsWith("/api/auth/github")) return reply({ login: "octo", deviceId: DEV, token: TOK, cardPath: "/u/octo.svg" }, 201);
    throw new Error(`unexpected ${url}`);
  };
  return { calls, fetchImpl };
}

test("device flow: code, pending, slow down, then signed in; GitHub token never saved", async () => {
  let clock = 0;
  const adapter = memAdapter();
  const credentials = createHostedCredentials({ adapter });
  const gh = github({ tokenReplies: [{ error: "authorization_pending" }, { error: "slow_down" }, { access_token: "gho_secretsecret" }] });
  const s = createHostedGitHubSignIn({ baseUrl: "https://nowplaying-hosted.vercel.app", credentials, clientId: "Iv1.abc", fetchImpl: gh.fetchImpl, now: () => clock, deviceName: "Desk" });
  const started = await s.start();
  assert.deepEqual({ ...started, expiresIn: undefined }, { status: "started", userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresIn: undefined, interval: 5 });
  assert.equal((await s.poll()).status, "pending"); // too early: no request
  clock += 5000; assert.equal((await s.poll()).status, "pending");
  clock += 5000; assert.equal((await s.poll()).status, "pending"); // slow_down -> 10s
  clock += 5000; assert.equal((await s.poll()).status, "pending"); // still waiting locally
  clock += 5000;
  assert.deepEqual(await s.poll(), { status: "signed_in", login: "octo", cardUrl: "https://nowplaying-hosted.vercel.app/u/octo.svg" });
  assert.equal(gh.calls.filter((c) => c.url.includes("access_token")).length, 3);
  const auth = gh.calls.find((c) => c.url.endsWith("/api/auth/github"));
  assert.deepEqual(auth.body, { githubToken: "gho_secretsecret", deviceName: "Desk" });
  assert.deepEqual({ ...(await credentials.load()) }, { login: "octo", deviceId: DEV, token: TOK });
  for (const v of adapter.m.values()) assert.ok(!v.includes("gho_secretsecret"));
});

test("an old per-PC key is handed over so its card link keeps working", async () => {
  const credentials = createHostedCredentials({ adapter: memAdapter() });
  await credentials.save({ cardId: "c".repeat(22), deviceId: DEV, token: "o".repeat(43) });
  const gh = github({ tokenReplies: [{ access_token: "gho_x0000000000" }] });
  let clock = 0;
  const s = createHostedGitHubSignIn({ baseUrl: "https://h.example", credentials, clientId: "id", fetchImpl: gh.fetchImpl, now: () => clock });
  await s.start(); clock += 5000;
  assert.equal((await s.poll()).status, "signed_in");
  assert.equal(gh.calls.find((c) => c.url.endsWith("/api/auth/github")).body.legacyToken, "o".repeat(43));
});

test("repeat client sign-in replaces the saved device through the hosted service", async () => {
  const credentials = createHostedCredentials({ adapter: memAdapter() });
  const now = () => 1_800_000_000_000;
  const service = createService({ redis: createMemoryRedis({ now }), now, githubUser: async () => ({ id: 101, login: "octo" }) });
  const requests = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const reply = (data, status = 200) => (streamJsonFixture({ ok: status < 400, status, json: async () => data }));
    if (url.endsWith("/login/device/code")) return reply({ device_code: "dc", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 });
    if (url.endsWith("/login/oauth/access_token")) return reply({ access_token: "gho_secretsecret" });
    if (url.endsWith("/api/auth/github")) {
      requests.push(body);
      return reply(await service.signInWithGitHub({ ...body, clientKey: "pc" }), 201);
    }
    throw new Error(`unexpected ${url}`);
  };
  let clock = 0;
  const signIn = createHostedGitHubSignIn({ baseUrl: "https://h.example", credentials, clientId: "id", fetchImpl, now: () => clock, deviceName: "This PC" });
  await signIn.start(); clock += 5000;
  assert.equal((await signIn.poll()).status, "signed_in");
  const old = await credentials.load();
  await service.ingest({ token: old.token, payload: { v: 1, seq: 1, observedAt: now(), state: "playing", kind: "track", title: "Old Private Track" } });
  await signIn.start(); clock += 5000;
  assert.equal((await signIn.poll()).status, "signed_in");
  const current = await credentials.load();
  assert.notEqual(current.deviceId, old.deviceId);
  assert.equal(requests[1].previousToken, old.token);
  assert.equal(requests[1].legacyToken, undefined);
  assert.deepEqual((await service.listDevices({ token: current.token })).devices.map((d) => [d.deviceId, d.current]), [[current.deviceId, true]]);
  assert.equal((await service.readUserCardState("octo")).state, "idle");
  await assert.rejects(service.ingest({ token: old.token, payload: { v: 1, seq: 2, observedAt: now(), state: "playing", title: "Ghost" } }), { status: 401 });
});

test("failed previous-device replacement leaves the saved credential intact", async () => {
  const credentials = createHostedCredentials({ adapter: memAdapter() });
  const old = { login: "octo", deviceId: DEV, token: TOK };
  await credentials.save(old);
  const gh = github({ tokenReplies: [{ access_token: "gho_secretsecret" }] });
  const fetchImpl = async (url, init) => url.endsWith("/api/auth/github")
    ? streamJsonFixture({ ok: false, status: 409, json: async () => ({ error: "previous_device_missing" }) })
    : gh.fetchImpl(url, init);
  let clock = 0;
  const signIn = createHostedGitHubSignIn({ baseUrl: "https://h.example", credentials, clientId: "id", fetchImpl, now: () => clock });
  await signIn.start(); clock += 5000;
  assert.equal((await signIn.poll()).status, "hosted_error");
  assert.deepEqual(await credentials.load(), old);
});

test("denied, expired and not configured", async () => {
  const credentials = createHostedCredentials({ adapter: memAdapter() });
  assert.deepEqual(await createHostedGitHubSignIn({ baseUrl: "https://h.example", credentials, clientId: null }).start(), { status: "not_configured" });
  let clock = 0;
  const denied = createHostedGitHubSignIn({ baseUrl: "https://h.example", credentials, clientId: "id", fetchImpl: github({ tokenReplies: [{ error: "access_denied" }] }).fetchImpl, now: () => clock });
  await denied.start(); clock += 5000;
  assert.equal((await denied.poll()).status, "denied");
  assert.equal((await denied.poll()).status, "not_started");
  const expired = createHostedGitHubSignIn({ baseUrl: "https://h.example", credentials, clientId: "id", fetchImpl: github({ tokenReplies: [] }).fetchImpl, now: () => clock });
  await expired.start(); clock += 901_000;
  assert.equal((await expired.poll()).status, "expired");
  assert.equal(await credentials.load(), null);
});

test("a running uploader picks up a new key after a 401 instead of wiping it", async () => {
  const credentials = createHostedCredentials({ adapter: memAdapter() });
  await credentials.save({ cardId: "c".repeat(22), deviceId: DEV, token: "o".repeat(43) });
  let revoked = false;
  const fetchImpl = async (url, init) => {
    if (revoked && init.headers.authorization === `Bearer ${"o".repeat(43)}`) return streamJsonFixture({ ok: false, status: 401, json: async () => ({ error: "unauthorized" }) });
    return streamJsonFixture({ ok: true, status: 202, json: async () => ({ accepted: true }) });
  };
  const up = createHostedUploader({ baseUrl: "https://h.example", credentials, fetchImpl, now: () => 1_800_000_000_000 });
  const presence = { state: "playing", kind: "track", title: "A", subtitle: "B" };
  await up.push(presence); // registers with the old key in memory
  await credentials.save({ login: "octo", deviceId: DEV, token: TOK }); // setup signed in meanwhile
  revoked = true; // and the service revoked the old key
  assert.equal((await up.push({ ...presence, title: "C" })).reason, "credentials_changed");
  assert.equal((await up.push({ ...presence, title: "D" })).sent, true);
  assert.equal(await up.cardUrl(), "https://h.example/u/octo.svg");
  assert.deepEqual({ ...(await credentials.load()) }, { login: "octo", deviceId: DEV, token: TOK });
});

test("setup signin route: start then poll, needs a credential store", async () => {
  const fake = { start: async () => ({ status: "started", userCode: "X" }), poll: async () => ({ status: "signed_in", login: "octo" }) };
  const none = createSetupHostedHandler({});
  assert.equal((await none({ method: "POST", url: "/api/setup/hosted/signin", body: JSON.stringify({ action: "start" }) })).status, 409);
  const h = createSetupHostedHandler({ credentials: { load: async () => null, save: async () => {} }, createSignIn: () => fake });
  const call = (b) => h({ method: "POST", url: "/api/setup/hosted/signin", body: JSON.stringify(b) });
  assert.equal(JSON.parse((await call({ action: "poll" })).body).status, "not_started");
  assert.equal(JSON.parse((await call({ action: "start" })).body).userCode, "X");
  assert.equal(JSON.parse((await call({ action: "poll" })).body).login, "octo");
  assert.equal((await call({ action: "start", url: "http://insecure.example" })).status, 400);
  assert.equal((await call({ action: "zap" })).status, 400);
  assert.equal((await call({ action: "start", token: "x" })).status, 400);
});

test("hosted device flow polls and expires by elapsed time after a wall-clock rollback (#729)", async () => {
  let wall = 1_800_000_000_000;
  let elapsed = 0;
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return streamJsonFixture({ status: 200, ok: true, json: async () => url.endsWith("/device/code")
      ? { device_code: "fixture", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 }
      : { error: "authorization_pending" } });
  };
  const credentials = createHostedCredentials({ adapter: memAdapter() });
  const signIn = createHostedGitHubSignIn({ baseUrl: "https://h.example", credentials, clientId: "id", fetchImpl, now: () => elapsed });
  assert.equal((await signIn.start()).status, "started");
  wall -= 60 * 60_000;
  elapsed += 10_000;
  assert.equal((await signIn.poll()).status, "pending");
  assert.equal(calls.filter((url) => url.endsWith("/access_token")).length, 1, "GitHub is polled after its five-second interval");
  elapsed += 900_000;
  assert.equal((await signIn.poll()).status, "expired");
  assert.equal(calls.filter((url) => url.endsWith("/access_token")).length, 1, "expired code is not polled again");
  assert.equal(wall, 1_799_996_400_000);
});

test("default hosted device flow clock is independent of Date.now (#729)", async () => {
  const originalWall = Date.now;
  const originalElapsed = performance.now;
  let wall = 1_800_000_000_000;
  let elapsed = 0;
  Date.now = () => wall;
  performance.now = () => elapsed;
  try {
    const gh = github({ tokenReplies: [{ error: "authorization_pending" }] });
    const signIn = createHostedGitHubSignIn({ baseUrl: "https://h.example", credentials: createHostedCredentials({ adapter: memAdapter() }), clientId: "id", fetchImpl: gh.fetchImpl });
    assert.equal((await signIn.start()).status, "started");
    wall -= 60 * 60_000;
    elapsed += 10_000;
    assert.equal((await signIn.poll()).status, "pending");
    assert.equal(gh.calls.filter((call) => call.url.endsWith("/access_token")).length, 1);
    elapsed += 900_000;
    assert.equal((await signIn.poll()).status, "expired");
  } finally {
    Date.now = originalWall;
    performance.now = originalElapsed;
  }
});
