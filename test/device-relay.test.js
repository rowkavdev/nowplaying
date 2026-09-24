import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { createRelayHandlers } from "../hosted/lib/device-relay.js";
import { createMemoryRedis } from "../hosted/lib/redis.js";

const KEY = "test-relay-key-0123456789abcdef";

async function start({ relayKey = KEY, now } = {}) {
  let clock = now ?? Date.now();
  const redis = createMemoryRedis({ now: () => clock });
  const handlers = createRelayHandlers({ getRedis: () => redis, relayKey, baseUrl: "https://relay.example", now: () => clock });
  const server = createServer((req, res) => handlers.route(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    advance: (ms) => { clock += ms; },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function call(port, method, path, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    const req = request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString(), json: () => JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.once("error", reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

test("push, poll, consume round trip", async () => {
  const app = await start();
  try {
    const noAuth = await call(app.port, "POST", "/api/device-relay", { body: { code: "8B4C-9D2E" } });
    assert.equal(noAuth.status, 401);

    const badCode = await call(app.port, "POST", "/api/device-relay", { token: KEY, body: { code: "nope" } });
    assert.equal(badCode.status, 422);

    const pushed = await call(app.port, "POST", "/api/device-relay", { token: KEY, body: { code: "8b4c-9d2e", lane: "scanner-lane", scopes: "repo workflow" } });
    assert.equal(pushed.status, 201);
    const { id } = pushed.json();
    assert.ok(id);

    const pending = await call(app.port, "GET", "/api/device-relay?pending=1", { token: KEY });
    assert.equal(pending.status, 200);
    assert.deepEqual(pending.json().pending.map((e) => e.code), ["8B4C-9D2E"]);
    assert.equal(pending.json().pending[0].lane, "scanner-lane");

    const wrongKey = await call(app.port, "GET", "/api/device-relay?pending=1", { token: KEY.slice(0, -1) + "x" });
    assert.equal(wrongKey.status, 401);

    const consumed = await call(app.port, "POST", "/api/device-relay?consume=1", { token: KEY, body: { id } });
    assert.equal(consumed.json().consumed, true);
    const after = await call(app.port, "GET", "/api/device-relay?pending=1", { token: KEY });
    assert.deepEqual(after.json().pending, []);
  } finally { await app.close(); }
});

test("entries expire after 15 minutes", async () => {
  const app = await start({ now: 1_000_000 });
  try {
    await call(app.port, "POST", "/api/device-relay", { token: KEY, body: { code: "8B4C-9D2E" } });
    app.advance(16 * 60 * 1000);
    const pending = await call(app.port, "GET", "/api/device-relay?pending=1", { token: KEY });
    assert.deepEqual(pending.json().pending, []);
  } finally { await app.close(); }
});

test("queue caps at 10", async () => {
  const app = await start();
  try {
    for (let i = 0; i < 10; i += 1) {
      const r = await call(app.port, "POST", "/api/device-relay", { token: KEY, body: { code: `AAAA-000${i}` } });
      assert.equal(r.status, 201);
    }
    const full = await call(app.port, "POST", "/api/device-relay", { token: KEY, body: { code: "AAAA-0010" } });
    assert.equal(full.status, 409);
  } finally { await app.close(); }
});

test("unconfigured relay refuses authed routes but still serves the script", async () => {
  const app = await start({ relayKey: "" });
  try {
    const pending = await call(app.port, "GET", "/api/device-relay?pending=1", { token: KEY });
    assert.equal(pending.status, 503);
    const script = await call(app.port, "GET", "/api/device-relay?script=1");
    assert.equal(script.status, 200);
    assert.match(script.body, /==UserScript==/);
    assert.ok(!script.body.includes("__RELAY_BASE__"));
    assert.ok(!script.body.includes("__RELAY_HOST__"));
    assert.ok(script.body.includes("relay.example"));
  } finally { await app.close(); }
});

test("push page is served", async () => {
  const app = await start();
  try {
    const page = await call(app.port, "GET", "/api/device-relay?push=1");
    assert.equal(page.status, 200);
    assert.match(page.body, /Relay key/);
    assert.ok(!page.body.includes("NOT CONFIGURED"));
  } finally { await app.close(); }
});
