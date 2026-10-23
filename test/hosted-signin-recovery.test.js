import test from "node:test";
import assert from "node:assert/strict";
import { streamJsonFixture } from "./helpers/stream-json-fixture.js";
import { createHostedGitHubSignIn } from "../src/hosted-signin.js";
import { createMemoryRedis } from "../hosted/lib/redis.js";
import { createService, ServiceError } from "../hosted/lib/service.js";

const BASE = "https://cards.example.test";
const DEV = "d".repeat(22);
const TOK = "t".repeat(43);
const reply = (data, status = 200) => streamJsonFixture({ status, ok: status < 400, json: async () => data });

function setup({ old = { login: "octo", deviceId: DEV, token: TOK, baseUrl: BASE }, auth }) {
  let stored = old;
  let clock = 0;
  let saves = 0;
  const bodies = [];
  const credentials = { load: async () => stored, save: async (value) => { stored = value; saves++; } };
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/login/device/code")) return reply({ device_code: "dc", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 });
    if (url.endsWith("/login/oauth/access_token")) return reply({ access_token: "gho_test000000000" });
    assert.equal(url, `${BASE}/api/auth/github`);
    bodies.push(JSON.parse(init.body));
    return auth(bodies.at(-1), bodies.length);
  };
  const flow = createHostedGitHubSignIn({ baseUrl: BASE, credentials, clientId: "test", fetchImpl, now: () => clock });
  return { bodies, stored: () => stored, saves: () => saves, run: async () => { await flow.start(); clock += 5000; return flow.poll(); } };
}

test("a PC removed remotely can sign back in with its saved revoked key", async () => {
  const now = () => 1_800_000_000_000;
  const redis = createMemoryRedis({ now });
  const service = createService({ redis, now, githubUser: async () => ({ id: 101, login: "octo" }) });
  const removed = await service.signInWithGitHub({ githubToken: "gho_test000000000" });
  await service.revoke({ token: removed.token });
  const env = setup({ old: { ...removed, baseUrl: BASE }, auth: async (body) => {
    try { return reply(await service.signInWithGitHub(body), 201); }
    catch (error) { if (error instanceof ServiceError) return reply({ error: error.code }, error.status); throw error; }
  } });
  assert.equal((await env.run()).status, "signed_in");
  assert.equal(env.bodies.length, 2);
  assert.equal(env.bodies[0].previousToken, removed.token);
  assert.equal(env.bodies[1].previousToken, undefined);
  assert.equal(env.saves(), 1);
  assert.notEqual(env.stored().token, removed.token);
  const list = await service.listDevices({ token: env.stored().token });
  assert.deepEqual(list.devices.map((d) => d.deviceId), [env.stored().deviceId]);
  assert.equal(await redis.command(["GET", `np:dstate:${removed.deviceId}`]), null);
  await assert.rejects(service.listDevices({ token: removed.token }), { status: 401 });
});

test("a failed fresh-device retry is bounded and retains the saved credential", async () => {
  for (const networkError of [false, true]) {
    const env = setup({ auth: async (_body, count) => {
      if (count === 2 && networkError) throw new Error("offline");
      return reply({ error: "previous_device_missing" }, 409);
    } });
    const old = env.stored();
    assert.equal((await env.run()).status, networkError ? "hosted_unreachable" : "hosted_error");
    assert.equal(env.bodies.length, 2);
    assert.equal(env.stored(), old);
    assert.equal(env.saves(), 0);
  }
});

test("sign-in never drops previousToken for mismatches, rate limits or other errors", async () => {
  for (const [status, error] of [[403, "previous_device_mismatch"], [409, "previous_device_mismatch"], [429, "rate_limited"], [500, "internal_error"], [400, "invalid_previous_token"]]) {
    const env = setup({ auth: async () => reply({ error }, status) });
    const old = env.stored();
    assert.equal((await env.run()).status, status === 429 ? "rate_limited" : "hosted_error");
    assert.equal(env.bodies.length, 1);
    assert.equal(env.stored(), old);
    assert.equal(env.saves(), 0);
  }
});
