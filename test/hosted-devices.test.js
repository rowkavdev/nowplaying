import test from "node:test";
import assert from "node:assert/strict";
import { createHostedDevicesClient, createHostedDevicesHandler, HOSTED_DEVICES_PATH, HOSTED_DEVICES_SCRIPT } from "../src/hosted-devices.js";

const ME = "A".repeat(22);
const OTHER = "B".repeat(22);
const creds = (value) => ({ load: async () => value });
const signedIn = { login: "rowkavdev", deviceId: ME, token: "t".repeat(40) };

function fakeService({ status = 200, devices } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.authorization, body: init.body ? JSON.parse(init.body) : null });
    const data = init.method === "GET" ? { devices: devices ?? [{ deviceId: ME, name: "Desk", createdAt: 1, lastSeen: 2, current: true, tokenHash: "x" }, { deviceId: OTHER, name: "Laptop", createdAt: 3, lastSeen: null }] } : { ok: true };
    return { status, json: async () => data };
  };
  return { calls, fetchImpl };
}
const post = (body, headers = {}) => ({ method: "POST", url: HOSTED_DEVICES_PATH, headers, body: JSON.stringify(body) });
const fallback = async () => ({ status: 418, headers: {}, body: "" });

test("lists devices with only safe fields, using the stored device key", async () => {
  const svc = fakeService();
  const r = await createHostedDevicesClient({ baseUrl: "https://nowplaying-hosted.vercel.app", credentials: creds(signedIn), fetchImpl: svc.fetchImpl }).run({ action: "list" });
  assert.equal(svc.calls[0].url, "https://nowplaying-hosted.vercel.app/api/devices");
  assert.equal(svc.calls[0].auth, `Bearer ${signedIn.token}`);
  assert.deepEqual(r, { signedIn: true, login: "rowkavdev", devices: [
    { deviceId: ME, name: "Desk", createdAt: 1, lastSeen: 2, current: true },
    { deviceId: OTHER, name: "Laptop", createdAt: 3, lastSeen: null, current: false },
  ] });
});

test("anonymous or missing registration is signed out without calling the service", async () => {
  const svc = fakeService();
  for (const value of [null, { cardId: ME, deviceId: ME, token: "t".repeat(40) }]) {
    const r = await createHostedDevicesClient({ baseUrl: "https://x.example", credentials: creds(value), fetchImpl: svc.fetchImpl }).run({ action: "list" });
    assert.equal(r.signedIn, false);
  }
  assert.equal(svc.calls.length, 0);
});

test("rename and remove another PC post the action, then re-list", async () => {
  const svc = fakeService();
  const client = createHostedDevicesClient({ baseUrl: "https://x.example", credentials: creds(signedIn), fetchImpl: svc.fetchImpl });
  await client.run({ action: "rename", deviceId: OTHER, name: "Work" });
  await client.run({ action: "remove", deviceId: OTHER });
  assert.deepEqual(svc.calls.map((c) => [c.method, c.body?.action ?? null]), [["POST", "rename"], ["GET", null], ["POST", "remove"], ["GET", null]]);
  assert.deepEqual(svc.calls[0].body, { action: "rename", deviceId: OTHER, name: "Work" });
});

test("removing this PC, sign-out-everywhere or a 401 signs this PC out", async () => {
  for (const [action, status] of [[{ action: "remove", deviceId: ME }, 200], [{ action: "remove-all" }, 200], [{ action: "list" }, 401]]) {
    const svc = fakeService({ status });
    let out = 0;
    const handle = createHostedDevicesHandler({ getClient: () => createHostedDevicesClient({ baseUrl: "https://x.example", credentials: creds(signedIn), fetchImpl: svc.fetchImpl }), onSignedOut: async () => { out += 1; }, fallback });
    const res = await handle(post(action));
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { signedIn: false, devices: [] });
    assert.equal(out, 1);
  }
});

test("handler checks method, site and input; passes other paths through", async () => {
  const handle = createHostedDevicesHandler({ getClient: () => null, fallback });
  assert.equal((await handle({ method: "GET", url: HOSTED_DEVICES_PATH })).status, 405);
  assert.equal((await handle(post({ action: "list" }, { "Sec-Fetch-Site": "cross-site" }))).status, 403);
  assert.equal((await handle(post({ action: "rename", deviceId: OTHER, name: "" }))).status, 400);
  assert.equal((await handle(post({ action: "remove", deviceId: "../x" }))).status, 400);
  assert.equal((await handle(post({ action: "nope" }))).status, 400);
  assert.deepEqual(JSON.parse((await handle(post({ action: "list" }))).body), { signedIn: false, devices: [] });
  assert.equal((await handle({ method: "GET", url: "/other" })).status, 418);
  assert.doesNotMatch(HOSTED_DEVICES_SCRIPT, /innerHTML/);
});

test("service errors map to safe statuses", async () => {
  const svc = fakeService({ status: 500 });
  const handle = createHostedDevicesHandler({ getClient: () => createHostedDevicesClient({ baseUrl: "https://x.example", credentials: creds(signedIn), fetchImpl: svc.fetchImpl }), fallback });
  assert.equal((await handle(post({ action: "list" }))).status, 502);
});
