import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { createHandlers } from "../hosted/lib/app.js";
import { createMemoryRedis } from "../hosted/lib/redis.js";
import { createService } from "../hosted/lib/service.js";

async function start() {
  const service = createService({ redis: createMemoryRedis() });
  const handlers = createHandlers({ getService: () => service });
  const routes = { "/api/register": handlers.register, "/api/ingest": handlers.ingest, "/api/revoke": handlers.revoke, "/api/card": handlers.card, "/api/health": handlers.health };
  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    const route = routes[path] ?? (path.startsWith("/card/") ? handlers.card : null);
    if (!route) { res.statusCode = 404; return res.end(); }
    return route(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
}

function call(port, method, path, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.once("error", reject);
    req.end(body);
  });
}

const json = (token) => ({ "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) });

test("register, ingest and render a card over HTTP", async () => {
  const app = await start();
  try {
    const reg = await call(app.port, "POST", "/api/register");
    assert.equal(reg.status, 201);
    const { cardId, token } = JSON.parse(reg.body);
    const payload = JSON.stringify({ v: 1, seq: 1, observedAt: Date.now(), state: "playing", kind: "track", title: "Blue Monday", subtitle: "New Order" });
    const ing = await call(app.port, "POST", "/api/ingest", { body: payload, headers: json(token) });
    assert.equal(ing.status, 202);
    const card = await call(app.port, "GET", `/card/${cardId}.svg?theme=paper&width=320`);
    assert.equal(card.status, 200);
    assert.equal(card.headers["content-type"], "image/svg+xml; charset=utf-8");
    assert.match(card.body, /Blue Monday/);
    assert.ok(!card.body.includes(token) && !card.body.includes(cardId));
    const again = await call(app.port, "GET", `/api/card?id=${cardId}&theme=paper&width=320`, { headers: { "if-none-match": card.headers.etag } });
    assert.equal(again.status, 304);
  } finally { await app.close(); }
});

test("ingest enforces auth, content type and size", async () => {
  const app = await start();
  try {
    const noAuth = await call(app.port, "POST", "/api/ingest", { body: "{}", headers: json() });
    assert.equal(noAuth.status, 401);
    const { token } = JSON.parse((await call(app.port, "POST", "/api/register")).body);
    const wrongType = await call(app.port, "POST", "/api/ingest", { body: "{}", headers: { "content-type": "text/plain", authorization: `Bearer ${token}` } });
    assert.equal(wrongType.status, 415);
    const big = await call(app.port, "POST", "/api/ingest", { body: JSON.stringify({ pad: "x".repeat(5000) }), headers: json(token) });
    assert.equal(big.status, 413);
    const get = await call(app.port, "GET", "/api/ingest");
    assert.equal(get.status, 405);
  } finally { await app.close(); }
});

test("card rejects bad options and unknown ids never leak detail", async () => {
  const app = await start();
  try {
    assert.equal((await call(app.port, "GET", "/api/card?id=short")).status, 404);
    const bad = await call(app.port, "GET", "/api/card?id=AAAAAAAAAAAAAAAAAAAAAA&theme=nope");
    assert.equal(bad.status, 400);
    assert.deepEqual(JSON.parse(bad.body), { error: "invalid_theme" });
    const idle = await call(app.port, "GET", "/api/card?id=AAAAAAAAAAAAAAAAAAAAAA");
    assert.equal(idle.status, 200);
    assert.match(idle.body, /NOT PLAYING/);
    assert.equal((await call(app.port, "GET", "/api/health")).body, "ok");
  } finally { await app.close(); }
});

test("card layout options come from the URL, are checked, and cache separately", async () => {
  const app = await start();
  try {
    const { cardId, token } = JSON.parse((await call(app.port, "POST", "/api/register")).body);
    // Paused, so the progress bar doesn't move between requests.
    const payload = JSON.stringify({ v: 1, seq: 1, observedAt: Date.now(), state: "paused", kind: "track", title: "Blue Monday", subtitle: "New Order", positionMs: 1000, durationMs: 4000 });
    assert.equal((await call(app.port, "POST", "/api/ingest", { body: payload, headers: json(token) })).status, 202);
    const plain = await call(app.port, "GET", `/card/${cardId}.svg`);
    const styled = await call(app.port, "GET", `/card/${cardId}.svg?padding=12&radius=0&titleSize=24&subtitleSize=12&progressHeight=8&textAlign=middle&fieldOrder=title,subtitle,state&progressPosition=text&progressWidth=full&direction=auto`);
    assert.equal(styled.status, 200);
    assert.match(styled.body, /rx="0"/);
    assert.match(styled.body, /font-size="24"/);
    assert.match(styled.body, /text-anchor="middle"/);
    assert.match(styled.body, /height="8"/);
    assert.notEqual(styled.headers.etag, plain.headers.etag);
    const same = await call(app.port, "GET", `/card/${cardId}.svg?padding=12&radius=0&titleSize=24&subtitleSize=12&progressHeight=8&textAlign=middle&fieldOrder=title,subtitle,state&progressPosition=text&progressWidth=full&direction=auto`, { headers: { "if-none-match": styled.headers.etag } });
    assert.equal(same.status, 304);
    assert.equal((await call(app.port, "GET", `/card/${cardId}.svg`, { headers: { "if-none-match": styled.headers.etag } })).status, 200);
    for (const query of ["padding=11", "padding=49", "radius=-1", "radius=1.5", "titleSize=31", "subtitleSize=9", "progressHeight=13", "padding=0x10", "textAlign=center", "fieldOrder=title,state", "fieldOrder=title,title,state", "progressPosition=top", "progressWidth=half", "direction=RTL", "radius=2&radius=3"]) {
      const bad = await call(app.port, "GET", `/card/${cardId}.svg?${query}`);
      assert.equal(bad.status, 400, query);
      assert.deepEqual(JSON.parse(bad.body), { error: "invalid_layout" }, query);
    }
  } finally { await app.close(); }
});

test("the requests badge publishes the card request total as a Shields endpoint", async () => {
  const { compactCount } = await import("../hosted/lib/app.js");
  const redis = createMemoryRedis();
  const service = createService({ redis });
  const handlers = createHandlers({ getService: () => service });
  const server = createServer((req, res) => handlers.requestsBadge(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    let badge = await call(port, "GET", "/badges/requests.json");
    assert.equal(badge.status, 200);
    assert.deepEqual(JSON.parse(badge.body), { schemaVersion: 1, label: "card requests", message: "0", color: "#58a6ff" });
    assert.match(badge.headers["cache-control"], /max-age=300/);
    await redis.command(["SET", "np:stats:cards_rendered", "12345"]);
    badge = await call(port, "GET", "/badges/requests.json");
    assert.equal(JSON.parse(badge.body).message, "12.3k");
    assert.equal((await call(port, "POST", "/badges/requests.json")).status, 405);
    await redis.command(["SET", "np:stats:cards_rendered", "garbage"]);
    badge = await call(port, "GET", "/badges/requests.json");
    assert.equal(badge.status, 503);
    assert.equal(JSON.parse(badge.body).message, "unavailable");
    assert.equal(badge.headers["cache-control"], "no-store");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.deepEqual([0, 999, 1000, 12_345, 999_950, 4_560_000, 2_500_000_000].map(compactCount), ["0", "999", "1k", "12.3k", "1M", "4.56M", "2.5B"]);
});
