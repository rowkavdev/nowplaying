import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createHttpServer } from "../src/http-server.js";

// Session-cookie lifecycle: the per-run secret authorizes writes from this
// install's own UI, and only that. A restart rotates the secret, so cookies
// minted by a previous run (or any tampered variant) must never authorize.

const SECRET = "s".repeat(43);
const OTHER_SECRET = "o".repeat(43);

function send(port, { method = "POST", path = "/api/setup/draft", headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: { "Content-Length": Buffer.byteLength(body), ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.once("error", reject).end(body);
  });
}

async function withServer(options, run) {
  const seen = [];
  const app = createHttpServer({
    port: 0,
    handler: async (req) => {
      if (req.url === "/setup") return { status: 200, page: true, headers: { "Content-Type": "text/html; charset=utf-8" }, body: "<p>setup</p>" };
      seen.push(req);
      return { status: 200, headers: { "Content-Type": "application/json" }, body: "{}" };
    },
    ...options,
  });
  const { port } = await app.listen();
  try { await run(port, seen); } finally { await app.close(); }
}

const json = { "Content-Type": "application/json" };

test("the full lifecycle: a page load mints the cookie that then authorizes writes", async () => {
  await withServer({ sessionSecret: SECRET }, async (port, seen) => {
    assert.equal((await send(port, { headers: json, body: "{}" })).status, 403, "no session before any page load");
    const page = await send(port, { method: "GET", path: "/setup" });
    const setCookie = page.headers["set-cookie"][0];
    const cookie = setCookie.split(";")[0];
    assert.equal((await send(port, { headers: { ...json, Cookie: cookie }, body: "{}" })).status, 200);
    assert.equal(seen.length, 1);
  });
});

test("a restart rotates the secret: cookies from a previous run stop authorizing", async () => {
  await withServer({ sessionSecret: SECRET }, async (firstPort) => {
    const page = await send(firstPort, { method: "GET", path: "/setup" });
    const staleCookie = page.headers["set-cookie"][0].split(";")[0];
    await withServer({ sessionSecret: OTHER_SECRET }, async (secondPort, seen) => {
      assert.equal((await send(secondPort, { headers: { ...json, Cookie: staleCookie }, body: "{}" })).status, 403);
      assert.equal((await send(secondPort, { headers: { ...json, "X-Nowplaying-Session": SECRET }, body: "{}" })).status, 403, "the old header secret is just as dead");
      assert.equal(seen.length, 0);
    });
  });
});

test("tampered cookies never authorize: substitution, truncation, extension, empty, prefix confusion", async () => {
  await withServer({ sessionSecret: SECRET }, async (port, seen) => {
    const tampered = [
      `nowplaying_session=${`t${SECRET.slice(1)}`}`, // one character changed, same length
      `nowplaying_session=${SECRET.slice(0, -1)}`, // truncated
      `nowplaying_session=${SECRET}x`, // extended
      "nowplaying_session=", // empty
      `nowplaying_session2=${SECRET}`, // name prefix confusion
      `nowplaying_session=xx${SECRET}xx`, // secret as a substring
      `NowPlaying_Session=${SECRET}`, // cookie names are case-sensitive
    ];
    for (const cookie of tampered) {
      assert.equal((await send(port, { headers: { ...json, Cookie: cookie }, body: "{}" })).status, 403, cookie);
    }
    assert.equal(seen.length, 0);
  });
});

test("either credential suffices, and a bad sibling cannot poison a good one", async () => {
  await withServer({ sessionSecret: SECRET }, async (port, seen) => {
    assert.equal((await send(port, { headers: { ...json, "X-Nowplaying-Session": "wrong", Cookie: `nowplaying_session=${SECRET}` }, body: "{}" })).status, 200, "good cookie beats bad header");
    assert.equal((await send(port, { headers: { ...json, "X-Nowplaying-Session": SECRET, Cookie: "nowplaying_session=wrong" }, body: "{}" })).status, 200, "good header beats bad cookie");
    assert.equal((await send(port, { headers: { ...json, Cookie: `nowplaying_session=wrong; nowplaying_session=${SECRET}` }, body: "{}" })).status, 200, "a later duplicate can still match");
    assert.equal(seen.length, 3);
  });
});

test("a valid session still needs a JSON content type and a loopback origin", async () => {
  await withServer({ sessionSecret: SECRET }, async (port, seen) => {
    const cookie = { Cookie: `nowplaying_session=${SECRET}` };
    assert.equal((await send(port, { headers: { ...cookie, "Content-Type": "text/plain" }, body: "x" })).status, 415);
    assert.equal((await send(port, { headers: { ...json, ...cookie, "Sec-Fetch-Site": "cross-site" }, body: "{}" })).status, 403);
    assert.equal((await send(port, { headers: { ...json, ...cookie, Origin: "http://evil.example" }, body: "{}" })).status, 403);
    assert.equal(seen.length, 0, "the session never weakens the other write guards");
  });
});
